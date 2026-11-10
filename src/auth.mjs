import crypto from 'node:crypto';
import { Store } from './store.mjs';

export const SESSION_COOKIE_NAME = 'launcher_session';
const DEFAULT_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  const keyBuf = Buffer.from(key, 'hex');
  const derivedBuf = Buffer.from(derivedKey, 'hex');
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

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

export function regenerateSession(oldSessionId, userId, role = 'user', maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  if (oldSessionId) {
    Store.deleteSession(oldSessionId);
  }
  return createSession(userId, role, maxAgeSec);
}

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

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  return Store.getSession(sessionId);
}

export function validateCsrf(req, session, parsedBody = null) {
  if (!session) return false;
  const headerToken = req.headers['x-csrf-token'];
  const bodyToken = parsedBody?._csrf || parsedBody?.csrfToken;
  const candidateToken = headerToken || bodyToken;
  if (candidateToken && candidateToken === session.csrfToken) {
    return true;
  }
  if (req.headers['x-requested-with'] === 'XMLHttpRequest' && headerToken === session.csrfToken) {
    return true;
  }
  return false;
}
