import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  runService,
  deployService,
  unloadService,
  unregisterService,
  serviceStats,
  shutdownRuntime,
  hasService,
  registerService,
  ServiceError
} from './src/index.mjs';
import {
  resolveAndScanService,
  isValidServiceName,
  serviceExists
} from './resolve.mjs';
import { genError, homePage } from './pages.mjs';
import { Store } from './src/store.mjs';
import {
  hashPassword,
  verifyPassword,
  createSession,
  regenerateSession,
  serializeSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  validateCsrf
} from './src/auth.mjs';
import {
  generateApiKeyForUser,
  rotateApiKeyForUser,
  authenticateApiKey
} from './src/apikey.mjs';
import {
  consumeToken,
  inspectBucket,
  getRateLimitHeaders,
  RATE_LIMIT_CONFIGS
} from './src/ratelimit.mjs';
import { renderAuthPage, renderDashboardPage } from './src/dashboard_ui.mjs';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const MAX_REQUEST_BYTES = 1024 * 1024;

function initDefaultUser() {
  if (!Store.getUserByUsername('admin')) {
    const id = 'usr_' + Date.now();
    Store.saveUser({
      id,
      username: 'admin',
      passwordHash: hashPassword('password123'),
      role: 'admin',
      apiKey: null,
      tier: 'pro'
    });
    generateApiKeyForUser(id);
    Store.saveService({
      name: 'abce',
      userId: id,
      code: `export default { async server(req) { return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'Hello from /abce!' }; } };`
    });
  }
}
initDefaultUser();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        req.destroy(new ServiceError('REQUEST_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '');
    });
    req.on('error', (err) => reject(err));
  });
}

async function parseBody(req) {
  const text = await readBody(req);
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return { raw: text, parsed: JSON.parse(text || '{}') };
    } catch {
      throw new ServiceError('BAD_REQUEST', { detail: 'Malformed JSON payload' });
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return { raw: text, parsed: Object.fromEntries(new URLSearchParams(text)) };
  }
  return { raw: text, parsed: {} };
}

function sendResponse(res, status, headers, body) {
  if (res.headersSent) return;
  res.writeHead(status, headers);
  res.end(body || '');
}

function sendJson(res, status, data, extraHeaders = {}) {
  sendResponse(
    res,
    status,
    {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    },
    JSON.stringify(data)
  );
}

function sendError(req, res, err) {
  if (res.headersSent) return;
  const status = err instanceof ServiceError ? err.status : (err.status || 500);
  const publicMessage = err instanceof ServiceError ? err.publicMessage : 'Internal Server Error';
  const detail = err instanceof ServiceError ? err.detail : undefined;
  const extraHeaders = {};
  if (err && err.retryAfterSec) {
    extraHeaders['Retry-After'] = String(err.retryAfterSec);
  }
  const acceptsJson = (req.headers.accept && req.headers.accept.includes('application/json')) || req.url.startsWith('/api/');
  if (acceptsJson) {
    sendJson(res, status, {
      error: err.code || 'INTERNAL_ERROR',
      message: publicMessage,
      detail: detail || undefined,
      status
    }, extraHeaders);
  } else {
    sendResponse(
      res,
      status,
      {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders
      },
      genError(status, err)
    );
  }
}

