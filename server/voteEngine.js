import { getActiveFollowers, logVote, getVoteLogs } from './db.js';
import { getAccount, calcVP, hasBotAuthority, voteOnBehalf, BOT_ACCOUNT } from './steemClient.js';
import { broadcastAll } from './wsHub.js';

const cleanName = (name) => (name || '').toString().replace(/^@/, '').trim().toLowerCase();

// Safe rate-limiting interval for Steem blockchain (Steem consensus requires >= 3.0s between votes)
const MIN_VOTE_INTERVAL_MS = 3500;

// In-memory Vote Queue
const voteQueue = [];
let isQueueRunning = false;
let lastBroadcastTime = 0;
const lastVoteTimeByVoter = new Map();

/**
 * Fan out a detected leader vote to all active subscribers following that leader.
 */
export async function dispatchTrailVotes({ leader, author, permlink, leaderWeight }) {
  const followers = getActiveFollowers(leader);
  if (!followers.length) return;

  const targetAuthor = cleanName(author);
  const targetLeader = cleanName(leader);

  console.log(`[VoteEngine] @${leader} → @${author}/${permlink} (${leaderWeight}%) — ${followers.length} follower(s) found`);

  for (const user of followers) {
    const voter = cleanName(user.username);

    // Skip if voter is the leader
    if (voter === targetLeader) continue;
    
    // Restrict self-voting: if post author is the follower account, skip vote
    if (voter === targetAuthor) {
      console.log(`[VoteEngine] @${user.username}: Skipped self-vote on own post @${author}/${permlink}`);
      const effectiveWeight = Math.max(1, Math.round(((user.weight ?? 100) / 100) * leaderWeight));
      logAndBroadcast(leader, author, permlink, user.username, effectiveWeight, 'SKIPPED_SELF_VOTE', 'Self-voting restricted on own post');
      continue;
    }

    const delayMs = (user.delay ?? 0) * 60_000;
    const executeAfter = Date.now() + delayMs;

    voteQueue.push({
      user,
      leader,
      author,
      permlink,
      leaderWeight,
      executeAfter,
      createdAt: Date.now()
    });

    console.log(`[VoteEngine] Enqueued vote for @${voter} (delay: ${user.delay || 0}m, execute in ${Math.round(delayMs / 1000)}s)`);
  }

  processVoteQueue();
}

/**
 * Sequential Queue Worker
 * Enforces a strict >= 3.5s interval between Steem transaction broadcasts.
 */
async function processVoteQueue() {
  if (isQueueRunning) return;
  isQueueRunning = true;

  try {
    while (voteQueue.length > 0) {
      const now = Date.now();

      // Find first job ready for execution (executeAfter <= now)
      const readyIndex = voteQueue.findIndex(job => job.executeAfter <= now);

      if (readyIndex === -1) {
        // No jobs ready right now; find earliest pending job and schedule timer
        const earliestTime = Math.min(...voteQueue.map(j => j.executeAfter));
        const waitMs = Math.max(1000, earliestTime - now);
        setTimeout(processVoteQueue, Math.min(waitMs, 30_000));
        break;
      }

      // Dequeue the ready job
      const [job] = voteQueue.splice(readyIndex, 1);
      const { user, leader, author, permlink, leaderWeight } = job;
      const voter = cleanName(user.username);

      // Enforce global broadcast interval (at least 3.5s since last broadcast)
      const elapsedSinceLastBroadcast = Date.now() - lastBroadcastTime;
      if (elapsedSinceLastBroadcast < MIN_VOTE_INTERVAL_MS) {
        const sleepMs = MIN_VOTE_INTERVAL_MS - elapsedSinceLastBroadcast;
        await sleep(sleepMs);
      }

      // Enforce per-voter rate limit (at least 3.5s since this voter's last vote)
      const voterLastVote = lastVoteTimeByVoter.get(voter) || 0;
      const elapsedSinceVoterLastVote = Date.now() - voterLastVote;
      if (elapsedSinceVoterLastVote < MIN_VOTE_INTERVAL_MS) {
        const sleepMs = MIN_VOTE_INTERVAL_MS - elapsedSinceVoterLastVote;
        await sleep(sleepMs);
      }

      // Execute the vote
      await executeVote({ user, leader, author, permlink, leaderWeight });

      // Update timestamps
      const completedTime = Date.now();
      lastBroadcastTime = completedTime;
      lastVoteTimeByVoter.set(voter, completedTime);

      // Brief breather between loop iterations
      await sleep(500);
    }
  } catch (err) {
    console.error('[VoteEngine Queue] Worker error:', err);
  } finally {
    isQueueRunning = false;
  }
}

async function executeVote({ user, leader, author, permlink, leaderWeight }) {
  const { username, weight: userWeight, min_vp } = user;
  const voter = cleanName(username);
  const targetAuthor = cleanName(author);

  // Scale user's weight % against leader's actual weight
  const effectiveWeight = Math.max(1, Math.round(((userWeight ?? 100) / 100) * leaderWeight));

  // Safeguard: restrict self-voting if author is the user
  if (voter === targetAuthor) {
    console.log(`[VoteEngine] @${username}: Skipped self-vote on own post @${author}/${permlink}`);
    return logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'SKIPPED_SELF_VOTE', 'Self-voting restricted on own post');
  }

  try {
    // 1. Check current Voting Power
    const acc = await getAccount(username);
    if (!acc) {
      return logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'FAILED', 'Account not found on blockchain');
    }
    const vp = calcVP(acc);
    if (vp < (min_vp ?? 80)) {
      console.log(`[VoteEngine] @${username}: VP ${vp.toFixed(1)}% < min ${min_vp}% — skipped`);
      return logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'SKIPPED_VP', `VP ${vp.toFixed(1)}% < ${min_vp}%`);
    }

    // 2. Check Bot Authority
    if (!BOT_ACCOUNT) {
      return logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'FAILED', 'BOT_ACCOUNT not set in .env');
    }
    const authorized = await hasBotAuthority(username);
    if (!authorized) {
      return logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'FAILED',
        `@${BOT_ACCOUNT} not in posting_auths of @${username} — authority revoked?`);
    }

    // 3. Broadcast vote on behalf of user
    console.log(`[VoteEngine] 🚀 Broadcasting vote: @${username} → @${author}/${permlink} (${effectiveWeight}%)`);
    const result = await voteOnBehalf({ voter: username, author, permlink, weight: effectiveWeight });

    // 4. Log result
    if (result.success) {
      console.log(`[VoteEngine] ✓ @${username} successfully voted @${author}/${permlink} (tx: ${result.txId})`);
      logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'SUCCESS', null, result.txId);
    } else {
      console.error(`[VoteEngine] ✗ @${username} vote failed: ${result.error}`);
      logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'FAILED', result.error);
    }

  } catch (err) {
    console.error(`[VoteEngine] @${username} exception:`, err.message);
    logAndBroadcast(leader, author, permlink, username, effectiveWeight, 'FAILED', err.message);
  }
}

function logAndBroadcast(leader, author, permlink, voter, weight, status, error = null, txId = null) {
  try {
    logVote({ leader, author, permlink, voter, weight, status, error, txId });
    // Push fresh logs over WebSocket immediately
    broadcastAll('logs', getVoteLogs({ limit: 50, offset: 0 }));
  } catch (e) {
    console.error('[VoteEngine] logVote error:', e.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

