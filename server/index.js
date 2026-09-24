import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors    from 'cors';
import helmet  from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv  from 'dotenv';
dotenv.config();

import {
  initDb, getAllUsers, getUser, upsertUserAccount,
  getUserTrails, addUserTrail, updateUserTrail, deleteUserTrail,
  updateUserStatus, deleteUser, getVoteLogs, getTotalVoteLogsCount, getVoteStats
} from './db.js';
import { getAccount, calcVP, formatRep, hasBotAuthority, BOT_ACCOUNT } from './steemClient.js';
import { startStreamer, getSyncedBlock, getWatchedSet, refreshWatched } from './steemStreamer.js';
import { initWs, broadcast, broadcastAll, getSubscribedUsers } from './wsHub.js';
import { generateToken, requireAuth, requireSelf } from './auth.js';

const app  = express();
const server = createServer(app);
const PORT = process.env.PORT || 5000;

// ── Valid status values (whitelist) ───────────────────────────────────────────
const VALID_STATUSES = ['active', 'paused'];

// ── Security Middleware ───────────────────────────────────────────────────────

// Security headers (CSP, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP to avoid breaking frontend CDN scripts (steem.js)
}));

// CORS — restrict to allowed origins
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null; // null = allow all in development; set in production .env

app.use(cors(ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : undefined));

// JSON body size limit (prevent memory exhaustion)
app.use(express.json({ limit: '10kb' }));

// Global rate limiter — 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again shortly.' },
});
app.use('/api/', apiLimiter);

// Stricter rate limit for auth endpoints — 15 attempts per minute per IP
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please wait a moment.' },
});

// Admin secret for protected endpoints (simulate-vote)
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

initDb();
initWs(server);
startStreamer();

// ── Helper ────────────────────────────────────────────────────────────────────
async function buildProfile(username) {
  const acc = await getAccount(username);
  if (!acc) return null;
  return {
    name:        acc.name,
    reputation:  formatRep(acc.reputation),
    votingPower: parseFloat(calcVP(acc).toFixed(1)),
    postCount:   acc.post_count,
    created:     acc.created,
    posting: {
      weight_threshold: acc.posting?.weight_threshold || 1,
      account_auths:    acc.posting?.account_auths || [],
      key_auths:        acc.posting?.key_auths || [],
    },
    memoKey:      acc.memo_key,
    jsonMetadata: acc.json_metadata,
  };
}

/** Safe error response — logs full error server-side, returns generic message to client */
function safeError(res, e, context = 'API') {
  console.error(`[${context}] Error:`, e.message || e);
  res.status(500).json({ success: false, error: 'An internal error occurred. Please try again.' });
}

/** Push full user state to all WS clients subscribed to this username */
async function broadcastUserUpdate(username) {
  try {
    const user = getUser(username);
    const profile = await buildProfile(username).catch(() => null);
    const trails = getUserTrails(username);
    const hasAuth = profile
      ? (profile.posting?.account_auths ?? []).some(([a]) => a.toLowerCase() === BOT_ACCOUNT.toLowerCase())
      : false;
    broadcast('user', { username, user, steemProfile: profile, hasAuthority: hasAuth, trails }, username);
  } catch (e) {
    console.error('[WS] broadcastUserUpdate error:', e.message);
  }
}

/** Push status + logs to all connected WS clients */
function broadcastStatusAndLogs() {
  try {
    const stats = getVoteStats();
    broadcastAll('status', {
      botAccount: BOT_ACCOUNT || null,
      syncedBlock: getSyncedBlock(),
      watchedLeaders: [...getWatchedSet()],
      activeMembers: stats.activeMembers,
      totalVotes: stats.totalVotes,
    });
    broadcastAll('logs', getVoteLogs(30));

    // Push live user profile updates (for Voting Power) to currently subscribed clients
    const activeUsers = getSubscribedUsers();
    activeUsers.forEach(u => broadcastUserUpdate(u));
  } catch (e) {
    console.error('[WS] broadcastStatusAndLogs error:', e.message);
  }
}

