// middleware/auth.js - Admin Authentication & Role Authorization Middleware
const config = require('../config');
const SessionStore = require('../services/sessionStore');

function requireAdmin(req, res, next) {
  const sessionId = req.cookies ? req.cookies[config.SESSION_COOKIE_NAME] : null;

  if (!sessionId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in as an administrator.'
    });
  }

  const session = SessionStore.getSession(sessionId);
  if (!session) {
    res.clearCookie(config.SESSION_COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax'
    });
    return res.status(401).json({
      success: false,
      error: 'Session expired or invalid. Please log in again.'
    });
  }

  if (session.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Admin role privileges required.'
    });
  }

  const isStateMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
  if (isStateMutating) {
    const clientCsrfToken = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
    if (!clientCsrfToken || clientCsrfToken !== session.csrfToken) {
      return res.status(403).json({
        success: false,
        error: 'CSRF token validation failed. State-mutating request rejected.'
      });
    }
  }

  req.adminSession = session;
  req.adminUser = {
    id: session.userId,
    username: session.username,
    email: session.email,
    role: session.role
  };

  next();
}

module.exports = { requireAdmin };
