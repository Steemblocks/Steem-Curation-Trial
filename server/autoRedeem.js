/**
 * autoRedeem.js
 * ─────────────
 * Claims pending Steem rewards (STEEM / SBD / SP) on behalf of enrolled users
 * using the bot's posting authority. Runs on each user's chosen interval.
 */

import { getDueRedeemers, markRedeemRun, logRedeem } from './db.js';
import { hasBotAuthority, claimRewardsOnBehalf, BOT_ACCOUNT } from './steemClient.js';

const CHECK_EVERY_MS = 10 * 60_000;
let started = false;

/** Claim now for one user and log the outcome. Returns the log-shaped result. */
export async function redeemNow(username, source = 'auto') {
  const u = username.toLowerCase();
  try {
    if (!BOT_ACCOUNT) throw new Error('BOT_ACCOUNT not set in .env');
    if (!(await hasBotAuthority(u))) {
      throw new Error(`@${BOT_ACCOUNT} not in posting_auths of @${u} — authority revoked?`);
    }
    const res = await claimRewardsOnBehalf(u);
    if (!res.success) throw new Error(res.error);
    const status = res.claimed ? 'CLAIMED' : 'NOTHING_TO_CLAIM';
    logRedeem({ username: u, steem: res.steem, sbd: res.sbd, vests: res.vests, status, source });
    markRedeemRun(u);
    return { success: true, status, steem: res.steem, sbd: res.sbd, vests: res.vests, sp: res.sp };
  } catch (err) {
    logRedeem({ username: u, status: 'FAILED', error: err.message, source });
    markRedeemRun(u); // avoid hammering a failing account every cycle
    return { success: false, status: 'FAILED', error: err.message };
  }
}

async function runDue() {
  try {
    for (const { username } of getDueRedeemers()) {
      console.log(`[AutoRedeem] Claiming rewards for @${username}`);
      await redeemNow(username, 'auto');
      await new Promise(r => setTimeout(r, 4000));
    }
  } catch (err) {
    console.error('[AutoRedeem] Scheduler error:', err.message);
  }
}

export function startAutoRedeem() {
  if (started) return;
  started = true;
  setTimeout(runDue, 15_000);
  setInterval(runDue, CHECK_EVERY_MS);
  console.log('[AutoRedeem] Scheduler started');
}
