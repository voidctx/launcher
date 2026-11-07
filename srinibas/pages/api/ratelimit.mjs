import { consumeToken, inspectBucket, getRateLimitHeaders, RATE_LIMIT_CONFIGS } from '../../src/ratelimit.mjs';
import { getSessionFromRequest } from '../../src/auth.mjs';
import { Store } from '../../src/store.mjs';

/** GET /api/ratelimit?action=stats|test-hit */
export default async function handler(req, res) {
  const session = getSessionFromRequest(req);
  const user = session ? Store.getUserById(session.userId) : null;
  const action = req.query.action || 'stats';

  if (action === 'stats') {
    const ub = user ? inspectBucket(`user:${user.id}`, RATE_LIMIT_CONFIGS.user)
                     : inspectBucket(`ip:${req.socket.remoteAddress}`, RATE_LIMIT_CONFIGS.user);
    const ab = user?.apiKey ? inspectBucket(`key:${user.apiKey}`, RATE_LIMIT_CONFIGS.apiKey) : null;
    return res.json({ user: ub, apiKey: ab });
  }

  if (action === 'test-hit') {
    const key = user ? `user:${user.id}` : `ip:${req.socket.remoteAddress}`;
    const r = consumeToken(key, RATE_LIMIT_CONFIGS.user);
    const h = getRateLimitHeaders(r);
    for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
    if (!r.allowed) return res.status(429).json({ error: 'Too Many Requests', retryAfter: r.retryAfter });
    return res.json({ ok: true, remaining: r.remaining });
  }

  res.status(400).json({ error: 'Unknown action' });
}
