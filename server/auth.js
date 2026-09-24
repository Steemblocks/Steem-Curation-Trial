/**
 * auth.js
 * ───────
 * JWT-based authentication middleware.
 * Issues tokens on login, validates on all mutating endpoints.
 */

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'steem_curation_trial_jwt_secret_change_me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

/**
 * Generate a JWT token for a verified user.
 * @param {string} username - The authenticated Steem username
 * @returns {string} JWT token
 */
export function generateToken(username) {
  return jwt.sign(
    { username: username.toLowerCase() },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Express middleware: verifies JWT from Authorization header.
 * Sets `req.authUser` to the authenticated username.
 * Rejects with 401 if token is missing/invalid/expired.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.authUser = decoded.username;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' });
    }
    return res.status(401).json({ success: false, error: 'Invalid authentication token.' });
  }
}

/**
 * Express middleware: ensures the authenticated user matches the username in the request body.
 * Must be used AFTER requireAuth.
 * Prevents users from modifying other users' data.
 */
export function requireSelf(req, res, next) {
  const bodyUser = (req.body.username || '').trim().toLowerCase();
  if (!bodyUser) {
    return res.status(400).json({ success: false, error: 'Username required.' });
  }
  if (req.authUser !== bodyUser) {
    return res.status(403).json({ success: false, error: 'You can only modify your own account.' });
  }
  next();
}
