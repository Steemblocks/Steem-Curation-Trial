import dotenv from 'dotenv';
dotenv.config();

const SECRET         = process.env.ENCRYPTION_KEY || 'dhaka_curation_trial_secret_2026';
export const BOT_ACCOUNT    = (process.env.BOT_ACCOUNT    || '').toLowerCase();
export const BOT_POSTING_KEY = process.env.BOT_POSTING_KEY || '';
export const TRAIL_LEADER    = (process.env.TRAIL_LEADER   || 'dhaka.witness').toLowerCase();

// ── Steem RPC nodes (with automated failover) ─────────────────────────────────
const NODES = [
  'https://api.steemit.com',
  'https://api.justyy.com',
  'https://api.steem.fans',
  'https://steem.justyy.com',
  'https://steem.bts.tw',
];
let ni = 0;
const node = () => NODES[ni];
const rotate = () => { ni = (ni + 1) % NODES.length; };

// ── Raw JSON-RPC call ─────────────────────────────────────────────────────────
export async function rpc(method, params = []) {
  for (let t = 0; t < NODES.length; t++) {
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
  throw new Error('All Steem RPC nodes failed');
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

  return 100;
}

// ── Reputation ────────────────────────────────────────────────────────────────
export function formatRep(raw) {
  const r = parseFloat(raw);
  if (!r) return 25;
  const sign = r < 0 ? -1 : 1;
  const v = (Math.log10(Math.abs(r)) - 9) * 9 + 25;
  return Math.max(0, Math.floor(sign < 0 ? 50 - v : v));
}

// ── Head block info ───────────────────────────────────────────────────────────
export async function getGlobals() {
  return rpc('condenser_api.get_dynamic_global_properties', []);
}

// ── Fetch complete Block with Transactions & Operations ───────────────────────
export async function getBlock(blockNum) {
  try {
    return await rpc('condenser_api.get_block', [blockNum]);
  } catch (err) {
    return null;
  }
}

// ── steem-js lazy loader ──────────────────────────────────────────────────────
let _steem = null;
async function steemJs() {
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
 * Cast a vote ON BEHALF OF `voter` using the bot's own posting key.
 *
 * @param {string} voter    - The enrolled user account casting the vote
 * @param {string} author   - Post author
 * @param {string} permlink - Post permlink
 * @param {number} weight   - Vote weight 1-100 (%)
 */
export async function voteOnBehalf({ voter, author, permlink, weight }) {
  if (!BOT_POSTING_KEY) throw new Error('BOT_POSTING_KEY not set in .env');
  const steemWeight = Math.round(Math.min(100, Math.max(1, weight)) * 100);
  const s = await steemJs();
  s.api.setOptions({ url: node() });

  return new Promise(resolve => {
    s.broadcast.vote(BOT_POSTING_KEY, voter, author, permlink, steemWeight, (err, result) => {
      if (err) resolve({ success: false, error: err.message || String(err) });
      else     resolve({ success: true,  txId: result?.id ?? 'ok' });
    });
  });
}



