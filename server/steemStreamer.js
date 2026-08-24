/**
 * steemStreamer.js
 * ───────────────
 * Streams Steem blocks in real time using condenser_api.get_block.
 * Dynamically tracks all active curation trail leaders registered by users.
 */

import { getSystemState, setSystemState, getWatchedAccounts } from './db.js';
import { getGlobals, getBlock }                              from './steemClient.js';
import { dispatchTrailVotes }                                 from './voteEngine.js';

let running      = false;
let currentBlock = 0;
let watchedSet   = new Set(); // lowercase account names being watched

export function getSyncedBlock()  { return currentBlock; }
export function getWatchedSet()   { return watchedSet;   }

/** Refresh the set of watched accounts from DB. */
export function refreshWatched() {
  const accounts = getWatchedAccounts();
  watchedSet = new Set(accounts.map(a => a.toLowerCase()));
  if (watchedSet.size > 0) {
    console.log(`[Streamer] Watching ${watchedSet.size} trail leader(s): ${[...watchedSet].join(', ')}`);
  }
}

export async function startStreamer() {
  if (running) return;
  running = true;

  refreshWatched();
  setInterval(refreshWatched, 25_000); // refresh every 25s

  try {
    const globals = await getGlobals();
    const head    = globals?.head_block_number ?? 0;
    const saved   = parseInt(getSystemState('synced_block') ?? '0', 10);
    
    // If saved block is too old (> 50 blocks behind), catch up near head
    if (saved > 0 && head - saved < 50) {
      currentBlock = saved;
    } else {
      currentBlock = Math.max(0, head - 5);
    }

    console.log(`[Streamer] Starting at block #${currentBlock} (Head: #${head})`);
    loop();
  } catch (err) {
    console.error('[Streamer] Init error:', err.message);
    running = false;
    setTimeout(startStreamer, 10_000);
  }
}

async function loop() {
  while (running) {
    try {
      const globals = await getGlobals();
      const head    = globals?.head_block_number ?? currentBlock;

      // Prevent falling too far behind if network stalled
      if (head - currentBlock > 40) {
        console.warn(`[Streamer] Sync lag detected (${head - currentBlock} blocks). Jumping closer to head.`);
        currentBlock = head - 5;
      }

      if (currentBlock <= head) {
        await processBlock(currentBlock);
        setSystemState('synced_block', currentBlock);
        currentBlock++;
      } else {
        await sleep(3000); // wait for next 3-second Steem block
      }
    } catch (err) {
      console.error(`[Streamer] Error at block #${currentBlock}:`, err.message);
      await sleep(4000);
    }
  }
}

async function processBlock(blockNum) {
  if (watchedSet.size === 0) return;

  const block = await getBlock(blockNum);
  if (!block || !block.transactions) return;

  for (const tx of block.transactions) {
    if (!tx.operations) continue;

    for (const op of tx.operations) {
      const [type, data] = op;
      if (type !== 'vote' || !data) continue;

      const voter = (data.voter ?? '').toLowerCase();
      if (!watchedSet.has(voter)) continue;

      const leaderWeightPct = Math.abs(data.weight) / 100;
      console.log(`[Streamer] 🔔 Block #${blockNum}: @${voter} voted on @${data.author}/${data.permlink} (${leaderWeightPct}%)`);

      dispatchTrailVotes({
        leader:       voter,
        author:       data.author,
        permlink:     data.permlink,
        leaderWeight: leaderWeightPct,
      }).catch(err => console.error('[Streamer] Dispatch error:', err.message));
    }
  }
}

/** Manually trigger a trail vote dispatch (for /api/simulate-vote). */
export async function simulateVote(leader, author, permlink, weight = 100) {
  console.log(`[Streamer] Simulating: @${leader} voted @${author}/${permlink} (${weight}%)`);
  await dispatchTrailVotes({ leader, author, permlink, leaderWeight: weight });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
