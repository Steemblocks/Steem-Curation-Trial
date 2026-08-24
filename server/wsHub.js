/**
 * wsHub.js
 * ────────
 * Lightweight WebSocket broadcast hub.
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

/**
 * Attach a WebSocket server to an existing HTTP server instance.
 */
export function initWs(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        // Clients can subscribe to user-specific updates
        if (msg.type === 'subscribe' && msg.username) {
          ws.subscribedUser = msg.username.toLowerCase();
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
