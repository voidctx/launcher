import path from 'node:path';
import fs from 'node:fs';
import { Store } from './store.mjs';
import {
  hashPassword,
  verifyPassword,
  createSession,
  regenerateSession,
  serializeSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  validateCsrf
} from './auth.mjs';
import {
  generateApiKeyForUser,
  rotateApiKeyForUser,
  authenticateApiKey
} from './apikey.mjs';
import {
  consumeToken,
  inspectBucket,
  getRateLimitHeaders,
  RATE_LIMIT_CONFIGS
} from './ratelimit.mjs';
import {
  validateHostHeader,
  sanitizePath,
  validateServiceName,
  validateHeaders,
  readRequestBody,
  readJsonBody,
  withExecutionTimeout,
  applySecurityHeaders,
  SecurityError,
  SECURITY_CONFIG
} from './security.mjs';
import { renderAuthPage, renderDashboardPage } from './dashboard_ui.mjs';

// Seed initial default developer user if database is fresh
function initDefaultUser() {
  const existing = Store.getUserByUsername('srinibas');
  if (!existing) {
    const userId = 'usr_' + Date.now();
    const passwordHash = hashPassword('password123');
    const user = {
      id: userId,
      username: 'srinibas',
      passwordHash,
      role: 'admin',
      apiKey: null,
      createdAt: Date.now()
    };
    Store.saveUser(user);
    generateApiKeyForUser(userId);

    // Seed default sample service (abce)
    Store.saveService({
      name: 'abce',
      userId,
      code: `export default {\n  async server(req) {\n    return {\n      status: 200,\n      headers: { 'Content-Type': 'text/plain' },\n      body: 'Hello from /abce!'\n    };\n  }\n};`,
      createdAt: Date.now(),
      invocations: 0
    });
  }
}
initDefaultUser();

/**
 * Main request dispatcher with complete security, auth, rate limiting, and dashboard.
 */