// Push status/logs on a relaxed interval (every 6 seconds instead of client polling every 4s)
setInterval(broadcastStatusAndLogs, 6000);

// ── Public Routes (no auth required) ──────────────────────────────────────────

// Status
app.get('/api/status', async (req, res) => {
  try {
    const stats = getVoteStats();
    res.json({
      success:        true,
      botAccount:     BOT_ACCOUNT || null,
      syncedBlock:    getSyncedBlock(),
      watchedLeaders: [...getWatchedSet()],
      activeMembers:  stats.activeMembers,
      totalVotes:     stats.totalVotes,
    });
  } catch (e) { safeError(res, e, 'Status'); }
});

// Logs
app.get('/api/logs', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 200);
    const offset = req.query.offset !== undefined ? parseInt(req.query.offset, 10) : (page - 1) * limit;

    const total = getTotalVoteLogsCount();
    const logs = getVoteLogs({ limit, offset });
    const totalPages = Math.ceil(total / limit) || 1;

    res.json({
      success: true,
      logs,
      total,
      page,
      limit,
      totalPages
    });
  } catch (e) { safeError(res, e, 'Logs'); }
});

// Verify a Steem account exists on blockchain
app.get('/api/verify/:username', async (req, res) => {
  try {
    const username = req.params.username.trim().toLowerCase();
    const profile = await buildProfile(username);
    if (!profile) return res.status(404).json({ success: false, error: `@${username} not found on Steem blockchain` });
    res.json({ success: true, profile });
  } catch (e) { safeError(res, e, 'Verify'); }
});

// Single user info + live Steem profile + followed trails
app.get('/api/user/:username', async (req, res) => {
  try {
    const username   = req.params.username.toLowerCase();
    const trialUser  = getUser(username);
    const profile    = await buildProfile(username).catch(() => null);
    const hasAuth    = profile
      ? (profile.posting?.account_auths ?? []).some(([a]) => a.toLowerCase() === BOT_ACCOUNT.toLowerCase())
      : false;
    const trails     = getUserTrails(username);

    res.json({ 
      success: true, 
      inTrial: !!trialUser, 
      user: trialUser ?? null, 
      steemProfile: profile, 
      hasAuthority: hasAuth,
      trails: trails || []
    });
  } catch (e) { safeError(res, e, 'User'); }
});

// ── Authentication Routes ─────────────────────────────────────────────────────

// Universal Login / Join handler (handles both /api/login and /api/join)
const handleAuthLogin = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username?.trim()) return res.status(400).json({ success: false, error: 'Username required' });

    const clean = username.trim().toLowerCase();

    // Verify account exists on Steem
    const profile = await buildProfile(clean);
    if (!profile) return res.status(404).json({ success: false, error: `@${clean} not found on Steem blockchain` });

    const user = upsertUserAccount({ username: clean });
    const trails = getUserTrails(clean);

    // Generate JWT token for authenticated session
    const token = generateToken(clean);

    refreshWatched();
    res.json({ success: true, message: 'Logged in successfully', user, steemProfile: profile, trails, token });
    // Push initial state to any WS clients that may subscribe
    broadcastUserUpdate(clean);
  } catch (e) { safeError(res, e, 'Login'); }
};

app.post('/api/login', authLimiter, handleAuthLogin);
app.post('/api/join', authLimiter, handleAuthLogin);

// ── Protected Routes (JWT auth + self-verification required) ──────────────────