export const server = http.createServer(async (req, res) => {
  const startTime = performance.now();
  const host = req.headers.host || 'localhost';
  const isHttps = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  let urlObj;
  try {
    urlObj = new URL(req.url, `http://${host}`);
  } catch {
    return sendError(req, res, new ServiceError('BAD_REQUEST', { detail: 'Malformed URL' }));
  }
  const pathname = urlObj.pathname;
  const method = req.method.toUpperCase();
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  const session = getSessionFromRequest(req);
  const sessionUser = session ? Store.getUserById(session.userId) : null;
  const apiAuth = authenticateApiKey(req);
  const currentUser = apiAuth ? apiAuth.user : sessionUser;
  if (pathname === '/' && method === 'GET') {
    if (sessionUser) {
      res.writeHead(302, { Location: '/dashboard' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(homePage);
    return;
  }
  if (pathname === '/login' && method === 'GET') {
    if (sessionUser) { res.writeHead(302, { Location: '/dashboard' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderAuthPage(null, 'login'));
    return;
  }
  if (pathname === '/signup' && method === 'GET') {
    if (sessionUser) { res.writeHead(302, { Location: '/dashboard' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderAuthPage(null, 'signup'));
    return;
  }
  if (pathname === '/dashboard' && method === 'GET') {
    if (!sessionUser) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    const rateCheck = consumeToken(`user:${sessionUser.id}`, RATE_LIMIT_CONFIGS.user);
    if (!rateCheck.allowed) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', ...getRateLimitHeaders(rateCheck) });
      res.end(`<h1>429 - Too Many Requests</h1><p>Please wait ${rateCheck.retryAfter}s.</p>`);
      return;
    }

    const services = Store.getUserServices(sessionUser.id);
    const recentLogs = Store.getUserLogs(sessionUser.id, 25);
    const userBucket = inspectBucket(`user:${sessionUser.id}`, RATE_LIMIT_CONFIGS.user);
    const apiBucket = inspectBucket(`key:${sessionUser.apiKey}`, RATE_LIMIT_CONFIGS.apiKey);
    const billingSummary = Store.getBillingSummary(sessionUser.id);

    const html = renderDashboardPage({
      user: sessionUser,
      session,
      services,
      recentLogs,
      bucketStats: { user: userBucket, apiKey: apiBucket },
      billingSummary
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (pathname === '/api/auth/signup' && method === 'POST') {
    try {
      const { parsed } = await parseBody(req);
      const username = (parsed.username || '').trim();
      const password = parsed.password || '';

      if (username.length < 3 || password.length < 6) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAuthPage('Username must be ≥ 3 chars, password ≥ 6 chars.', 'signup'));
        return;
      }

      if (Store.getUserByUsername(username)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAuthPage('Username is already taken.', 'signup'));
        return;
      }

      const userId = 'usr_' + Date.now();
      const passwordHash = hashPassword(password);
      const newUser = Store.saveUser({
        id: userId,
        username,
        passwordHash,
        role: 'user',
        apiKey: null
      });
      generateApiKeyForUser(userId);

      const newSession = createSession(userId, newUser.role);
      const cookie = serializeSessionCookie(newSession.id, isHttps);

      if (req.headers['accept']?.includes('application/json')) {
        return sendJson(res, 201, { ok: true, user: { id: newUser.id, username: newUser.username } }, { 'Set-Cookie': cookie });
      }

      res.writeHead(302, { Location: '/dashboard', 'Set-Cookie': cookie });
      res.end();
      return;
    } catch (err) {
      return sendError(req, res, err);
    }
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const { parsed } = await parseBody(req);
      const username = (parsed.username || '').trim();
      const password = parsed.password || '';

      const user = Store.getUserByUsername(username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        if (req.headers['accept']?.includes('application/json')) {
          return sendJson(res, 401, { error: 'Invalid username or password' });
        }
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAuthPage('Invalid username or password.', 'login'));
        return;
      }

      const oldSessionId = session?.id || null;
      const newSession = regenerateSession(oldSessionId, user.id, user.role);
      const cookie = serializeSessionCookie(newSession.id, isHttps);

      if (req.headers['accept']?.includes('application/json')) {
        return sendJson(res, 200, { ok: true, user: { id: user.id, username: user.username, role: user.role } }, { 'Set-Cookie': cookie });
      }

      res.writeHead(302, { Location: '/dashboard', 'Set-Cookie': cookie });
      res.end();
      return;
    } catch (err) {
      return sendError(req, res, err);
    }
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    if (session) {
      Store.deleteSession(session.id);
    }
    const cookie = clearSessionCookie(isHttps);
    res.writeHead(302, { Location: '/', 'Set-Cookie': cookie });
    res.end();
    return;
  }
  if (pathname === '/api/auth/rotate-key' && method === 'POST') {
    if (!currentUser) {
      return sendJson(res, 401, { error: 'Authentication required' });
    }
    if (session && !validateCsrf(req, session)) {
      return sendJson(res, 403, { error: 'CSRF token missing or invalid' });
    }

    const rotation = rotateApiKeyForUser(currentUser.id);
    return sendJson(res, 200, { ok: true, newKey: rotation.newKey });
  }
  if (pathname === '/api/stats' && method === 'GET') {
    return sendJson(res, 200, {
      runtime: 'Launcher-Workerd-V2',
      zeroDependency: true,
      stats: serviceStats()
    });
  }
  if (pathname === '/api/billing' && method === 'GET') {
    if (!currentUser) {
      return sendJson(res, 401, { error: 'Authentication required' });
    }
    const summary = Store.getBillingSummary(currentUser.id);
    return sendJson(res, 200, { ok: true, billing: summary });
  }
  if (pathname === '/api/ratelimit/stats' && method === 'GET') {
    if (!currentUser) {
      return sendJson(res, 401, { error: 'Authentication required' });
    }
    const userBucket = inspectBucket(`user:${currentUser.id}`, RATE_LIMIT_CONFIGS.user);
    const apiBucket = inspectBucket(`key:${currentUser.apiKey}`, RATE_LIMIT_CONFIGS.apiKey);
    return sendJson(res, 200, { user: userBucket, apiKey: apiBucket });
  }
  if (pathname === '/api/deploy' && method === 'POST') {
    try {
      if (session && !validateCsrf(req, session)) {
        return sendJson(res, 403, { error: 'CSRF token validation failed' });
      }
      const { parsed } = await parseBody(req);
      const { name, code, allowFlagged } = parsed;
      if (!isValidServiceName(name)) {
        throw new ServiceError('BAD_REQUEST', { detail: 'Valid service name required [a-zA-Z0-9_-]{1,64}' });
      }
      if (typeof code !== 'string' || code.length === 0) {
        throw new ServiceError('BAD_REQUEST', { detail: 'Code must be a non-empty string' });
      }
      const result = deployService(name, code, { allowFlagged: !!allowFlagged });
      if (result.deployed) {
        Store.saveService({
          name,
          userId: currentUser ? currentUser.id : 'system',
          code
        });
      }
      return sendJson(res, result.deployed ? 200 : 400, result);
    } catch (err) {
      return sendError(req, res, err);
    }
  }
  if (pathname.startsWith('/api/services/') && pathname.endsWith('/unload') && method === 'POST') {
    const parts = pathname.slice('/api/services/'.length).split('/');
    const name = parts[0];
    try {
      const unloaded = unloadService(name, { force: true });
      return sendJson(res, 200, { service: name, unloaded });
    } catch (err) {
      return sendError(req, res, err);
    }
  }
  if (pathname.startsWith('/api/services/') && method === 'DELETE') {
    const name = pathname.slice('/api/services/'.length);
    try {
      const removed = unregisterService(name);
      Store.deleteService(name);
      return sendJson(res, removed ? 200 : 404, { service: name, removed });
    } catch (err) {
      return sendError(req, res, err);
    }
  }
  let rawServiceName = pathname.slice(1);
  if (rawServiceName.startsWith('svc/')) {
    rawServiceName = rawServiceName.slice(4);
  }
  const serviceName = rawServiceName.split('/')[0];
  if (!isValidServiceName(serviceName)) {
    return sendError(req, res, new ServiceError('BAD_REQUEST', { detail: `Invalid service route: /${rawServiceName}` }));
  }
  let callerType = 'anon';
  let callerId = req.socket.remoteAddress || '127.0.0.1';
  let rateCheck;
  if (apiAuth) {
    callerType = 'api-key';
    callerId = apiAuth.user.id;
    rateCheck = consumeToken(`key:${apiAuth.apiKey}`, RATE_LIMIT_CONFIGS.apiKey);
  } else if (sessionUser) {
    callerType = 'session';
    callerId = sessionUser.id;
    rateCheck = consumeToken(`user:${sessionUser.id}`, RATE_LIMIT_CONFIGS.user);
  } else {
    rateCheck = consumeToken(`anon:${callerId}`, RATE_LIMIT_CONFIGS.anon);
  }
  if (!rateCheck.allowed) {
    const headers = { ...getRateLimitHeaders(rateCheck) };
    Store.addLog({
      serviceName,
      userId: callerId,
      authType: callerType,
      status: 429,
      latencyMs: performance.now() - startTime,
      ip: req.socket.remoteAddress
    });
    return sendError(req, res, new ServiceError('RATE_LIMITED', {
      detail: `Rate limit exceeded. Retry after ${rateCheck.retryAfter}s`,
      retryAfterSec: rateCheck.retryAfter,
      status: 429
    }));
  }
  const serviceRateCheck = consumeToken(`svc:${serviceName}`, RATE_LIMIT_CONFIGS.service);
  if (!serviceRateCheck.allowed) {
    return sendError(req, res, new ServiceError('RATE_LIMITED', {
      detail: `Service capacity reached. Retry after ${serviceRateCheck.retryAfter}s`,
      retryAfterSec: serviceRateCheck.retryAfter,
      status: 429
    }));
  }

  try {
    if (!hasService(serviceName)) {
      const storedSvc = Store.getService(serviceName);
      if (storedSvc && storedSvc.code) {
        registerService(serviceName, { code: storedSvc.code });
      } else if (serviceExists(serviceName)) {
        const { code } = resolveAndScanService(serviceName);
        registerService(serviceName, { code });
        Store.saveService({ name: serviceName, userId: 'system', code });
      } else {
        throw new ServiceError('SERVICE_NOT_FOUND', { detail: `Service "${serviceName}" is not registered or found on disk` });
      }
    }

    const body = await readBody(req);
    const result = await runService(serviceName, {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body
    });

    const latency = performance.now() - startTime;
    Store.recordInvocation(serviceName, callerType !== 'anon' ? callerId : null, result.meta?.handlerMs || latency);
    Store.addLog({
      serviceName,
      userId: callerId,
      authType: callerType,
      status: result.status,
      latencyMs: latency,
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] || 'unknown'
    });
    const responseHeaders = {
      ...result.headers,
      ...getRateLimitHeaders(rateCheck),
      'X-Execution-Status': 'success',
      'X-Handler-Time-Ms': result.meta ? result.meta.handlerMs.toFixed(3) : '0',
      'X-Total-Time-Ms': result.meta ? result.meta.totalMs.toFixed(3) : '0',
      'X-Cold-Start': String(result.meta ? result.meta.coldStart : false),
      'X-Memory-Heap-Bytes': String(result.meta ? result.meta.heapUsedBytes : 0),
      'X-Queued-Time-Ms': result.meta ? result.meta.queuedMs.toFixed(3) : '0'
    };

    sendResponse(res, result.status, responseHeaders, result.body);
  } catch (err) {
    Store.addLog({
      serviceName,
      userId: callerId,
      authType: callerType,
      status: err.status || 500,
      latencyMs: performance.now() - startTime,
      ip: req.socket.remoteAddress
    });
    sendError(req, res, err);
  }
});

async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Gracefully shutting down Launcher runtime...`);
  server.close(async () => {
    try {
      await shutdownRuntime();
      console.log('All sandboxed service workers cleanly terminated.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`Launcher Serverless Runtime listening on port ${PORT}`);
    console.log(`Zero-Dependency Isolated Worker Engine`);
    console.log(`Stats Endpoint: http://localhost:${PORT}/api/stats`);
    console.log(`Developer Console: http://localhost:${PORT}/dashboard`);
    console.log(`Sample Module: http://localhost:${PORT}/abce`);
    console.log(`================================================================`);
  });
}
