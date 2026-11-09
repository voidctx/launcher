// services/sessionStore.js - Session and User Authentication Store
const crypto = require('crypto');
const config = require('../config');

const users = new Map();
const sessions = new Map();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

// Seed default admin account
users.set(config.DEFAULT_ADMIN.username, {
  id: 'usr_admin_01',
  username: config.DEFAULT_ADMIN.username,
  email: config.DEFAULT_ADMIN.email,
  role: config.DEFAULT_ADMIN.role, // 'admin'
  passwordHash: hashPassword(config.DEFAULT_ADMIN.password),
  createdAt: new Date()
});

class SessionStore {
  static authenticateAdmin(username, password) {
    const user = users.get(username);
    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return { success: false, error: 'Invalid username or password' };
    }

    if (user.role !== 'admin') {
      return { success: false, error: 'Access denied: Insufficient privileges (Admin role required)' };
    }

    const sessionId = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + config.SESSION_TTL_MS;

    sessions.set(sessionId, {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      csrfToken,
      expiresAt
    });

    return {
      success: true,
      sessionId,
      csrfToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    };
  }

  static getSession(sessionId) {
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  static destroySession(sessionId) {
    if (sessionId) {
      sessions.delete(sessionId);
    }
  }

  static cleanExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now > session.expiresAt) {
        sessions.delete(id);
      }
    }
  }
}

setInterval(() => SessionStore.cleanExpiredSessions(), 15 * 60 * 1000);

module.exports = SessionStore;
