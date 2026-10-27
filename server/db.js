import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let dbPath = process.env.DB_PATH;
if (!dbPath || !fs.existsSync(path.dirname(path.resolve(dbPath)))) {
  dbPath = path.join(__dirname, 'curation_trial.db');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
console.log('[DB] Connected:', dbPath);

export function initDb() {
  // Users table — stores user authentication & global status
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username              TEXT PRIMARY KEY,
      status                TEXT NOT NULL DEFAULT 'active',
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // User followed trails table — enables following multiple trail leaders
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_trails (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL,
      trail_account TEXT NOT NULL,
      weight        INTEGER NOT NULL DEFAULT 100,
      delay         INTEGER NOT NULL DEFAULT 0,
      min_vp        INTEGER NOT NULL DEFAULT 80,
      allow_upvotes INTEGER NOT NULL DEFAULT 1,
      allow_downvotes INTEGER NOT NULL DEFAULT 1,
      max_daily_votes INTEGER NOT NULL DEFAULT 0,
      whitelist     TEXT DEFAULT '',
      blacklist     TEXT DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, trail_account),
      FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);

  // Migration: add allow_upvotes/allow_downvotes if missing
  try {
    const trailColumns = db.prepare("PRAGMA table_info(user_trails)").all();
    if (!trailColumns.some(c => c.name === 'allow_upvotes')) {
      db.exec(`ALTER TABLE user_trails ADD COLUMN allow_upvotes INTEGER NOT NULL DEFAULT 1`);
      db.exec(`ALTER TABLE user_trails ADD COLUMN allow_downvotes INTEGER NOT NULL DEFAULT 1`);
      console.log('[DB] Added allow_upvotes/downvotes columns to user_trails');
    }
    if (!trailColumns.some(c => c.name === 'whitelist')) {
      db.exec(`ALTER TABLE user_trails ADD COLUMN whitelist TEXT DEFAULT ''`);
      db.exec(`ALTER TABLE user_trails ADD COLUMN blacklist TEXT DEFAULT ''`);
      console.log('[DB] Added whitelist/blacklist columns to user_trails');
    }
    if (!trailColumns.some(c => c.name === 'max_daily_votes')) {
      db.exec(`ALTER TABLE user_trails ADD COLUMN max_daily_votes INTEGER NOT NULL DEFAULT 0`);
      console.log('[DB] Added max_daily_votes column to user_trails');
    }
  } catch (err) {
    console.warn('[DB Migration] Note:', err.message);
  }

  // Migration: if existing users have trail_account in older schema, migrate them
  try {
    const legacyColumns = db.prepare("PRAGMA table_info(users)").all();
    const hasLegacyTrail = legacyColumns.some(c => c.name === 'trail_account');
    if (hasLegacyTrail) {
      const oldUsers = db.prepare("SELECT username, trail_account, weight, delay, min_vp FROM users WHERE trail_account IS NOT NULL").all();
      for (const u of oldUsers) {
        if (u.trail_account) {
          db.prepare(`
            INSERT OR IGNORE INTO user_trails (username, trail_account, weight, delay, min_vp, status)
            VALUES (?, ?, ?, ?, ?, 'active')
          `).run(u.username, u.trail_account.toLowerCase(), u.weight || 100, u.delay || 0, u.min_vp || 80);
        }
      }
    }
  } catch (err) {
    console.warn('[DB Migration] Note:', err.message);
  }

  // Vote logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS vote_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      leader     TEXT NOT NULL,
      author     TEXT NOT NULL,
      permlink   TEXT NOT NULL,
      voter      TEXT NOT NULL,
      weight     INTEGER NOT NULL,
      status     TEXT NOT NULL,
      tx_id      TEXT,
      error      TEXT,
      timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Auto-vote targets — users vote directly on any author's new posts
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_vote_targets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT NOT NULL,
      target_author   TEXT NOT NULL,
      weight          INTEGER NOT NULL DEFAULT 100,
      delay           INTEGER NOT NULL DEFAULT 0,
      min_vp          INTEGER NOT NULL DEFAULT 80,
      max_daily_votes INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, target_author),
      FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);

  // Auto-redeem (auto-claim rewards) settings + history
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_redeem (
      username       TEXT PRIMARY KEY,
      enabled        INTEGER NOT NULL DEFAULT 0,
      interval_hours INTEGER NOT NULL DEFAULT 24,
      last_run       DATETIME,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS redeem_logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT NOT NULL,
      steem     TEXT,
      sbd       TEXT,
      vests     TEXT,
      status    TEXT NOT NULL,
      error     TEXT,
      source    TEXT NOT NULL DEFAULT 'auto',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // System state (k/v)
  db.exec(`CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT);`);
  db.prepare(`INSERT OR IGNORE INTO system_state (key, value) VALUES ('synced_block', '0')`).run();

  // Migration: heal historical false-failure logs where vote actually succeeded on blockchain (identical vote assertion)
  try {
    const fixed = db.prepare(`
      UPDATE vote_logs 
      SET status = 'SUCCESS', error = NULL, tx_id = COALESCE(tx_id, 'confirmed_onchain')
      WHERE status = 'FAILED' AND error LIKE '%identical to this vote%'
    `).run();
    if (fixed.changes > 0) {
      console.log(`[DB Migration] Healed ${fixed.changes} historical vote log(s) that succeeded on blockchain.`);
    }
  } catch (err) {
    console.warn('[DB Migration] Note:', err.message);
  }

  // Migration: sanitize historical blacklist logs to protect privacy
  try {
    const sanitized = db.prepare(`
      UPDATE vote_logs 
      SET status = 'SKIPPED', error = NULL
      WHERE status = 'SKIPPED_BLACKLIST' OR error LIKE '%blacklist%'
    `).run();
    if (sanitized.changes > 0) {
      console.log(`[DB Migration] Sanitized ${sanitized.changes} historical blacklist vote log(s) for privacy.`);
    }
  } catch (err) {
    console.warn('[DB Migration] Note:', err.message);
  }

  // Migration (security): purge legacy encrypted posting keys. The app now uses
  // posting authority only, so these are never read — wipe them from disk entirely.
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all();
    if (userCols.some(c => c.name === 'posting_key_encrypted')) {
      db.pragma('secure_delete = ON');                       // zero freed pages instead of leaving data behind
      db.exec(`UPDATE users SET posting_key_encrypted = NULL`);
      db.exec(`ALTER TABLE users DROP COLUMN posting_key_encrypted`);
      db.pragma('wal_checkpoint(TRUNCATE)');                  // flush + empty the WAL (it held old copies)
      db.exec('VACUUM');                                      // rewrite the file so no residue remains
      db.pragma('wal_checkpoint(TRUNCATE)');
      console.log('[DB Migration] Purged legacy posting_key_encrypted column.');
    }
  } catch (err) {
    console.warn('[DB Migration] Key purge note:', err.message);
  }

  console.log('[DB] Multi-trail tables ready.');
}

