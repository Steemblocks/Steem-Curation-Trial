/**
 * wsHub.js
 * ────────
 * Lightweight WebSocket broadcast hub with connection limits.
 * The server pushes events to all connected clients so the frontend
 * no longer needs to poll /api/status, /api/logs, and /api/user every 4 seconds.
 *
 * Events pushed:
 *   { type: 'status',  data: { syncedBlock, botAccount, ... } }
 *   { type: 'logs',    data: [ ...vote logs ] }
 *   { type: 'user',    data: { username, user, steemProfile, trails, hasAuthority } }
 */

import { WebSocketServer } from 'ws';

let wss = null;

// ── Connection limits ─────────────────────────────────────────────────────────
const MAX_CONNECTIONS = parseInt(process.env.WS_MAX_CONNECTIONS, 10) || 200;
const MAX_PER_IP = parseInt(process.env.WS_MAX_PER_IP, 10) || 10;

/** Track connections per IP */
function getConnectionCountByIP(ip) {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((ws) => {
    if (ws._remoteAddress === ip) count++;
  });
  return count;
}

/**
 * Attach a WebSocket server to an existing HTTP server instance.
 */
export function initWs(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Track client IP for per-IP limiting
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    ws._remoteAddress = ip;

    // Enforce global connection limit
    if (wss.clients.size > MAX_CONNECTIONS) {
      ws.close(1013, 'Server at capacity');
      return;
    }

    // Enforce per-IP connection limit
    if (getConnectionCountByIP(ip) > MAX_PER_IP) {
      ws.close(1013, 'Too many connections from this IP');
      return;
    }

    console.log('[WS] Client connected');
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        // Reject oversized messages (max 1KB)
        if (raw.length > 1024) return;

        const msg = JSON.parse(raw);
        // Clients can subscribe to user-specific updates
        if (msg.type === 'subscribe' && msg.username) {
          // Sanitize username: only allow alphanumeric, dots, dashes (valid Steem username chars)
          const clean = String(msg.username).toLowerCase().replace(/[^a-z0-9.\-]/g, '').slice(0, 32);
          if (clean) ws.subscribedUser = clean;
        }
      } catch (e) { /* ignore malformed messages */ }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });
  });

  // Ping/pong heartbeat every 30 seconds to detect dead connections
  setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);
}

/**
 * Broadcast a message to all connected clients.
 * If `targetUsername` is set, only send to clients subscribed to that user.
 */
export function broadcast(type, data, targetUsername = null) {
  if (!wss) return;
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return; // 1 === OPEN
    if (targetUsername && ws.subscribedUser !== targetUsername.toLowerCase()) return;
    ws.send(payload);
  });
}

/**
 * Broadcast to ALL clients (no user filtering).
 */
export function broadcastAll(type, data) {
  broadcast(type, data, null);
}

/**
 * Returns a list of unique usernames currently subscribed by active clients.
 */
export function getSubscribedUsers() {
  if (!wss) return [];
  const users = new Set();
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1 && ws.subscribedUser) {
      users.add(ws.subscribedUser);
    }
  });
  return Array.from(users);
}
