import crypto from 'node:crypto';
import { Store } from './store.mjs';

const SESSION_COOKIE_NAME = 'launcher_session';
const DEFAULT_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

/**
 * Hash password using native scrypt with a unique cryptographically random salt.
 * Passwords are never stored in plain text.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

/**
 * Constant-time password verification to prevent timing attacks.
 */
export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  const keyBuf = Buffer.from(key, 'hex');
  const derivedBuf = Buffer.from(derivedKey, 'hex');
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

/**
 * Parse Cookie header into a key-value dictionary.
 */
export function parseCookies(header = '') {
  const cookies = {};
  if (!header) return cookies;
  for (const item of header.split(';')) {
    const [name, ...val] = item.trim().split('=');
    if (name) {
      cookies[decodeURIComponent(name)] = decodeURIComponent(val.join('='));
    }
  }
  return cookies;
}

/**
 * Create a new server-side session.
 * Generates a crypto-secure 32-byte random session ID and 24-byte CSRF token.
 */
export function createSession(userId, role = 'user', maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + (maxAgeSec * 1000);

  const session = {
    id: sessionId,
    userId,
    role,
    csrfToken,
    expiresAt,
    createdAt: Date.now()
  };

  Store.saveSession(session);
  return session;
}

/**
 * Regenerate session ID on login to protect against session fixation attacks.
 */
export function regenerateSession(oldSessionId, userId, role = 'user', maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  if (oldSessionId) {
    Store.deleteSession(oldSessionId);
  }
  return createSession(userId, role, maxAgeSec);
}

/**
 * Serialize session cookie with required flags:
 * HttpOnly, Secure (on HTTPS), SameSite=Lax (or Strict), Path=/, and fixed Max-Age.
 */
export function serializeSessionCookie(sessionId, isSecure = false, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Clear session cookie by setting Max-Age=0.
 */
export function clearSessionCookie(isSecure = false) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Extract and validate current session from request cookies.
 */
export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  return Store.getSession(sessionId);
}

/**
 * Validate CSRF token for state-changing operations on cookie-authenticated requests.
 */
export function validateCsrf(req, session, parsedBody = null) {
  if (!session) return false;
  
  // Custom header check or token check
  const headerToken = req.headers['x-csrf-token'];
  const bodyToken = parsedBody?._csrf;
  const candidateToken = headerToken || bodyToken;

  if (candidateToken && candidateToken === session.csrfToken) {
    return true;
  }

  // Supporting standard modern custom header check fallback
  if (req.headers['x-requested-with'] === 'XMLHttpRequest' && headerToken === session.csrfToken) {
    return true;
  }

  return false;
}