// 1. Add followed trail
app.post('/api/trails/add', requireAuth, requireSelf, async (req, res) => {
  try {
    const { username, trailAccount, weight = 100, delay = 0, minVp = 80 } = req.body;
    if (!trailAccount) return res.status(400).json({ success: false, error: 'Trail account required' });

    const cleanUser  = username.trim().toLowerCase();
    const cleanTrail = trailAccount.trim().toLowerCase();

    // Verify trail target exists on Steem
    const trailProfile = await buildProfile(cleanTrail);
    if (!trailProfile) {
      return res.status(404).json({ success: false, error: `Account @${cleanTrail} does not exist on Steem blockchain` });
    }

    const trails = addUserTrail({
      username: cleanUser,
      trailAccount: cleanTrail,
      weight: Math.min(100, Math.max(1, parseInt(weight, 10) || 100)),
      delay: Math.min(60, Math.max(0, parseInt(delay, 10) || 0)),
      minVp: Math.min(99, Math.max(10, parseInt(minVp, 10) || 80))
    });

    refreshWatched();
    res.json({ success: true, message: `Now following @${cleanTrail}`, trails });
    broadcastUserUpdate(cleanUser);
  } catch (e) { safeError(res, e, 'TrailAdd'); }
});

// 2. Update specific followed trail
app.post('/api/trails/update', requireAuth, requireSelf, (req, res) => {
  try {
    const { id, username, weight, delay, minVp, status } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'Trail ID required' });

    // Validate status if provided
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const trails = updateUserTrail({
      id: parseInt(id, 10),
      username,
      weight: weight !== undefined ? Math.min(100, Math.max(1, parseInt(weight, 10))) : undefined,
      delay: delay !== undefined ? Math.min(60, Math.max(0, parseInt(delay, 10))) : undefined,
      minVp: minVp !== undefined ? Math.min(99, Math.max(10, parseInt(minVp, 10))) : undefined,
      status: status || undefined
    });

    refreshWatched();
    res.json({ success: true, message: 'Trail settings updated', trails });
    broadcastUserUpdate(username);
  } catch (e) { safeError(res, e, 'TrailUpdate'); }
});

// 3. Remove a specific followed trail
app.post('/api/trails/remove', requireAuth, requireSelf, (req, res) => {
  try {
    const { id, username } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'Trail ID required' });

    const trails = deleteUserTrail({ id: parseInt(id, 10), username });
    refreshWatched();
    res.json({ success: true, message: 'Unfollowed trail account', trails });
    broadcastUserUpdate(username);
  } catch (e) { safeError(res, e, 'TrailRemove'); }
});

// 4. Toggle specific trail (Active/Paused)
app.post('/api/trails/toggle', requireAuth, requireSelf, (req, res) => {
  try {
    const { id, username, status } = req.body;
    if (!id || !status) return res.status(400).json({ success: false, error: 'Trail ID and status required' });

    // Validate status
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const trails = updateUserTrail({
      id: parseInt(id, 10),
      username,
      status
    });

    refreshWatched();
    res.json({ success: true, trails });
    broadcastUserUpdate(username);
  } catch (e) { safeError(res, e, 'TrailToggle'); }
});

// 5. Global user account pause / resume
app.post('/api/toggle-status', requireAuth, requireSelf, (req, res) => {
  try {
    const { username, status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'Status required' });

    // Validate status
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const user = updateUserStatus(username, status);
    refreshWatched();
    res.json({ success: true, user });
    broadcastUserUpdate(username);
  } catch (e) { safeError(res, e, 'ToggleStatus'); }
});

// 6. Delete user account & all followed trails
app.post('/api/leave', requireAuth, requireSelf, (req, res) => {
  try {
    const { username } = req.body;
    deleteUser(username);
    refreshWatched();
    res.json({ success: true, message: `Account @${username} removed from curation trial.` });
  } catch (e) { safeError(res, e, 'Leave'); }
});





// ── Serve Frontend in Production ──────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '../dist');

app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`\n  Curation Trail API  ->  http://localhost:${PORT}/api`);
  console.log(`    WebSocket         ->  ws://localhost:${PORT}/ws`);
  console.log(`    Bot: @${BOT_ACCOUNT || '(set BOT_ACCOUNT in .env)'}`);
  console.log(`    Auth: JWT-based authentication enabled\n`);
});
