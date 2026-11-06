import {
  hashPassword, verifyPassword,
  createSession, regenerateSession,
  serializeSessionCookie, clearSessionCookie,
  getSessionFromRequest, validateCsrf
} from '../../src/auth.mjs';
import { generateApiKeyForUser, rotateApiKeyForUser } from '../../src/apikey.mjs';
import { Store } from '../../src/store.mjs';

/** POST /api/auth?action=login|signup|logout|rotate-key */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const isSecure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const session  = getSessionFromRequest(req);
  const user     = session ? Store.getUserById(session.userId) : null;
  const action   = req.query.action;
  const body     = req.body ? JSON.parse(req.body) : {};

  // SIGNUP
  if (action === 'signup') {
    const { username, password } = body;
    if (!username || !password || username.trim().length < 3 || password.length < 6)
      return res.status(400).json({ error: 'Username >= 3 chars, password >= 6 chars' });
    if (Store.getUserByUsername(username))
      return res.status(400).json({ error: 'Username already taken' });

    const id = 'usr_' + Date.now();
    const newUser = { id, username: username.trim(), passwordHash: hashPassword(password), role: 'user', apiKey: null, createdAt: Date.now() };
    Store.saveUser(newUser);
    generateApiKeyForUser(id);
    const s = createSession(id, 'user');
    res.setHeader('Set-Cookie', serializeSessionCookie(s.id, isSecure));
    return res.json({ ok: true, user: { id, username: newUser.username } });
  }

  // LOGIN
  if (action === 'login') {
    const { username, password } = body;
    const target = Store.getUserByUsername(username);
    if (!target || !verifyPassword(password, target.passwordHash))
      return res.status(401).json({ error: 'Invalid username or password' });

    const s = regenerateSession(session?.id, target.id, target.role);
    res.setHeader('Set-Cookie', serializeSessionCookie(s.id, isSecure));
    return res.json({ ok: true, user: { id: target.id, username: target.username, role: target.role } });
  }

  // LOGOUT
  if (action === 'logout') {
    if (session) {
      if (!validateCsrf(req, session, body))
        return res.status(403).json({ error: 'CSRF validation failed' });
      Store.deleteSession(session.id);
    }
    res.setHeader('Set-Cookie', clearSessionCookie(isSecure));
    return res.json({ ok: true });
  }

  // ROTATE KEY
  if (action === 'rotate-key') {
    if (!user) return res.status(401).json({ error: 'Auth required' });
    if (!validateCsrf(req, session, body))
      return res.status(403).json({ error: 'CSRF validation failed' });
    const r = rotateApiKeyForUser(user.id);
    return res.json({ ok: true, newKey: r.newKey });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
