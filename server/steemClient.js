import dotenv from 'dotenv';
dotenv.config();
import { getSystemState, setSystemState } from './db.js';

import ecc from 'steem/lib/auth/ecc/index.js';
const { Signature } = ecc.default || ecc;

export const BOT_ACCOUNT    = (process.env.BOT_ACCOUNT    || '').toLowerCase();
export const BOT_POSTING_KEY = (process.env.BOT_POSTING_KEY || '').trim();
export const TRAIL_LEADER    = (process.env.TRAIL_LEADER   || 'dhaka.witness').toLowerCase().trim();

// ── Steem RPC nodes (with automated failover, custom nodes & pinning) ─────────
export const DEFAULT_NODES = [
  'https://api.moecki.online',
  'https://api.steemit.com',
  'https://api.justyy.com',
  'https://api.steem.fans',
  'https://steem.justyy.com',
];
let NODES = [...DEFAULT_NODES];
let customNodes = [];
let autoFailover = true;
let ni = 0;
export const node = () => NODES[ni];
export const rotate = () => { if (autoFailover && NODES.length > 1) ni = (ni + 1) % NODES.length; };

const rebuildNodes = (activeUrl) => {
  NODES = [...DEFAULT_NODES, ...customNodes.filter(u => !DEFAULT_NODES.includes(u))];
  const idx = NODES.indexOf(activeUrl);
  ni = idx >= 0 ? idx : 0;
  if (_steem) _steem.api.setOptions({ url: node() });
};

const persistNodes = () => {
  setSystemState('custom_nodes', JSON.stringify(customNodes));
  setSystemState('active_node', node());
  setSystemState('node_failover', autoFailover ? '1' : '0');
};

/** Load persisted node settings (call after initDb). */
export function initNodes() {
  try {
    customNodes = JSON.parse(getSystemState('custom_nodes') || '[]').filter(u => typeof u === 'string');
  } catch { customNodes = []; }
  autoFailover = getSystemState('node_failover') !== '0';
  const savedActive = getSystemState('active_node');
  const target = (savedActive && savedActive !== 'https://api.steemit.com') ? savedActive : DEFAULT_NODES[0];
  rebuildNodes(target);
  console.log(`[Nodes] Active: ${node()} (failover ${autoFailover ? 'on' : 'off'}, ${customNodes.length} custom)`);
}

export function getNodeConfig() {
  return {
    active: node(),
    autoFailover,
    nodes: NODES.map(url => ({ url, custom: !DEFAULT_NODES.includes(url) })),
  };
}

/** Validate a user-supplied node URL (http/https, no loopback/private hosts). */
export function normalizeNodeUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (
    h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
    /^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) || h === '0.0.0.0' || h.startsWith('[')
  ) return null;
  return u.origin + (u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '');
}

export function addCustomNode(url) {
  if (!NODES.includes(url)) { customNodes.push(url); rebuildNodes(node()); persistNodes(); }
  return getNodeConfig();
}

export function removeCustomNode(url) {
  if (DEFAULT_NODES.includes(url)) return null;
  const wasActive = node() === url;
  customNodes = customNodes.filter(u => u !== url);
  rebuildNodes(wasActive ? DEFAULT_NODES[0] : node());
  persistNodes();
  return getNodeConfig();
}

export function setActiveNode(url, failover) {
  if (!NODES.includes(url)) return null;
  ni = NODES.indexOf(url);
  if (typeof failover === 'boolean') autoFailover = failover;
  if (_steem) _steem.api.setOptions({ url: node() });
  persistNodes();
  return getNodeConfig();
}

/** Probe a node: returns latency + head block, or error. */
export async function testNode(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_dynamic_global_properties', params: [] }),
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    if (j.error || !j.result?.head_block_number) throw new Error(j.error?.message || 'Not a Steem node');
    return { ok: true, latency: Date.now() - t0, headBlock: j.result.head_block_number };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'Timed out' : (e.message || 'Unreachable') };
  }
}

