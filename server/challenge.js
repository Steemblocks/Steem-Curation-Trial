import crypto from 'crypto';

const challenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_REQUEST_INTERVAL_MS = 2000;    // 2 seconds debounce per username

/**
 * Generate a new single-use cryptographic challenge for a username.
 * @param {string} username
 * @returns {string|null} The challenge text to be signed, or null if requested too rapidly
 */
export function createChallenge(username) {
  const clean = username.trim().toLowerCase();
  const now = Date.now();
  const existing = challenges.get(clean);

  if (existing && (now - existing.createdAt < MIN_REQUEST_INTERVAL_MS)) {
    return null; // Rate limit requests per username
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `Sign in to Steem Curation Trial as @${clean} (nonce: ${nonce}, timestamp: ${now})`;

  challenges.set(clean, {
    message,
    expiresAt: now + CHALLENGE_TTL_MS,
    createdAt: now,
  });

  return message;
}

/**
 * Retrieve and immediately consume (delete) a challenge for a username.
 * @param {string} username
 * @returns {string|null} The challenge message if valid and not expired, else null
 */
export function consumeChallenge(username) {
  const clean = username.trim().toLowerCase();
  const entry = challenges.get(clean);

  if (!entry) return null;

  // Challenges are strictly single-use
  challenges.delete(clean);

  if (Date.now() > entry.expiresAt) {
    return null; // Expired
  }

  return entry.message;
}

// Purge expired challenges periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [user, entry] of challenges.entries()) {
    if (now > entry.expiresAt) {
      challenges.delete(user);
    }
  }
}, 60 * 1000);
