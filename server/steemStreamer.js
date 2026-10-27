/**
 * steemStreamer.js
 * ───────────────
 * Streams Steem blocks in real time using condenser_api.get_block.
 * Dynamically tracks all active curation trail leaders registered by users.
 */

import { getSystemState, setSystemState, getWatchedAccounts, getAutoVoteWatchedAuthors } from './db.js';
import { getGlobals, getBlock, getContent }                  from './steemClient.js';
import { dispatchTrailVotes, dispatchAutoVotes }              from './voteEngine.js';
import { isBridgeLive, getBridgeHead, getBridgeBlock, waitForBridgeBlock } from './bridgeClient.js';

let running      = false;
let currentBlock = 0;
let watchedSet   = new Set(); // lowercase account names being watched
let authorSet    = new Set(); // authors targeted for auto-vote

export function getSyncedBlock()  { return currentBlock; }
export function getWatchedSet()   { return watchedSet;   }

/** Refresh the set of watched accounts from DB. */
export function refreshWatched() {
  const accounts = getWatchedAccounts();
  watchedSet = new Set(accounts.map(a => a.toLowerCase()));
  authorSet  = new Set(getAutoVoteWatchedAuthors().map(a => a.toLowerCase()));
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
    let head = getBridgeHead();
    if (!head) {
      const globals = await getGlobals();
      head = globals?.head_block_number ?? 0;
    }
    const saved = parseInt(getSystemState('synced_block') ?? '0', 10);
    
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
      // Determine latest head block: prefer bridge websocket, fallback to getGlobals HTTP
      let head = getBridgeHead();
      if (!head) {
        const globals = await getGlobals();
        head = globals?.head_block_number ?? currentBlock;
      }

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
        // Caught up with head: wait for WebSocket push or fall back to timer
        if (isBridgeLive()) {
          await waitForBridgeBlock(3500);
        } else {
          await sleep(3000); // wait for next 3-second Steem block
        }
      }
    } catch (err) {
      console.error(`[Streamer] Error at block #${currentBlock}:`, err.message);
      await sleep(4000);
    }
  }
}

async function processBlock(blockNum) {
  if (watchedSet.size === 0 && authorSet.size === 0) return;

  // 1. Try WebSocket bridge cache first (0 network round-trips)
  let block = getBridgeBlock(blockNum);

  // 2. Fall back to HTTP RPC if not in cache (e.g. historical block catch-up)
  if (!block) {
    block = await getBlock(blockNum);
  }

  if (!block || !block.transactions) return;

  for (const tx of block.transactions) {
    if (!tx.operations) continue;

    for (const op of tx.operations) {
      const [type, data] = op;
      if (!data) continue;

      // Auto-vote: new top-level post by a targeted author
      if (type === 'comment') {
        const postAuthor = (data.author ?? '').toLowerCase();
        if (data.parent_author !== '' || !authorSet.has(postAuthor)) continue;
        handleNewPost(postAuthor, data.permlink, blockNum);
        continue;
      }

      if (type !== 'vote') continue;

      const voter = (data.voter ?? '').toLowerCase();
      if (!watchedSet.has(voter)) continue;

      const leaderWeightPct = data.weight / 100; // preserve sign: positive = upvote, negative = downvote
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

/** Comment ops also fire on edits — only vote when created === last_update (a fresh post). */
async function handleNewPost(author, permlink, blockNum) {
  try {
    const post = await getContent(author, permlink);
    if (!post || !post.created) return;
    if (post.created !== post.last_update) return; // edited post
    console.log(`[Streamer] 📝 Block #${blockNum}: new post @${author}/${permlink}`);
    await dispatchAutoVotes({ author, permlink });
  } catch (err) {
    console.error('[Streamer] Auto-vote dispatch error:', err.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
