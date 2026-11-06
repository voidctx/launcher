import assert from 'node:assert';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  hashPassword, verifyPassword,
  createSession, regenerateSession,
  serializeSessionCookie, validateCsrf
} from '../src/auth.mjs';
import { generateApiKeyForUser, rotateApiKeyForUser, extractApiKey } from '../src/apikey.mjs';
import { consumeToken, inspectBucket, getRateLimitHeaders, RATE_LIMIT_CONFIGS } from '../src/ratelimit.mjs';
import { validateHostHeader, sanitizePath, validateServiceName, validateHeaders, withExecutionTimeout, SecurityError } from '../src/security.mjs';
import { Store } from '../src/store.mjs';
import { route } from '../src/router.mjs';

let passed = 0, failed = 0;

function it(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; }
}

async function itAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; }
}

// HTTP dispatch helper
async function req(method, url, headers = {}, body = null) {
  const r = new Readable({ read() {} });
  r.method = method;
  r.url = url;
  r.headers = { host: 'localhost:3000', ...headers };
  r.socket = { remoteAddress: '127.0.0.1', encrypted: false };
  if (body) r.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
  r.push(null);

  let code = 200, rh = {}, rb = '';
  const res = new EventEmitter();
  res.headersSent = false;
  res.statusCode = 200;
  res.setHeader = (k, v) => { rh[k.toLowerCase()] = v; };
  res.getHeader = (k) => rh[k.toLowerCase()];
  res.writeHead = (c, h = {}) => { code = c; Object.entries(h).forEach(([k, v]) => rh[k.toLowerCase()] = v); res.headersSent = true; };
  res.write = (d) => { rb += d; return true; };
  res.end = (d = '') => { rb += d; res.headersSent = true; };

  await route(r, res);
  return { status: code, headers: rh, body: rb };
}

/* ── 1. Auth ── */
console.log('\n--- 1. Auth & Sessions ---');

it('scrypt password hashing with unique salts', () => {
  const h1 = hashPassword('test'), h2 = hashPassword('test');
  assert.notStrictEqual(h1, h2);
  assert.ok(verifyPassword('test', h1));
  assert.ok(!verifyPassword('wrong', h1));
});

it('32-byte session IDs, HttpOnly cookies, regeneration', () => {
  const s1 = createSession('u1', 'user', 3600);
  assert.strictEqual(s1.id.length, 64);
  const cookie = serializeSessionCookie(s1.id, false, 3600);
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('SameSite=Lax'));
  const s2 = regenerateSession(s1.id, 'u1');
  assert.notStrictEqual(s1.id, s2.id);
  assert.strictEqual(Store.getSession(s1.id), null);
  Store.deleteSession(s2.id);
});

it('CSRF token validation', () => {
  const s = { csrfToken: 'abc123' };
  assert.ok(validateCsrf({ headers: { 'x-csrf-token': 'abc123' } }, s));
  assert.ok(!validateCsrf({ headers: { 'x-csrf-token': 'bad' } }, s));
});

/* ── 2. API Keys ── */
console.log('\n--- 2. API Keys ---');

it('generate, extract, rotate', () => {
  Store.saveUser({ id: 'uk1', username: 'keytest', passwordHash: 'x', role: 'user', apiKey: null, createdAt: Date.now() });
  const k1 = generateApiKeyForUser('uk1');
  assert.ok(k1.startsWith('lnch_'));
  assert.strictEqual(extractApiKey({ headers: { 'x-api-key': k1 } }), k1);
  const { newKey } = rotateApiKeyForUser('uk1');
  assert.strictEqual(Store.getUserByApiKey(k1), null);
  assert.ok(Store.getUserByApiKey(newKey));
});

/* ── 3. Token Bucket ── */
console.log('\n--- 3. Token Bucket Rate Limiter ---');

it('consume, exhaust, Retry-After', () => {
  const key = 'tb_' + Date.now(), cfg = { capacity: 2, fillRate: 1 };
  assert.ok(consumeToken(key, cfg).allowed);
  assert.ok(consumeToken(key, cfg).allowed);
  const r = consumeToken(key, cfg);
  assert.ok(!r.allowed);
  assert.ok(r.retryAfter >= 1);
  const h = getRateLimitHeaders(r);
  assert.ok(h['Retry-After']);
});

/* ── 4. Security ── */
console.log('\n--- 4. Security Middleware ---');

it('host validation & path traversal', () => {
  assert.strictEqual(validateHostHeader({ headers: { host: 'localhost:3000' } }), 'localhost:3000');
  assert.throws(() => validateHostHeader({ headers: { host: 'bad<h>.com' } }), SecurityError);
  assert.strictEqual(sanitizePath('/about'), '/about');
  assert.throws(() => sanitizePath('/../etc/passwd'), SecurityError);
  assert.ok(validateServiceName('my-svc'));
  assert.ok(!validateServiceName('../evil'));
});

await itAsync('execution timeout', async () => {
  await assert.rejects(() => withExecutionTimeout(new Promise(r => setTimeout(r, 5000)), 50), SecurityError);
});

/* ── 5. Next.js File-Based Routing ── */
console.log('\n--- 5. Next.js Routing ---');

await itAsync('GET / serves pages/index.html', async () => {
  const r = await req('GET', '/');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.includes('Launcher'));
});

await itAsync('GET /about serves pages/about.html', async () => {
  const r = await req('GET', '/about');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.includes('About'));
});

await itAsync('GET /style.css serves public/style.css', async () => {
  const r = await req('GET', '/style.css');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.includes('--bg'));
});

await itAsync('GET /api/hello returns JSON', async () => {
  const r = await req('GET', '/api/hello?name=test');
  assert.strictEqual(r.status, 200);
  const d = JSON.parse(r.body);
  assert.strictEqual(d.npmPackages, 0);
  assert.strictEqual(d.query.name, 'test');
});

await itAsync('auth signup → login → SSR dashboard', async () => {
  const user = 'tst_' + Date.now();
  // signup
  const s = await req('POST', '/api/auth?action=signup', { 'content-type': 'application/json' }, { username: user, password: 'pass123' });
  assert.strictEqual(s.status, 200);
  const cookie = s.headers['set-cookie'].split(';')[0];
  // dashboard SSR
  const d = await req('GET', '/dashboard', { cookie });
  assert.strictEqual(d.status, 200);
  assert.ok(d.body.includes(user));
  assert.ok(d.body.includes('getServerSideProps'));
});

await itAsync('GET /nonexistent returns 404', async () => {
  const r = await req('GET', '/xyz-nope');
  assert.strictEqual(r.status, 404);
  assert.ok(r.body.includes('404'));
});

/* ── done ── */
console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);
if (failed) process.exit(1);
