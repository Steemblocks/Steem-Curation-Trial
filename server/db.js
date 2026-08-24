import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = process.env.DB_PATH || path.join(__dirname, 'curation_trial.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
console.log('[DB] Connected:', DB_PATH);

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
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, trail_account),
      FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);

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

  // System state (k/v)
  db.exec(`CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT);`);
  db.prepare(`INSERT OR IGNORE INTO system_state (key, value) VALUES ('synced_block', '0')`).run();

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
  return db.prepare(`DELETE FROM users WHERE username = ?`).run(u);
}

// ── Followed trail methods (Multiple trails per user) ─────────────────────────

export function getUserTrails(username) {
  return db.prepare(`
    SELECT id, username, trail_account, weight, delay, min_vp, status, created_at, updated_at
    FROM user_trails
    WHERE username = ?
    ORDER BY created_at ASC
  `).all(username.toLowerCase());
}

export function addUserTrail({ username, trailAccount, weight = 100, delay = 0, minVp = 80 }) {
  const u = username.trim().toLowerCase();
  const t = trailAccount.trim().toLowerCase();
  
  const stmt = db.prepare(`
    INSERT INTO user_trails (username, trail_account, weight, delay, min_vp, status)
    VALUES (?, ?, ?, ?, ?, 'active')
    ON CONFLICT(username, trail_account) DO UPDATE SET
      weight     = excluded.weight,
      delay      = excluded.delay,
      min_vp     = excluded.min_vp,
      status     = 'active',
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(u, t, weight, delay, minVp);
  return getUserTrails(u);
}

export function updateUserTrail({ id, username, weight, delay, minVp, status }) {
  const u = username.trim().toLowerCase();
  const existing = db.prepare(`SELECT * FROM user_trails WHERE id = ? AND username = ?`).get(id, u);
  if (!existing) return null;

  db.prepare(`
    UPDATE user_trails SET
      weight     = COALESCE(?, weight),
      delay      = COALESCE(?, delay),
      min_vp     = COALESCE(?, min_vp),
      status     = COALESCE(?, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND username = ?
  `).run(
    weight !== undefined ? weight : null,
    delay !== undefined ? delay : null,
    minVp !== undefined ? minVp : null,
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
      t.min_vp
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

// ── Vote logs & stats ─────────────────────────────────────────────────────────

export function logVote({ leader, author, permlink, voter, weight, status, txId = null, error = null }) {
  return db.prepare(`
    INSERT INTO vote_logs (leader, author, permlink, voter, weight, status, tx_id, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(leader, author, permlink, voter, weight, status, txId, error);
}

export function getVoteLogs(limit = 50) {
  return db.prepare(`SELECT * FROM vote_logs ORDER BY timestamp DESC LIMIT ?`).all(limit);
}

export function getVoteStats() {
  return {
    totalVotes:    db.prepare(`SELECT COUNT(*) c FROM vote_logs WHERE status = 'SUCCESS'`).get().c,
    activeMembers: db.prepare(`SELECT COUNT(DISTINCT username) c FROM user_trails WHERE status = 'active'`).get().c,
  };
}

// ── System state ──────────────────────────────────────────────────────────────

export function getSystemState(key) {
  return db.prepare(`SELECT value FROM system_state WHERE key = ?`).get(key)?.value ?? null;
}
export function setSystemState(key, value) {
  db.prepare(`INSERT OR REPLACE INTO system_state (key, value) VALUES (?, ?)`).run(key, String(value));
}

export default db;
