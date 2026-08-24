import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors    from 'cors';
import dotenv  from 'dotenv';
dotenv.config();

import {
  initDb, getAllUsers, getUser, upsertUserAccount,
  getUserTrails, addUserTrail, updateUserTrail, deleteUserTrail,
  updateUserStatus, deleteUser, getVoteLogs, getTotalVoteLogsCount, getVoteStats
} from './db.js';
import { getAccount, calcVP, formatRep, hasBotAuthority, BOT_ACCOUNT } from './steemClient.js';
import { startStreamer, getSyncedBlock, getWatchedSet, refreshWatched, simulateVote } from './steemStreamer.js';
import { initWs, broadcast, broadcastAll, getSubscribedUsers } from './wsHub.js';

const app  = express();
const server = createServer(app);
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

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

// ── Routes ────────────────────────────────────────────────────────────────────

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
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Verify a Steem account exists on blockchain
app.get('/api/verify/:username', async (req, res) => {
  try {
    const username = req.params.username.trim().toLowerCase();
    const profile = await buildProfile(username);
    if (!profile) return res.status(404).json({ success: false, error: `@${username} not found on Steem blockchain` });
    res.json({ success: true, profile });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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

    refreshWatched();
    res.json({ success: true, message: 'Logged in successfully', user, steemProfile: profile, trails });
    // Push initial state to any WS clients that may subscribe
    broadcastUserUpdate(clean);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

app.post('/api/login', handleAuthLogin);
app.post('/api/join', handleAuthLogin);

// Multi-trail endpoints:

// 1. Add followed trail
app.post('/api/trails/add', async (req, res) => {
  try {
    const { username, trailAccount, weight = 100, delay = 0, minVp = 80 } = req.body;
    if (!username || !trailAccount) return res.status(400).json({ success: false, error: 'Username and trail account required' });

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
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 2. Update specific followed trail
app.post('/api/trails/update', (req, res) => {
  try {
    const { id, username, weight, delay, minVp, status } = req.body;
    if (!id || !username) return res.status(400).json({ success: false, error: 'Trail ID and username required' });

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
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 3. Remove a specific followed trail
app.post('/api/trails/remove', (req, res) => {
  try {
    const { id, username } = req.body;
    if (!id || !username) return res.status(400).json({ success: false, error: 'Trail ID and username required' });

    const trails = deleteUserTrail({ id: parseInt(id, 10), username });
    refreshWatched();
    res.json({ success: true, message: 'Unfollowed trail account', trails });
    broadcastUserUpdate(username);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 4. Toggle specific trail (Active/Paused)
app.post('/api/trails/toggle', (req, res) => {
  try {
    const { id, username, status } = req.body;
    if (!id || !username || !status) return res.status(400).json({ success: false, error: 'ID, username and status required' });

    const trails = updateUserTrail({
      id: parseInt(id, 10),
      username,
      status
    });

    refreshWatched();
    res.json({ success: true, trails });
    broadcastUserUpdate(username);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 5. Global user account pause / resume
app.post('/api/toggle-status', (req, res) => {
  try {
    const { username, status } = req.body;
    if (!username || !status) return res.status(400).json({ success: false, error: 'Username and status required' });
    const user = updateUserStatus(username, status);
    refreshWatched();
    res.json({ success: true, user });
    broadcastUserUpdate(username);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 6. Delete user account & all followed trails
app.post('/api/leave', (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, error: 'Username required' });
    deleteUser(username);
    refreshWatched();
    res.json({ success: true, message: `Account @${username} removed from curation trial.` });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 7. Simulate vote (testing)
app.post('/api/simulate-vote', async (req, res) => {
  try {
    const { leader = 'dhaka.witness', author = 'steemit', permlink = 'test', weight = 100 } = req.body;
    await simulateVote(leader, author, permlink, weight);
    res.json({ success: true, message: `Simulated @${leader} voting on @${author}/${permlink}` });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
  console.log(`    Bot: @${BOT_ACCOUNT || '(set BOT_ACCOUNT in .env)'}\n`);
});
