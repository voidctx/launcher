// routes/auth.js - Admin Authentication Endpoints
const express = require('express');
const router = express.Router();
const config = require('../config');
const SessionStore = require('../services/sessionStore');

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username and password are required.'
    });
  }

  const authResult = SessionStore.authenticateAdmin(username.trim(), password);

  if (!authResult.success) {
    return res.status(401).json({
      success: false,
      error: authResult.error
    });
  }

  res.cookie(config.SESSION_COOKIE_NAME, authResult.sessionId, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_MS
  });

  return res.json({
    success: true,
    message: 'Admin authenticated successfully',
    csrfToken: authResult.csrfToken,
    user: authResult.user
  });
});

router.post('/logout', (req, res) => {
  const sessionId = req.cookies ? req.cookies[config.SESSION_COOKIE_NAME] : null;
  if (sessionId) {
    SessionStore.destroySession(sessionId);
  }

  res.clearCookie(config.SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax'
  });

  return res.json({
    success: true,
    message: 'Admin logged out successfully'
  });
});

router.get('/me', (req, res) => {
  const sessionId = req.cookies ? req.cookies[config.SESSION_COOKIE_NAME] : null;
  if (!sessionId) {
    return res.status(401).json({ authenticated: false });
  }

  const session = SessionStore.getSession(sessionId);
  if (!session || session.role !== 'admin') {
    return res.status(401).json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    user: {
      id: session.userId,
      username: session.username,
      email: session.email,
      role: session.role
    },
    csrfToken: session.csrfToken
  });
});

module.exports = router;