// ── User account methods ──────────────────────────────────────────────────────

export function getUser(username) {
  return db.prepare(`SELECT username, status, created_at, updated_at FROM users WHERE username = ?`).get(username.toLowerCase());
}

export function getAllUsers() {
  return db.prepare(`SELECT username, status, created_at FROM users ORDER BY created_at DESC`).all();
}

export function upsertUserAccount({ username }) {
  const u = username.trim().toLowerCase();
  const existing = getUser(u);

  if (existing) {
    db.prepare(`
      UPDATE users SET
        status                = 'active',
        updated_at            = CURRENT_TIMESTAMP
      WHERE username = ?
    `).run(u);
  } else {
    db.prepare(`
      INSERT INTO users (username, status)
      VALUES (?, 'active')
    `).run(u);
  }
  return getUser(u);
}

export function updateUserStatus(username, status) {
  const u = username.trim().toLowerCase();
  db.prepare(`UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`).run(status, u);
  return getUser(u);
}

export function deleteUser(username) {
  const u = username.toLowerCase();
  db.prepare(`DELETE FROM user_trails WHERE username = ?`).run(u);
  db.prepare(`DELETE FROM auto_vote_targets WHERE username = ?`).run(u);
  db.prepare(`DELETE FROM auto_redeem WHERE username = ?`).run(u);
  db.prepare(`DELETE FROM redeem_logs WHERE username = ?`).run(u);
  return db.prepare(`DELETE FROM users WHERE username = ?`).run(u);
}

