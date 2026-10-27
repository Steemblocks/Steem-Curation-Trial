/**
 * bridgeClient.js
 * ───────────────
 * Subscribes to the Steem WebSocket bridge (default wss://dhakawitness.com) and
 * receives every new block pushed in real time, instead of polling RPC nodes.
 * The streamer falls back to HTTP RPC automatically whenever the bridge is
 * unavailable or stale. Set STEEM_WS_URL= (empty) in .env to disable.
 */

import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config();

export const BRIDGE_URL = process.env.STEEM_WS_URL !== undefined
  ? process.env.STEEM_WS_URL.trim()
  : 'wss://dhakawitness.com';

const STALE_AFTER_MS = 15_000;   // no block for this long => treat as down
const RECONNECT_MS   = 3_000;
const CACHE_SIZE     = 120;

let ws = null;
let connected = false;
let headBlock = 0;
let lastBlockAt = 0;
const blockCache = new Map();
let waiters = [];

function wake() {
  const w = waiters; waiters = [];
  w.forEach(r => r());
}

function connect() {
  if (!BRIDGE_URL) return;
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch (e) {
    return setTimeout(connect, RECONNECT_MS);
  }

  ws.on('open', () => {
    connected = true;
    console.log(`[Bridge] Connected to ${BRIDGE_URL}`);
    ws.send(JSON.stringify({ id: 1, method: 'subscribe_blocks', params: [] }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== 'subscription_update' || msg.subscription !== 'blocks') return;
    const { blockNumber, block } = msg.data || {};
    if (!blockNumber || !block) return;

    blockCache.set(blockNumber, block);
    if (blockCache.size > CACHE_SIZE) blockCache.delete(blockCache.keys().next().value);
    headBlock = Math.max(headBlock, blockNumber);
    lastBlockAt = Date.now();
    wake();
  });

  const onDown = () => {
    if (!connected && !ws) return;
    if (connected) console.warn('[Bridge] Disconnected — falling back to RPC nodes, reconnecting...');
    connected = false;
    ws = null;
    setTimeout(connect, RECONNECT_MS);
  };
  ws.on('close', onDown);
  ws.on('error', () => { try { ws?.terminate(); } catch { /* ignore */ } });
}

export function startBridge() {
  if (!BRIDGE_URL) {
    console.log('[Bridge] Disabled (STEEM_WS_URL empty) — using RPC polling only');
    return;
  }
  connect();
  // Drop a silently stalled socket so it reconnects
  setInterval(() => {
    if (connected && Date.now() - lastBlockAt > STALE_AFTER_MS * 2 && ws) {
      console.warn('[Bridge] No blocks received — resetting connection');
      try { ws.terminate(); } catch { /* ignore */ }
    }
  }, 10_000);
}

/** True when connected and blocks are actually arriving. */
export function isBridgeLive() {
  return connected && Date.now() - lastBlockAt < STALE_AFTER_MS;
}

/** Head block pushed by the bridge, or null if the bridge isn't live. */
export function getBridgeHead() {
  return isBridgeLive() ? headBlock : null;
}

export function getBridgeBlock(blockNum) {
  return blockCache.get(blockNum) ?? null;
}

/** Resolves on the next pushed block, or after timeoutMs. */
export function waitForBridgeBlock(timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    waiters.push(() => { clearTimeout(t); resolve(); });
  });
}

export function getBridgeStatus() {
  return { url: BRIDGE_URL || null, enabled: !!BRIDGE_URL, live: isBridgeLive() };
}