// ── Raw JSON-RPC call ─────────────────────────────────────────────────────────
export async function rpc(method, params = []) {
  const attempts = autoFailover ? NODES.length : 2;
  for (let t = 0; t < attempts; t++) {
    try {
      const r = await fetch(node(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(9000),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      rotate();
    }
  }
  throw new Error(autoFailover ? 'All Steem RPC nodes failed' : `Pinned node ${node()} failed (failover disabled)`);
}

// ── Account ───────────────────────────────────────────────────────────────────
export async function getAccount(username) {
  const r = await rpc('condenser_api.get_accounts', [[username]]);
  return r?.[0] ?? null;
}

// ── Accurate Steem Voting Power calculation (0 - 100%) ────────────────────────
export function calcVP(acc) {
  if (!acc) return 100;
  
  const now = Math.floor(Date.now() / 1000);

  // Preferred method: using voting_manabar & effective vesting shares
  if (acc.voting_manabar && acc.vesting_shares) {
    const vests = parseFloat(acc.vesting_shares) || 0;
    const delegated = parseFloat(acc.delegated_vesting_shares) || 0;
    const received = parseFloat(acc.received_vesting_shares) || 0;
    const effectiveVests = vests - delegated + received;
    const maxMana = Math.floor(effectiveVests * 1000000);
    const currentMana = parseFloat(acc.voting_manabar.current_mana) || 0;
    const lastUpdateTime = parseInt(acc.voting_manabar.last_update_time, 10) || 0;
    const elapsed = Math.max(0, now - lastUpdateTime);

    if (maxMana > 0) {
      const regeneratedMana = (elapsed * maxMana) / 432000;
      const totalMana = Math.min(maxMana, currentMana + regeneratedMana);
      const vp = (totalMana / maxMana) * 100;
      return parseFloat(Math.min(100, Math.max(0, vp)).toFixed(2));
    }
  }

  // Fallback method: using base voting_power & last_vote_time
  if (acc.voting_power !== undefined) {
    const baseVp = parseFloat(acc.voting_power) || 10000;
    const lastVoteTime = acc.last_vote_time ? new Date(acc.last_vote_time + 'Z').getTime() / 1000 : 0;
    const elapsed = Math.max(0, now - lastVoteTime);
    const regenerated = (elapsed * 10000) / 432000;
    const currentVp = Math.min(10000, baseVp + regenerated);
    return parseFloat((currentVp / 100).toFixed(2));
  }

  return 0;
}

// ── Reputation ────────────────────────────────────────────────────────────────
export function formatRep(raw) {
  const r = parseFloat(raw);
  if (!r) return 25;
  const sign = r < 0 ? -1 : 1;
  const v = (Math.log10(Math.abs(r)) - 9) * 9 + 25;
  return Math.max(0, Math.floor(sign < 0 ? 50 - v : v));
}

// ── Head block info & Steem Power (SP) Conversion ─────────────────────────────
export async function getGlobals() {
  return rpc('condenser_api.get_dynamic_global_properties', []);
}

let _cachedGlobals = null;
let _cachedGlobalsTime = 0;

export async function getCachedGlobals(maxAgeMs = 60_000) {
  const now = Date.now();
  if (_cachedGlobals && (now - _cachedGlobalsTime < maxAgeMs)) {
    return _cachedGlobals;
  }
  try {
    const g = await getGlobals();
    if (g && g.total_vesting_fund_steem && g.total_vesting_shares) {
      _cachedGlobals = g;
      _cachedGlobalsTime = now;
      return _cachedGlobals;
    }
  } catch (err) {
    // Return cached value if available on error
  }
  return _cachedGlobals;
}

/**
 * Convert VESTS string or number to Steem Power (SP) string (e.g. '28.472 SP').
 * Uses live dynamic global properties or fallback Steem blockchain ratio.
 */
export function vestsToSp(vests, globals = null) {
  const v = typeof vests === 'string' ? parseFloat(vests) : Number(vests);
  if (!v || isNaN(v) || v <= 0) return '0.000 SP';
  const g = globals || _cachedGlobals;
  const fund = parseFloat(g?.total_vesting_fund_steem) || 201780397;
  const shares = parseFloat(g?.total_vesting_shares) || 325261996680;
  const sp = v * (fund / shares);
  return `${sp.toFixed(3)} SP`;
}

// ── Fetch complete Block with Transactions & Operations ───────────────────────
export async function getBlock(blockNum) {
  try {
    return await rpc('condenser_api.get_block', [blockNum]);
  } catch (err) {
    return null;
  }
}

// ── Fetch active votes on a post ─────────────────────────────────────────────
export async function getActiveVotes(author, permlink) {
  try {
    const cleanAuthor = (author || '').toString().replace(/^@/, '').trim().toLowerCase();
    const cleanPerm = (permlink || '').toString().trim();
    if (!cleanAuthor || !cleanPerm) return [];
    const votes = await rpc('condenser_api.get_active_votes', [cleanAuthor, cleanPerm]);
    return Array.isArray(votes) ? votes : [];
  } catch (err) {
    return [];
  }
}

// ── Fetch a post's content (used to tell new posts from edits) ───────────────
export async function getContent(author, permlink) {
  try {
    return await rpc('condenser_api.get_content', [author, permlink]);
  } catch (err) {
    return null;
  }
}

// ── steem-js lazy loader ──────────────────────────────────────────────────────
let _steem = null;
export async function steemJs() {
  if (!_steem) {
    const m = await import('steem');
    _steem = m.default ?? m;
    _steem.api.setOptions({ url: node() });
  }
  return _steem;
}

/**
 * Check whether the bot account is already in a user's posting.account_auths.
 */
export async function hasBotAuthority(username) {
  const acc = await getAccount(username);
  if (!acc) return false;
  const auths = acc.posting?.account_auths ?? [];
  return auths.some(([a]) => a.toLowerCase() === BOT_ACCOUNT.toLowerCase());
}

/**
 * Cast a vote ON BEHALF OF `voter` using the bot's own posting key with node failover.
 *
 * @param {string} voter    - The enrolled user account casting the vote
 * @param {string} author   - Post author
 * @param {string} permlink - Post permlink
 * @param {number} weight   - Vote weight: 1 to 100 (upvote) or -1 to -100 (downvote)
 */
export async function voteOnBehalf({ voter, author, permlink, weight }) {
  const key = (BOT_POSTING_KEY || '').trim().replace(/^['"]/, '').replace(/['"]$/, '');
  if (!key) throw new Error('BOT_POSTING_KEY not configured in .env');

  const s = await steemJs();
  if (!s.auth.isWif(key)) {
    return { success: false, error: 'Invalid BOT_POSTING_KEY in .env (must be a valid 51-character Steem private posting key starting with 5)' };
  }

  const cleanVoter = (voter || '').toString().replace(/^@/, '').trim().toLowerCase();
  const cleanAuthor = (author || '').toString().replace(/^@/, '').trim().toLowerCase();
  const cleanPerm = (permlink || '').toString().trim();

  // Preserve vote direction: positive = upvote, negative = downvote
  const sign = weight < 0 ? -1 : 1;
  const absWeight = Math.min(100, Math.max(0.01, Math.abs(weight)));
  const steemWeight = Math.round(sign * absWeight * 100); // -10000 to -100 or 100 to 10000

  // Attempt broadcast with automated node failover
  let lastError = null;
  for (let attempt = 0; attempt < NODES.length; attempt++) {
    try {
      const currentNode = node();
      s.api.setOptions({ url: currentNode });

      const res = await new Promise((resolve) => {
        s.broadcast.vote(key, cleanVoter, cleanAuthor, cleanPerm, steemWeight, (err, result) => {
          if (err) {
            resolve({ success: false, error: err.message || String(err) });
          } else {
            resolve({ success: true, txId: result?.id || 'broadcast_ok' });
          }
        });
      });

      if (res.success) {
        return res;
      }

      const errMsg = res.error || '';

      // If blockchain states the vote is identical, the vote is ALREADY confirmed on-chain.
      // This happens if node 0 sent the transaction into the block/mempool but timed out before returning HTTP 200,
      // or if another trail leader previously triggered the same vote weight.
      if (errMsg.includes('identical to this vote')) {
        return { success: true, txId: 'confirmed_onchain' };
      }

      // If it's a permanent blockchain rejection (not an RPC network issue), don't failover
      if (
        errMsg.includes('STEEM_MIN_VOTE_INTERVAL_SEC') ||
        errMsg.includes('Can only vote once every 3 seconds') ||
        errMsg.includes('missing required posting authority') ||
        errMsg.includes('author') ||
        errMsg.includes('permlink')
      ) {
        return res;
      }

      // If network/RPC issue, rotate node and try again
      lastError = errMsg;
      rotate();
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      lastError = e.message || String(e);
      rotate();
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Final verification check: if all nodes failed or timed out at the HTTP layer,
  // query on-chain active votes to see if the transaction actually went through.
  try {
    const activeVotes = await getActiveVotes(cleanAuthor, cleanPerm);
    const matched = activeVotes.find(v => (v.voter || '').toLowerCase() === cleanVoter);
    if (matched && Math.abs(matched.percent - steemWeight) < 10) {
      return { success: true, txId: 'confirmed_onchain' };
    }
  } catch (verifyErr) {
    // Non-blocking verification failure
  }

  return { success: false, error: lastError || 'Broadcast failed across all RPC nodes' };
}

/**
 * Claim all pending rewards for `account` using the bot's posting key
 * (claim_reward_balance is a posting-authority operation).
 * Returns { success, claimed: false } when there is nothing to claim.
 */
export async function claimRewardsOnBehalf(account) {
  const key = (BOT_POSTING_KEY || '').trim().replace(/^['"]/, '').replace(/['"]$/, '');
  if (!key) return { success: false, error: 'BOT_POSTING_KEY not configured in .env' };

  const s = await steemJs();
  if (!s.auth.isWif(key)) return { success: false, error: 'Invalid BOT_POSTING_KEY in .env' };

  const acc = await getAccount(account);
  if (!acc) return { success: false, error: 'Account not found on blockchain' };

  const steem = acc.reward_steem_balance || '0.000 STEEM';
  const sbd   = acc.reward_sbd_balance   || '0.000 SBD';
  const vests = acc.reward_vesting_balance || '0.000000 VESTS';
  const globals = await getCachedGlobals().catch(() => null);
  const sp    = vestsToSp(vests, globals);
  const pending = { steem, sbd, vests, sp };
  if (parseFloat(steem) <= 0 && parseFloat(sbd) <= 0 && parseFloat(vests) <= 0) {
    return { success: true, claimed: false, ...pending };
  }

  let lastError = null;
  for (let attempt = 0; attempt < (autoFailover ? NODES.length : 2); attempt++) {
    s.api.setOptions({ url: node() });
    const res = await new Promise((resolve) => {
      s.broadcast.claimRewardBalance(key, account, steem, sbd, vests, (err, result) => {
        resolve(err ? { success: false, error: err.message || String(err) } : { success: true, txId: result?.id });
      });
    });
    if (res.success) return { success: true, claimed: true, txId: res.txId, ...pending };
    lastError = res.error;
    if ((lastError || '').includes('authority')) break;
    rotate();
    await new Promise(r => setTimeout(r, 400));
  }
  return { success: false, error: lastError || 'Claim failed', ...pending };
}

/**
 * Cryptographically verifies that a signature for a given message was produced by
 * a key authorized by the Steem account (posting, active, or owner keys).
 *
 * @param {string} message - Plaintext challenge message
 * @param {string} signatureHex - Hex-encoded ECDSA signature
 * @param {object} account - Raw Steem account object from blockchain
 * @returns {boolean} True if signature is valid and belongs to the account
 */
export function verifySignature(message, signatureHex, account) {
  if (!message || !signatureHex || !account) return false;
  try {
    const sig = Signature.fromHex(signatureHex);
    const recoveredPubKey = sig.recoverPublicKeyFromBuffer(message).toString();

    const postingKeys = (account.posting?.key_auths || []).map(([k]) => k);
    const activeKeys  = (account.active?.key_auths  || []).map(([k]) => k);
    const ownerKeys   = (account.owner?.key_auths   || []).map(([k]) => k);

    const authorizedKeys = [...postingKeys, ...activeKeys, ...ownerKeys];
    return authorizedKeys.includes(recoveredPubKey);
  } catch (err) {
    console.error('[steemClient] verifySignature error:', err.message);
    return false;
  }
}



