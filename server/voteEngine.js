import { getActiveFollowers, logVote }                              from './db.js';
import { getAccount, calcVP, hasBotAuthority,
         voteOnBehalf, BOT_ACCOUNT }       from './steemClient.js';

const cleanName = (name) => (name || '').toString().replace(/^@/, '').trim().toLowerCase();

/**
 * Fan out a detected leader vote to all active subscribers following that leader.
 */
export async function dispatchTrailVotes({ leader, author, permlink, leaderWeight }) {
  const followers = getActiveFollowers(leader);
  if (!followers.length) return;

  const targetAuthor = cleanName(author);
  const targetLeader = cleanName(leader);

  console.log(`[VoteEngine] @${leader} → @${author}/${permlink} (${leaderWeight}%) — ${followers.length} follower(s)`);

  for (const user of followers) {
    const voter = cleanName(user.username);

    // Skip if voter is the leader
    if (voter === targetLeader) continue;
    
    // Restrict self-voting: if post author is the follower account, skip vote
    if (voter === targetAuthor) {
      console.log(`[VoteEngine] @${user.username}: Skipped self-vote on own post @${author}/${permlink}`);
      const effectiveWeight = Math.max(1, Math.round(((user.weight ?? 100) / 100) * leaderWeight));
      log(leader, author, permlink, user.username, effectiveWeight, 'SKIPPED_SELF_VOTE', 'Self-voting restricted on own post');
      continue;
    }

    const delayMs = (user.delay ?? 0) * 60_000;
    setTimeout(() => executeVote({ user, leader, author, permlink, leaderWeight }), delayMs);
  }
}

async function executeVote({ user, leader, author, permlink, leaderWeight }) {
  const { username, weight: userWeight, min_vp } = user;
  const voter = cleanName(username);
  const targetAuthor = cleanName(author);

  // Scale user's weight % against leader's actual weight
  const effectiveWeight = Math.max(1, Math.round((userWeight / 100) * leaderWeight));

  // Safeguard: restrict self-voting if author is the user
  if (voter === targetAuthor) {
    console.log(`[VoteEngine] @${username}: Skipped self-vote on own post @${author}/${permlink}`);
    return log(leader, author, permlink, username, effectiveWeight, 'SKIPPED_SELF_VOTE', 'Self-voting restricted on own post');
  }

  try {
    // 1. Check current Voting Power
    const acc = await getAccount(username);
    if (!acc) {
      return log(leader, author, permlink, username, effectiveWeight, 'FAILED', 'Account not found on blockchain');
    }
    const vp = calcVP(acc);
    if (vp < (min_vp ?? 80)) {
      console.log(`[VoteEngine] @${username}: VP ${vp.toFixed(1)}% < min ${min_vp}% — skip`);
      return log(leader, author, permlink, username, effectiveWeight, 'SKIPPED_VP', `VP ${vp.toFixed(1)}% < ${min_vp}%`);
    }

    // 2. Vote on behalf of user
    if (!BOT_ACCOUNT) {
      return log(leader, author, permlink, username, effectiveWeight, 'FAILED', 'BOT_ACCOUNT not set in .env');
    }
    const authorized = await hasBotAuthority(username);
    if (!authorized) {
      return log(leader, author, permlink, username, effectiveWeight, 'FAILED',
        `@${BOT_ACCOUNT} not in posting_auths of @${username} — authority revoked?`);
    }
    const result = await voteOnBehalf({ voter: username, author, permlink, weight: effectiveWeight });

    // 3. Log result
    if (result.success) {
      console.log(`[VoteEngine] ✓ @${username} voted @${author}/${permlink} (tx: ${result.txId})`);
      log(leader, author, permlink, username, effectiveWeight, 'SUCCESS', null, result.txId);
    } else {
      console.error(`[VoteEngine] ✗ @${username}: ${result.error}`);
      log(leader, author, permlink, username, effectiveWeight, 'FAILED', result.error);
    }

  } catch (err) {
    console.error(`[VoteEngine] @${username} exception:`, err.message);
    log(leader, author, permlink, username, effectiveWeight, 'FAILED', err.message);
  }
}

function log(leader, author, permlink, voter, weight, status, error = null, txId = null) {
  logVote({ leader, author, permlink, voter, weight, status, error, txId });
}