// ── Followed trail methods (Multiple trails per user) ─────────────────────────

export function getUserTrails(username) {
  return db.prepare(`
    SELECT id, username, trail_account, weight, delay, min_vp, allow_upvotes, allow_downvotes, max_daily_votes, whitelist, blacklist, status, created_at, updated_at
    FROM user_trails
    WHERE username = ?
    ORDER BY created_at ASC
  `).all(username.toLowerCase());
}

export function addUserTrail({ username, trailAccount, weight = 100, delay = 0, minVp = 80, allowUpvotes = 1, allowDownvotes = 1, maxDailyVotes = 0, whitelist = '', blacklist = '' }) {
  const u = username.trim().toLowerCase();
  const t = trailAccount.trim().toLowerCase();
  
  const stmt = db.prepare(`
    INSERT INTO user_trails (username, trail_account, weight, delay, min_vp, allow_upvotes, allow_downvotes, max_daily_votes, whitelist, blacklist, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    ON CONFLICT(username, trail_account) DO UPDATE SET
      weight     = excluded.weight,
      delay      = excluded.delay,
      min_vp     = excluded.min_vp,
      allow_upvotes = excluded.allow_upvotes,
      allow_downvotes = excluded.allow_downvotes,
      max_daily_votes = excluded.max_daily_votes,
      whitelist  = excluded.whitelist,
      blacklist  = excluded.blacklist,
      status     = 'active',
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(u, t, weight, delay, minVp, allowUpvotes, allowDownvotes, maxDailyVotes, whitelist, blacklist);
  return getUserTrails(u);
}

export function updateUserTrail({ id, username, weight, delay, minVp, allowUpvotes, allowDownvotes, maxDailyVotes, whitelist, blacklist, status }) {
  const u = username.trim().toLowerCase();
  const existing = db.prepare(`SELECT * FROM user_trails WHERE id = ? AND username = ?`).get(id, u);
  if (!existing) return null;

  db.prepare(`
    UPDATE user_trails SET
      weight     = COALESCE(?, weight),
      delay      = COALESCE(?, delay),
      min_vp     = COALESCE(?, min_vp),
      allow_upvotes = COALESCE(?, allow_upvotes),
      allow_downvotes = COALESCE(?, allow_downvotes),
      max_daily_votes = COALESCE(?, max_daily_votes),
      whitelist  = COALESCE(?, whitelist),
      blacklist  = COALESCE(?, blacklist),
      status     = COALESCE(?, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND username = ?
  `).run(
    weight !== undefined ? weight : null,
    delay !== undefined ? delay : null,
    minVp !== undefined ? minVp : null,
    allowUpvotes !== undefined ? allowUpvotes : null,
    allowDownvotes !== undefined ? allowDownvotes : null,
    maxDailyVotes !== undefined ? maxDailyVotes : null,
    whitelist !== undefined ? whitelist : null,
    blacklist !== undefined ? blacklist : null,
    status !== undefined ? status : null,
    id,
    u
  );

  return getUserTrails(u);
}

export function deleteUserTrail({ id, username }) {
  const u = username.trim().toLowerCase();
  db.prepare(`DELETE FROM user_trails WHERE id = ? AND username = ?`).run(id, u);
  return getUserTrails(u);
}

/**
 * Get all active followers for a specific leader account.
 * Joins user_trails with users to ensure both user account and trail subscription are active.
 */
export function getActiveFollowers(trailAccount) {
  return db.prepare(`
    SELECT 
      u.username,
      t.id as trail_id,
      t.trail_account,
      t.weight,
      t.delay,
      t.min_vp,
      t.allow_upvotes,
      t.allow_downvotes,
      t.max_daily_votes,
      t.whitelist,
      t.blacklist
    FROM user_trails t
    JOIN users u ON u.username = t.username
    WHERE t.status = 'active' 
      AND u.status = 'active'
      AND t.trail_account = ?
  `).all(trailAccount.toLowerCase());
}

/**
 * Get all distinct leader accounts currently followed by active users.
 */
export function getWatchedAccounts() {
  const rows = db.prepare(`
    SELECT DISTINCT t.trail_account
    FROM user_trails t
    JOIN users u ON u.username = t.username
    WHERE t.status = 'active' AND u.status = 'active'
  `).all();
  return rows.map(r => r.trail_account);
}

// ── Auto-vote target methods ──────────────────────────────────────────────────

const TARGET_COLS = `id, username, target_author, weight, delay, min_vp, max_daily_votes, status, created_at, updated_at`;

export function getAutoVoteTargets(username) {
  return db.prepare(`SELECT ${TARGET_COLS} FROM auto_vote_targets WHERE username = ? ORDER BY created_at ASC`).all(username.toLowerCase());
}

export function addAutoVoteTarget({ username, targetAuthor, weight = 100, delay = 0, minVp = 80, maxDailyVotes = 0 }) {
  const u = username.trim().toLowerCase();
  const a = targetAuthor.trim().toLowerCase();
  db.prepare(`
    INSERT INTO auto_vote_targets (username, target_author, weight, delay, min_vp, max_daily_votes, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
    ON CONFLICT(username, target_author) DO UPDATE SET
      weight = excluded.weight, delay = excluded.delay, min_vp = excluded.min_vp,
      max_daily_votes = excluded.max_daily_votes, status = 'active', updated_at = CURRENT_TIMESTAMP
  `).run(u, a, weight, delay, minVp, maxDailyVotes);
  return getAutoVoteTargets(u);
}

export function updateAutoVoteTarget({ id, username, weight, delay, minVp, maxDailyVotes, status }) {
  const u = username.trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM auto_vote_targets WHERE id = ? AND username = ?`).get(id, u);
  if (!existing) return null;
  db.prepare(`
    UPDATE auto_vote_targets SET
      weight = COALESCE(?, weight),
      delay = COALESCE(?, delay),
      min_vp = COALESCE(?, min_vp),
      max_daily_votes = COALESCE(?, max_daily_votes),
      status = COALESCE(?, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND username = ?
  `).run(
    weight ?? null, delay ?? null, minVp ?? null, maxDailyVotes ?? null, status ?? null, id, u
  );
  return getAutoVoteTargets(u);
}

export function deleteAutoVoteTarget({ id, username }) {
  const u = username.trim().toLowerCase();
  db.prepare(`DELETE FROM auto_vote_targets WHERE id = ? AND username = ?`).run(id, u);
  return getAutoVoteTargets(u);
}

/** Active targets watching a given author (joined with active users). */
export function getActiveAutoVoters(author) {
  return db.prepare(`
    SELECT u.username, t.id as target_id, t.target_author, t.weight, t.delay, t.min_vp, t.max_daily_votes
    FROM auto_vote_targets t
    JOIN users u ON u.username = t.username
    WHERE t.status = 'active' AND u.status = 'active' AND t.target_author = ?
  `).all(author.toLowerCase());
}

export function getAutoVoteWatchedAuthors() {
  return db.prepare(`
    SELECT DISTINCT t.target_author FROM auto_vote_targets t
    JOIN users u ON u.username = t.username
    WHERE t.status = 'active' AND u.status = 'active'
  `).all().map(r => r.target_author);
}

/** Has this voter already got an auto-vote log row for this post? (dedupe) */
export function hasAutoVoteLog(voter, author, permlink) {
  return !!db.prepare(`
    SELECT 1 FROM vote_logs WHERE voter = ? AND author = ? AND permlink = ? AND leader LIKE 'auto:%' LIMIT 1
  `).get(voter.toLowerCase(), author.toLowerCase(), permlink);
}

/** Recent auto-vote activity for a user, plus per-author counts. */
export function getAutoVoteActivity(username, limit = 50) {
  const u = username.toLowerCase();
  const logs = db.prepare(`
    SELECT * FROM vote_logs WHERE voter = ? AND leader LIKE 'auto:%' ORDER BY timestamp DESC, id DESC LIMIT ?
  `).all(u, limit);
  const perAuthor = db.prepare(`
    SELECT author, COUNT(*) as total,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success
    FROM vote_logs WHERE voter = ? AND leader LIKE 'auto:%' GROUP BY author
  `).all(u);
  return { logs, perAuthor };
}

// ── Vote logs & stats ─────────────────────────────────────────────────────────

export function logVote({ leader, author, permlink, voter, weight, status, txId = null, error = null }) {
  return db.prepare(`
    INSERT INTO vote_logs (leader, author, permlink, voter, weight, status, tx_id, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(leader, author, permlink, voter, weight, status, txId, error);
}

export function getDailyVoteCount(voter, leader) {
  const result = db.prepare(`
    SELECT COUNT(*) as c FROM vote_logs 
    WHERE voter = ? AND leader = ? AND status = 'SUCCESS' 
      AND timestamp >= datetime('now', '-1 day')
  `).get(voter.toLowerCase(), leader.toLowerCase());
  return result?.c ?? 0;
}

export function getVoteLogs(opts = 50, maybeOffset = 0) {
  let limit = 50;
  let offset = 0;
  let username = null;
  if (typeof opts === 'number') {
    limit = opts;
    offset = typeof maybeOffset === 'number' ? maybeOffset : 0;
  } else if (opts && typeof opts === 'object') {
    limit = typeof opts.limit === 'number' ? opts.limit : 50;
    offset = typeof opts.offset === 'number' ? opts.offset : 0;
    username = opts.username || null;
  }
  if (username) {
    return db.prepare(`SELECT * FROM vote_logs WHERE voter = ? ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`).all(username.toLowerCase(), limit, offset);
  }
  return db.prepare(`SELECT * FROM vote_logs ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset);
}

export function getTotalVoteLogsCount(username = null) {
  if (username) {
    return db.prepare(`SELECT COUNT(*) c FROM vote_logs WHERE voter = ?`).get(username.toLowerCase())?.c ?? 0;
  }
  return db.prepare(`SELECT COUNT(*) c FROM vote_logs`).get()?.c ?? 0;
}

export function getVoteStats() {
  return {
    totalVotes:    db.prepare(`SELECT COUNT(*) c FROM vote_logs WHERE status = 'SUCCESS'`).get().c,
    // Must match getDashboardStats().activeUsers — only count globally active users
    activeMembers: db.prepare(`SELECT COUNT(*) c FROM users WHERE status = 'active'`).get().c,
  };
}

// ── Dashboard aggregate stats ────────────────────────────────────────────────

/**
 * @param {number} tzOffsetMin - viewer's offset from UTC in minutes (e.g. +360 for UTC+6).
 *   Timestamps are stored in UTC; this shifts day boundaries to the viewer's local midnight.
 */
export function getDashboardStats(tzOffsetMin = 0, username = null) {
  const tz = Number.isInteger(tzOffsetMin) && Math.abs(tzOffsetMin) <= 840 ? tzOffsetMin : 0;
  const mod = `${tz >= 0 ? '+' : ''}${tz} minutes`; // SQLite date modifier

  // When username is provided, scope all vote_logs queries to that user
  const userFilter = username ? 'AND voter = @user' : '';
  const userParam = username ? { user: username.toLowerCase() } : {};

  // Overall vote status breakdown
  const breakdown = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'SUCCESS'            THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 'FAILED'             THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status LIKE 'SKIPPED%'        THEN 1 ELSE 0 END) as skipped,
      COUNT(*)                                                       as total
    FROM vote_logs
    WHERE 1=1 ${userFilter}
  `).get(userParam) || { success: 0, failed: 0, skipped: 0, total: 0 };

  // Per-leader stats (top 10 by total attempts)
  const leaderStats = db.prepare(`
    SELECT
      leader,
      COUNT(*)                                                    as total,
      SUM(CASE WHEN status = 'SUCCESS'     THEN 1 ELSE 0 END)    as success,
      SUM(CASE WHEN status = 'FAILED'      THEN 1 ELSE 0 END)    as failed,
      SUM(CASE WHEN status LIKE 'SKIPPED%' THEN 1 ELSE 0 END)    as skipped
    FROM vote_logs
    WHERE 1=1 ${userFilter}
    GROUP BY leader
    ORDER BY total DESC
    LIMIT 10
  `).all(userParam);

  // Daily votes — last 7 local calendar days (today + 6 previous)
  const dailyVotes = db.prepare(`
    SELECT
      date(timestamp, @mod) as date,
      COUNT(*)                                                    as total,
      SUM(CASE WHEN status = 'SUCCESS'     THEN 1 ELSE 0 END)    as success,
      SUM(CASE WHEN status = 'FAILED'      THEN 1 ELSE 0 END)    as failed,
      SUM(CASE WHEN status LIKE 'SKIPPED%' THEN 1 ELSE 0 END)    as skipped
    FROM vote_logs
    WHERE date(timestamp, @mod) >= date('now', @mod, '-6 days') ${userFilter}
    GROUP BY date(timestamp, @mod)
    ORDER BY date ASC
  `).all({ mod, ...userParam });

  // Today's successful votes (since local midnight)
  const todaySuccess = db.prepare(`
    SELECT COUNT(*) as c FROM vote_logs
    WHERE status = 'SUCCESS' AND date(timestamp, @mod) = date('now', @mod) ${userFilter}
  `).get({ mod, ...userParam })?.c ?? 0;

  // This week's successful votes — same 7-day window as the chart
  const weekSuccess = db.prepare(`
    SELECT COUNT(*) as c FROM vote_logs
    WHERE status = 'SUCCESS' AND date(timestamp, @mod) >= date('now', @mod, '-6 days') ${userFilter}
  `).get({ mod, ...userParam })?.c ?? 0;

  // Active enrolled user count (app-wide)
  const activeUsers = db.prepare(`
    SELECT COUNT(DISTINCT username) as c FROM users WHERE status = 'active'
  `).get()?.c ?? 0;

  // Distinct trail leaders followed across the entire app
  const followedLeaders = db.prepare(`
    SELECT COUNT(DISTINCT trail_account) as c FROM user_trails
    WHERE status = 'active'
  `).get()?.c ?? 0;

  return { breakdown, leaderStats, dailyVotes, todaySuccess, weekSuccess, activeUsers, followedLeaders };
}

// ── System state ──────────────────────────────────────────────────────────────

// ── Auto-redeem ──────────────────────────────────────────────────────────────────────────────────

export function getAutoRedeem(username) {
  const u = username.toLowerCase();
  return db.prepare(`SELECT username, enabled, interval_hours, last_run FROM auto_redeem WHERE username = ?`).get(u)
    || { username: u, enabled: 0, interval_hours: 24, last_run: null };
}

export function saveAutoRedeem({ username, enabled, intervalHours }) {
  const u = username.toLowerCase();
  db.prepare(`
    INSERT INTO auto_redeem (username, enabled, interval_hours) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET enabled = excluded.enabled, interval_hours = excluded.interval_hours, updated_at = CURRENT_TIMESTAMP
  `).run(u, enabled ? 1 : 0, intervalHours);
  return getAutoRedeem(u);
}

export function markRedeemRun(username) {
  db.prepare(`
    INSERT INTO auto_redeem (username, enabled, interval_hours, last_run) VALUES (?, 0, 24, CURRENT_TIMESTAMP)
    ON CONFLICT(username) DO UPDATE SET last_run = CURRENT_TIMESTAMP
  `).run(username.toLowerCase());
}

/** Enabled users whose interval has elapsed (or that never ran). */
export function getDueRedeemers() {
  return db.prepare(`
    SELECT r.username, r.interval_hours FROM auto_redeem r
    JOIN users u ON u.username = r.username
    WHERE r.enabled = 1 AND u.status = 'active'
      AND (r.last_run IS NULL OR r.last_run <= datetime('now', '-' || r.interval_hours || ' hours'))
  `).all();
}

export function logRedeem({ username, steem = null, sbd = null, vests = null, status, error = null, source = 'auto' }) {
  return db.prepare(`
    INSERT INTO redeem_logs (username, steem, sbd, vests, status, error, source) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username.toLowerCase(), steem, sbd, vests, status, error, source);
}

export function getRedeemLogs(username, limit = 20) {
  return db.prepare(`SELECT * FROM redeem_logs WHERE username = ? ORDER BY timestamp DESC, id DESC LIMIT ?`).all(username.toLowerCase(), limit);
}

// ── System state ───────────────────────────────────────────────────────────────────────────────────

export function getSystemState(key) {
  return db.prepare(`SELECT value FROM system_state WHERE key = ?`).get(key)?.value ?? null;
}
export function setSystemState(key, value) {
  db.prepare(`INSERT OR REPLACE INTO system_state (key, value) VALUES (?, ?)`).run(key, String(value));
}

export default db;