export async function handleRequest(req, res, options = {}) {
  const startTime = Date.now();
  applySecurityHeaders(res);

  // Check if connection is HTTPS
  const isHttps = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

  try {
    // 1. Security Middleware: Host Sanitization
    validateHostHeader(req);

    // 2. Security Middleware: Header Validation
    validateHeaders(req);

    // 3. Security Middleware: Path Sanitization
    const sanitizedUrl = sanitizePath(req.url);
    const urlObj = new URL(sanitizedUrl, `http://${req.headers.host}`);
    const pathname = urlObj.pathname;
    const method = req.method.toUpperCase();

    // 4. Resolve Authentication Context
    const session = getSessionFromRequest(req);
    const sessionUser = session ? Store.getUserById(session.userId) : null;
    const apiAuth = authenticateApiKey(req);

    // --- Route: Static Favicon ---
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- Route: Root / Login / Signup View ---
    if (pathname === '/' || pathname === '/login' || pathname === '/signup') {
      if (sessionUser) {
        // Authenticated user gets redirected to dashboard
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderAuthPage());
      return;
    }

    // --- Route: Dashboard View ---
    if (pathname === '/dashboard') {
      if (!sessionUser) {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }

      // Check User Rate Limit for dashboard navigation
      const rateCheck = consumeToken(`user:${sessionUser.id}`, RATE_LIMIT_CONFIGS.user);
      if (!rateCheck.allowed) {
        res.writeHead(429, {
          'Content-Type': 'text/html; charset=utf-8',
          ...getRateLimitHeaders(rateCheck)
        });
        res.end(`<h1>429 - Too Many Requests</h1><p>Please wait ${rateCheck.retryAfter}s.</p>`);
        return;
      }

      const services = Store.getUserServices(sessionUser.id);
      const recentLogs = Store.getUserLogs(sessionUser.id, 20);
      const userBucket = inspectBucket(`user:${sessionUser.id}`, RATE_LIMIT_CONFIGS.user);
      const apiBucket = inspectBucket(`key:${sessionUser.apiKey}`, RATE_LIMIT_CONFIGS.apiKey);

      const html = renderDashboardPage({
        user: sessionUser,
        session,
        services,
        recentLogs,
        bucketStats: { user: userBucket, apiKey: apiBucket }
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // --- Route: Auth API (Signup) ---
    if (pathname === '/api/auth/signup' && method === 'POST') {
      let username, password;
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        const body = await readJsonBody(req);
        username = body.username;
        password = body.password;
      } else {
        const bodyText = await readRequestBody(req);
        const params = new URLSearchParams(bodyText);
        username = params.get('username');
        password = params.get('password');
      }

      if (!username || !password || username.trim().length < 3 || password.length < 6) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAuthPage('Username must be ≥ 3 chars, password ≥ 6 chars.'));
        return;
      }

      if (Store.getUserByUsername(username)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAuthPage('Username is already registered.'));
        return;
      }

      const userId = 'usr_' + Date.now();
      const passwordHash = hashPassword(password);
      const newUser = {
        id: userId,
        username: username.trim(),
        passwordHash,
        role: 'user',
        apiKey: null,
        createdAt: Date.now()
      };
      Store.saveUser(newUser);
      generateApiKeyForUser(userId);

      // Create initial session
      const newSession = createSession(userId, newUser.role);
      const cookie = serializeSessionCookie(newSession.id, isHttps);

      res.writeHead(302, {
        Location: '/dashboard',
        'Set-Cookie': cookie
      });
      res.end();
      return;
    }

    // --- Route: Auth API (Login) ---
    if (pathname === '/api/auth/login' && method === 'POST') {
      let username, password;
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        const body = await readJsonBody(req);
        username = body.username;
        password = body.password;
      } else {
        const bodyText = await readRequestBody(req);
        const params = new URLSearchParams(bodyText);
        username = params.get('username');
        password = params.get('password');
      }

      const user = Store.getUserByUsername(username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAuthPage('Invalid username or password.'));
        return;
      }

      // Regenerate session ID on login to prevent session fixation attacks
      const oldSessionId = session?.id || null;
      const newSession = regenerateSession(oldSessionId, user.id, user.role);
      const cookie = serializeSessionCookie(newSession.id, isHttps);

      if (contentType.includes('application/json')) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie
        });
        res.end(JSON.stringify({ ok: true, user: { id: user.id, username: user.username, role: user.role } }));
      } else {
        res.writeHead(302, {
          Location: '/dashboard',
          'Set-Cookie': cookie
        });
        res.end();
      }
      return;
    }

    // --- Route: Auth API (Logout) ---
    if (pathname === '/api/auth/logout' && method === 'POST') {
      if (session) {
        // CSRF check
        const body = req.headers['content-type']?.includes('application/x-www-form-urlencoded')
          ? Object.fromEntries(new URLSearchParams(await readRequestBody(req)))
          : null;

        if (!validateCsrf(req, session, body)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'CSRF token validation failed' }));
          return;
        }

        Store.deleteSession(session.id);
      }

      const clearedCookie = clearSessionCookie(isHttps);
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': clearedCookie
      });
      res.end();
      return;
    }

    // --- Route: Rotate API Key ---
    if (pathname === '/api/auth/rotate-key' && method === 'POST') {
      if (!sessionUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      // CSRF protection for state-changing request
      if (!validateCsrf(req, session)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CSRF token missing or invalid' }));
        return;
      }

      const rotation = rotateApiKeyForUser(sessionUser.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, newKey: rotation.newKey }));
      return;
    }

    // --- Route: Deploy or Create Service ---
    if (pathname === '/api/services' && method === 'POST') {
      if (!sessionUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      if (!validateCsrf(req, session)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CSRF validation failed' }));
        return;
      }

      const payload = await readJsonBody(req, SECURITY_CONFIG.MAX_UPLOAD_SIZE);
      const { name, code } = payload;

      if (!validateServiceName(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid service name. Must be 1-64 alphanumeric characters, hyphens or underscores.' }));
        return;
      }

      if (!code || typeof code !== 'string' || !code.includes('export default')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid module code. Must export a default handler object.' }));
        return;
      }

      // Save service file to modules directory
      const modulesDir = path.resolve(process.cwd(), 'modules');
      if (!fs.existsSync(modulesDir)) fs.mkdirSync(modulesDir, { recursive: true });
      const filePath = path.join(modulesDir, `${name}.mjs`);
      fs.writeFileSync(filePath, code, 'utf-8');

      // Update service in Store
      const service = Store.saveService({
        name,
        userId: sessionUser.id,
        code,
        createdAt: Date.now(),
        invocations: 0
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service }));
      return;
    }

    // --- Route: Delete Service ---
    if (pathname.startsWith('/api/services/') && method === 'DELETE') {
      if (!sessionUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      if (!validateCsrf(req, session)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CSRF validation failed' }));
        return;
      }

      const name = pathname.slice('/api/services/'.length);
      const service = Store.getService(name);
      if (!service) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service not found' }));
        return;
      }

      if (service.userId !== sessionUser.id && sessionUser.role !== 'admin') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Permission denied' }));
        return;
      }

      Store.deleteService(name);
      const filePath = path.resolve(process.cwd(), 'modules', `${name}.mjs`);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // --- Route: Rate Limit Stats ---
    if (pathname === '/api/ratelimit/stats' && method === 'GET') {
      if (!sessionUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const userBucket = inspectBucket(`user:${sessionUser.id}`, RATE_LIMIT_CONFIGS.user);
      const apiBucket = inspectBucket(`key:${sessionUser.apiKey}`, RATE_LIMIT_CONFIGS.apiKey);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: userBucket, apiKey: apiBucket }));
      return;
    }

    // --- Route: Rate Limit Burst Test Hit ---
    if (pathname === '/api/ratelimit/test-hit' && method === 'GET') {
      const key = sessionUser ? `user:${sessionUser.id}` : `ip:${req.socket.remoteAddress}`;
      const result = consumeToken(key, RATE_LIMIT_CONFIGS.user);

      if (!result.allowed) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          ...getRateLimitHeaders(result)
        });
        res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: result.retryAfter }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...getRateLimitHeaders(result)
      });
      res.end(JSON.stringify({ ok: true, remaining: result.remaining }));
      return;
    }

    // --- Route: Real-time Logs ---
    if (pathname === '/api/logs' && method === 'GET') {
      if (!sessionUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const logs = Store.getUserLogs(sessionUser.id, 50);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
      return;
    }

    // =========================================================================
    // Hosted Service Dispatch (/:serviceName)
    // Programmatic calls use API keys; browser dashboard calls use session cookies.
    // =========================================================================
    const serviceName = pathname.slice(1);
    if (!validateServiceName(serviceName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid service route format' }));
      return;
    }

    // Determine caller identity & auth mechanism
    let callerType = 'anonymous';
    let callerId = req.socket.remoteAddress || '127.0.0.1';

    if (apiAuth) {
      callerType = 'api-key';
      callerId = apiAuth.user.id;
    } else if (sessionUser) {
      callerType = 'session';
      callerId = sessionUser.id;
    }

    // --- RATE LIMITING: Token Bucket Check ---
    // 1. Caller Rate Limit (keyed by API key or Session user id)
    let callerRateCheck;
    if (apiAuth) {
      callerRateCheck = consumeToken(`key:${apiAuth.apiKey}`, RATE_LIMIT_CONFIGS.apiKey);
    } else if (sessionUser) {
      callerRateCheck = consumeToken(`user:${sessionUser.id}`, RATE_LIMIT_CONFIGS.user);
    } else {
      // Anonymous / public caller rate limit
      callerRateCheck = consumeToken(`anon:${callerId}`, RATE_LIMIT_CONFIGS.user);
    }

    if (!callerRateCheck.allowed) {
      const headers = {
        'Content-Type': 'application/json',
        ...getRateLimitHeaders(callerRateCheck)
      };
      res.writeHead(429, headers);
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        message: `Caller rate limit exceeded. Retry after ${callerRateCheck.retryAfter} seconds.`,
        retryAfter: callerRateCheck.retryAfter
      }));

      Store.addLog({
        serviceName,
        userId: callerId,
        authType: callerType,
        status: 429,
        latencyMs: Date.now() - startTime,
        ip: req.socket.remoteAddress
      });
      return;
    }

    // 2. Per-Service Rate Limit (protects the target service from overall overload)
    const serviceRateCheck = consumeToken(`svc:${serviceName}`, RATE_LIMIT_CONFIGS.service);
    if (!serviceRateCheck.allowed) {
      const headers = {
        'Content-Type': 'application/json',
        ...getRateLimitHeaders(serviceRateCheck)
      };
      res.writeHead(429, headers);
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        message: `Service /${serviceName} capacity reached. Retry after ${serviceRateCheck.retryAfter} seconds.`,
        retryAfter: serviceRateCheck.retryAfter
      }));

      Store.addLog({
        serviceName,
        userId: callerId,
        authType: callerType,
        status: 429,
        latencyMs: Date.now() - startTime,
        ip: req.socket.remoteAddress
      });
      return;
    }

    // --- Execute Service Module ---
    const modulePath = path.resolve(process.cwd(), 'modules', `${serviceName}.mjs`);
    if (!fs.existsSync(modulePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Service /${serviceName} not found` }));
      return;
    }

    // Dynamic import module with cache-busting timestamp
    const fileUrl = `${pathToFileURL(modulePath).href}?t=${Date.now()}`;
    const mod = await import(fileUrl);

    if (!mod.default || typeof mod.default.server !== 'function') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Module /${serviceName} does not export default server() function` }));
      return;
    }

    // Wrap execution in timeout to prevent hanging user handlers
    const result = await withExecutionTimeout(
      mod.default.server(req),
      SECURITY_CONFIG.EXECUTION_TIMEOUT_MS
    );

    const status = result?.status || 200;
    const responseHeaders = {
      ...(result?.headers || {}),
      ...getRateLimitHeaders(callerRateCheck)
    };

    res.writeHead(status, responseHeaders);
    res.end(result?.body ?? '');

    // Record usage analytics & logs
    Store.incrementServiceInvocation(serviceName);
    Store.addLog({
      serviceName,
      userId: callerId,
      authType: callerType,
      status,
      latencyMs: Date.now() - startTime,
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] || 'unknown'
    });

  } catch (err) {
    const latency = Date.now() - startTime;
    const status = err instanceof SecurityError ? err.status : (err.status || 500);

    res.writeHead(status, {
      'Content-Type': 'application/json',
      ...(err.headers || {})
    });
    res.end(JSON.stringify({
      error: err.name || 'Error',
      message: err.message || 'Internal Server Error'
    }));
  }
}

function pathToFileURL(p) {
  const resolved = path.resolve(p).replace(/\\/g, '/');
  return new URL(`file:///${resolved}`);
}
