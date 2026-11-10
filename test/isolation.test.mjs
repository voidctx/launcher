import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime, ServiceError } from '../src/index.mjs';

const runtimes = [];
function newRuntime(options) {
  const rt = createRuntime(options);
  runtimes.push(rt);
  return rt;
}
after(async () => {
  await Promise.all(runtimes.map((rt) => rt.shutdown()));
});

const GET = (url = '/') => ({ method: 'GET', url, headers: {} });
const mod = (body, top = '') => `${top}\nexport default { async server(req) { ${body} } };`;

const COUNTER = mod(`count++; return { status: 200, body: String(count) };`, 'let count = 0;');

// ---------------------------------------------------------------- lifecycle

test('lazy loading: nothing is started until the first request', async () => {
  const rt = newRuntime();
  rt.register('c', { code: COUNTER });
  let s = rt.stats();
  assert.equal(s.registered, 1);
  assert.equal(s.loaded, 0);
  assert.equal(s.services[0].state, 'unloaded');

  const r1 = await rt.run('c', GET());
  assert.equal(r1.body, '1');
  assert.equal(r1.meta.coldStart, true);
  assert.ok(r1.meta.coldStartMs > 0);

  const r2 = await rt.run('c', GET());
  assert.equal(r2.body, '2', 'module state survives between requests while loaded');
  assert.equal(r2.meta.coldStart, false);

  s = rt.stats();
  assert.equal(s.loaded, 1);
  assert.equal(s.services[0].state, 'ready');
  assert.equal(s.services[0].coldStarts, 1);
  assert.equal(s.services[0].requests, 2);
});

test('unload frees the worker; the next request cold-starts with fresh state', async () => {
  const rt = newRuntime();
  rt.register('c', { code: COUNTER });
  await rt.run('c', GET());
  await rt.run('c', GET());
  assert.equal(rt.unload('c'), true);
  assert.equal(rt.stats().services[0].state, 'unloaded');
  const r = await rt.run('c', GET());
  assert.equal(r.body, '1');
  assert.equal(r.meta.coldStart, true);
  assert.equal(rt.stats().services[0].coldStarts, 2);
});

test('unload refuses to evict a busy service unless forced', async () => {
  const rt = newRuntime();
  rt.register('slow', { code: mod(`const t = Date.now(); while (Date.now() - t < 200) {} return { body: 'x' };`) });
  await rt.run('slow', GET()); // load it
  const p = rt.run('slow', GET());
  assert.equal(rt.unload('slow'), false);
  await p;
  assert.equal(rt.unload('slow'), true);
});

test('services are independent of each other', async () => {
  const rt = newRuntime();
  rt.register('a', { code: mod(`globalThis.leak = 'A'; return { body: 'a' };`) });
  rt.register('b', { code: mod(`return { body: String(globalThis.leak) };`) });
  await rt.run('a', GET());
  assert.equal((await rt.run('b', GET())).body, 'undefined');
});

test('a service cannot change the host (prototype pollution stays inside)', async () => {
  const rt = newRuntime();
  rt.register('p', { code: mod(`Object.prototype.polluted = 'yes'; Array.prototype.polluted = 'yes'; return { body: 'x' };`) });
  await rt.run('p', GET());
  assert.equal({}.polluted, undefined);
  assert.equal([].polluted, undefined);
});

test('re-register replaces the code and resets state (hot update)', async () => {
  const rt = newRuntime();
  rt.register('s', { code: mod(`return { body: 'v1' };`) });
  assert.equal((await rt.run('s', GET())).body, 'v1');
  rt.register('s', { code: mod(`return { body: 'v2' };`) });
  const r = await rt.run('s', GET());
  assert.equal(r.body, 'v2');
  assert.equal(r.meta.coldStart, true);
});

test('unregister removes the service', async () => {
  const rt = newRuntime();
  rt.register('s', { code: COUNTER });
  await rt.run('s', GET());
  assert.equal(rt.unregister('s'), true);
  assert.equal(rt.has('s'), false);
  await assert.rejects(rt.run('s', GET()), { code: 'SERVICE_NOT_FOUND', status: 404 });
  assert.equal(rt.unregister('s'), false);
});

test('file based services are read lazily and re-read after unload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamo-'));
  const file = path.join(dir, 'svc.mjs');
  fs.writeFileSync(file, mod(`return { body: 'one' };`));
  const rt = newRuntime();
  rt.register('f', { file });
  assert.equal((await rt.run('f', GET())).body, 'one');
  fs.writeFileSync(file, mod(`return { body: 'two' };`));
  assert.equal((await rt.run('f', GET())).body, 'one', 'still the loaded version');
  rt.unload('f');
  assert.equal((await rt.run('f', GET())).body, 'two');
  fs.rmSync(file);
  rt.unload('f');
  await assert.rejects(rt.run('f', GET()), { code: 'LOAD_FAILED' });
  fs.rmSync(dir, { recursive: true });
});

test('register validates its input', () => {
  const rt = newRuntime();
  assert.throws(() => rt.register('../x', { code: COUNTER }), { code: 'INVALID_SOURCE' });
  assert.throws(() => rt.register('', { code: COUNTER }), { code: 'INVALID_SOURCE' });
  assert.throws(() => rt.register('x', {}), { code: 'INVALID_SOURCE' });
  assert.throws(() => rt.register('x', { code: COUNTER, file: '/tmp/x' }), { code: 'INVALID_SOURCE' });
  assert.throws(() => rt.register('x', { code: 'this is not javascript' }), { code: 'INVALID_SOURCE' });
  assert.throws(() => rt.register('x', { code: 'export default {};' + 'a'.repeat(300 * 1024) }), { code: 'INVALID_SOURCE' });
});

test('a module without server() fails to load', async () => {
  const rt = newRuntime();
  rt.register('n', { code: `export default { hello() {} };` });
  await assert.rejects(rt.run('n', GET()), { code: 'LOAD_FAILED' });
  assert.equal(rt.stats().services[0].state, 'unloaded');
});

test('top-level code that throws fails to load', async () => {
  const rt = newRuntime();
  rt.register('t', { code: `throw new Error('boom at load');\nexport default { async server() { return {}; } };` });
  await assert.rejects(rt.run('t', GET()), (e) => e.code === 'LOAD_FAILED' && /boom at load/.test(e.detail));
});

test('top-level infinite loop is stopped at load time', async () => {
  const rt = newRuntime({ initTimeoutMs: 300 });
  rt.register('t', { code: `while (true) {}\nexport default { async server() { return {}; } };` });
  const t0 = performance.now();
  await assert.rejects(rt.run('t', GET()), { code: 'TIMEOUT' });
  assert.ok(performance.now() - t0 < 3000);
});

// ---------------------------------------------------------------- time limits

test('a synchronous infinite loop is stopped and does not block the gateway', async () => {
  const rt = newRuntime({ timeoutMs: 400 });
  rt.register('spin', { code: mod(`while (true) {}`) });
  let ticks = 0;
  const iv = setInterval(() => ticks++, 10);
  const t0 = performance.now();
  await assert.rejects(rt.run('spin', GET()), { code: 'TIMEOUT', status: 504 });
  const ms = performance.now() - t0;
  clearInterval(iv);
  assert.ok(ms < 400 + 1500, `took ${ms}ms`);
  assert.ok(ticks >= 15, `event loop only ticked ${ticks} times: the gateway was blocked`);
});

test('after a timeout the service restarts with fresh state', async () => {
  const rt = newRuntime({ timeoutMs: 300 });
  rt.register('s', {
    code: mod(`if (req.path === '/spin') { while (true) {} } count++; return { body: String(count) };`, 'let count = 0;')
  });
  assert.equal((await rt.run('s', GET('/'))).body, '1');
  assert.equal((await rt.run('s', GET('/'))).body, '2');
  await assert.rejects(rt.run('s', GET('/spin')), { code: 'TIMEOUT' });
  const r = await rt.run('s', GET('/'));
  assert.equal(r.body, '1');
  assert.equal(r.meta.coldStart, true);
  const st = rt.stats().services[0];
  assert.equal(st.timeouts, 1);
  assert.equal(st.crashes, 1);
});

test('an endless promise loop (microtask starvation) is stopped', async () => {
  const rt = newRuntime({ timeoutMs: 300 });
  rt.register('m', { code: mod(`for (;;) { await null; }`) });
  await assert.rejects(rt.run('m', GET()), { code: 'TIMEOUT' });
});

test('catastrophic regex backtracking is stopped', async () => {
  const rt = newRuntime({ timeoutMs: 300 });
  rt.register('re', { code: mod(`return { body: String(/^(a+)+$/.test('a'.repeat(60) + 'b')) };`) });
  await assert.rejects(rt.run('re', GET()), { code: 'TIMEOUT' });
});

test('a handler that waits for something that never happens reports an error', async () => {
  const rt = newRuntime();
  rt.register('h', { code: mod(`await new Promise(() => {}); return {};`) });
  await assert.rejects(rt.run('h', GET()), (e) => e.code === 'HANDLER_ERROR' && /did not finish/.test(e.detail));
});

// ---------------------------------------------------------------- memory limits

test('out-of-memory kills only that worker; the gateway and other services live on', async () => {
  const rt = newRuntime({ timeoutMs: 10_000 });
  rt.register('hog', {
    code: mod(`const a = []; for (;;) a.push(new Array(10000).fill('x'));`),
    limits: { maxOldGenerationSizeMb: 32 }
  });
  rt.register('ok', { code: COUNTER });
  await rt.run('ok', GET());
  const before = process.memoryUsage().rss;
  await assert.rejects(rt.run('hog', GET()), { code: 'OUT_OF_MEMORY' });
  assert.equal((await rt.run('ok', GET())).body, '2', 'other service untouched');
  assert.ok(process.memoryUsage().rss - before < 400 * 1024 * 1024, 'host memory stayed bounded');
  assert.equal(rt.stats().services.find((s) => s.id === 'hog').state, 'unloaded');
});

test('binary buffers (memory the heap limit cannot see) are not available', async () => {
  const rt = newRuntime();
  rt.register('buf', {
    code: mod(`
      const r = {};
      for (const n of ['ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Float64Array', 'DataView', 'WebAssembly', 'Atomics']) {
        r[n] = typeof globalThis[n];
      }
      try { new ArrayBuffer(1 << 30); r.alloc = 'allocated'; } catch (e) { r.alloc = e.name; }
      return { body: JSON.stringify(r) };`)
  });
  const out = JSON.parse((await rt.run('buf', GET())).body);
  for (const n of ['ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Float64Array', 'DataView', 'WebAssembly', 'Atomics']) {
    assert.equal(out[n], 'undefined', n);
  }
  assert.equal(out.alloc, 'ReferenceError');
});

test('deep recursion is an ordinary handler error', async () => {
  const rt = newRuntime();
  rt.register('r', { code: mod(`function f(n) { return f(n + 1) + 1; } return { body: String(f(0)) };`) });
  await assert.rejects(rt.run('r', GET()), (e) => e.code === 'HANDLER_ERROR' && /call stack/i.test(e.detail));
  assert.equal(rt.stats().services[0].coldStarts, 1);
  assert.equal(rt.stats().services[0].state, 'ready', 'a normal exception does not recycle the worker');
});

// ---------------------------------------------------------------- errors inside the service

test('exceptions are reported and the worker keeps its state', async () => {
  const rt = newRuntime();
  rt.register('e', {
    code: mod(`count++; if (req.path === '/boom') throw new Error('kaboom'); return { body: String(count) };`, 'let count = 0;')
  });
  assert.equal((await rt.run('e', GET('/'))).body, '1');
  await assert.rejects(rt.run('e', GET('/boom')), (e) => e.code === 'HANDLER_ERROR' && e.status === 500 && /kaboom/.test(e.detail));
  assert.equal((await rt.run('e', GET('/'))).body, '3');
  assert.equal(rt.stats().services[0].coldStarts, 1);
});

test('the public message never contains service-written text', async () => {
  const rt = newRuntime();
  rt.register('e', { code: mod(`throw new Error('secret internals <script>');`) });
  await assert.rejects(rt.run('e', GET()), (e) => !/secret/.test(e.message) && !/secret/.test(e.publicMessage) && /secret/.test(e.detail));
});

test('an unhandled rejection inside a service does not crash the worker', async () => {
  const rt = newRuntime();
  rt.register('u', { code: mod(`Promise.reject(new Error('nobody listens')); return { body: 'fine' };`) });
  assert.equal((await rt.run('u', GET())).body, 'fine');
  assert.equal((await rt.run('u', GET())).body, 'fine');
  assert.equal(rt.stats().services[0].coldStarts, 1);
});

test('console output is collected per request', async () => {
  const rt = newRuntime();
  rt.register('l', { code: mod(`console.log('hello', { a: 1 }); console.error('bad'); return { body: 'x' };`) });
  const r1 = await rt.run('l', GET());
  assert.deepEqual(r1.logs, ['hello {"a":1}', 'bad']);
  const r2 = await rt.run('l', GET());
  assert.deepEqual(r2.logs, ['hello {"a":1}', 'bad'], 'logs are reset for every request');
});

test('log volume is capped', async () => {
  const rt = newRuntime();
  rt.register('l', { code: mod(`for (let i = 0; i < 1000; i++) console.log('x'.repeat(1000)); return { body: 'x' };`) });
  const r = await rt.run('l', GET());
  assert.equal(r.logs.length, 50);
  assert.ok(r.logs.every((l) => l.length <= 300));
});

// ---------------------------------------------------------------- request handling

test('the service sees a normalised request without platform credentials', async () => {
  const rt = newRuntime();
  rt.register('q', {
    code: mod(`return { body: JSON.stringify({ m: req.method, p: req.path, q: req.query, h: req.headers, b: req.body, u: req.url }) };`)
  });
  const r = await rt.run('q', {
    method: 'post',
    url: '/q/sub?x=1&x=2&y=3',
    headers: {
      Cookie: 'launcher_session=SECRET',
      Authorization: 'Bearer SECRET',
      'X-API-Key': 'SECRET',
      'X-CSRF-Token': 'SECRET',
      'User-Agent': 'tester',
      Accept: ['a', 'b']
    },
    body: '{"k":1}'
  });
  const seen = JSON.parse(r.body);
  assert.equal(seen.m, 'POST');
  assert.equal(seen.p, '/q/sub');
  assert.deepEqual(seen.q, { x: ['1', '2'], y: '3' });
  assert.equal(seen.h['user-agent'], 'tester');
  assert.equal(seen.h.accept, 'a, b');
  assert.equal(seen.b, '{"k":1}');
  assert.equal(seen.u, '/q/sub?x=1&x=2&y=3');
  assert.ok(!r.body.includes('SECRET'), 'no credential reaches the service');
});

test('query parameters named like object internals are plain data', async () => {
  const rt = newRuntime();
  rt.register('q', { code: mod(`return { body: JSON.stringify({ k: Object.keys(req.query), polluted: ({}).x }) };`) });
  const r = await rt.run('q', GET('/q?__proto__=1&constructor=2&x=3'));
  const seen = JSON.parse(r.body);
  assert.deepEqual(seen.k.sort(), ['__proto__', 'constructor', 'x']);
  assert.equal(seen.polluted, undefined);
});

test('invalid requests are rejected before reaching the service', async () => {
  const rt = newRuntime({ maxRequestBytes: 100 });
  rt.register('q', { code: COUNTER });
  await assert.rejects(rt.run('q', null), { code: 'BAD_REQUEST', status: 400 });
  await assert.rejects(rt.run('q', { method: 'GE T', url: '/' }), { code: 'BAD_REQUEST' });
  await assert.rejects(rt.run('q', { method: 'GET', url: 'http://[bad' }), { code: 'BAD_REQUEST' });
  await assert.rejects(rt.run('q', { url: '/', headers: 'nope' }), { code: 'BAD_REQUEST' });
  await assert.rejects(rt.run('q', { url: '/', body: 42 }), { code: 'BAD_REQUEST' });
  await assert.rejects(rt.run('q', { url: '/' + 'a'.repeat(9000) }), { code: 'BAD_REQUEST' });
  await assert.rejects(rt.run('q', { method: 'POST', url: '/', body: 'x'.repeat(101) }), { code: 'REQUEST_TOO_LARGE', status: 413 });
  assert.equal(rt.stats().services[0].coldStarts, 0, 'rejected requests never start a worker');
  assert.equal((await rt.run('q', { method: 'POST', url: '/', body: Buffer.from('ok') })).body, '1');
});

test('unknown service', async () => {
  const rt = newRuntime();
  await assert.rejects(rt.run('nope', GET()), (e) => e instanceof ServiceError && e.code === 'SERVICE_NOT_FOUND');
});

// ---------------------------------------------------------------- response handling

async function respond(result, options) {
  const rt = newRuntime(options);
  rt.register('r', { code: mod(`return ${result};`) });
  return rt.run('r', GET());
}

test('response defaults and forced headers', async () => {
  const r = await respond(`{ body: 'hi' }`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-security-policy'], 'sandbox');
  assert.equal(r.body, 'hi');
  const empty = await respond(`{}`);
  assert.equal(empty.body, '');
});

test('a service cannot override the forced headers', async () => {
  const r = await respond(`{ headers: { 'Content-Security-Policy': "default-src *", 'X-Content-Type-Options': 'x' }, body: '' }`);
  assert.equal(r.headers['content-security-policy'], 'sandbox');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('forced headers can be turned off', async () => {
  const r = await respond(`{ body: '' }`, { forceResponseHeaders: {} });
  assert.equal(r.headers['content-security-policy'], undefined);
});

test('set-cookie and connection-level headers are removed with a warning', async () => {
  const r = await respond(`{ headers: { 'Set-Cookie': 'launcher_session=x', 'Content-Length': '5', 'Transfer-Encoding': 'chunked', 'X-Ok': 'yes' }, body: 'x' }`);
  assert.equal(r.headers['set-cookie'], undefined);
  assert.equal(r.headers['content-length'], undefined);
  assert.equal(r.headers['transfer-encoding'], undefined);
  assert.equal(r.headers['x-ok'], 'yes');
  assert.equal(r.warnings.length, 3);
});

test('invalid responses are rejected with BAD_RESPONSE', async () => {
  const bad = [
    `'just a string'`,
    `[1, 2]`,
    `{ status: 99 }`,
    `{ status: 700 }`,
    `{ status: '200' }`,
    `{ status: 200.5 }`,
    `{ status: 101 }`,
    `{ body: { a: 1 } }`,
    `{ body: 42 }`,
    `{ headers: [] }`,
    `{ headers: 'x' }`,
    `{ headers: { 'bad name': 'x' } }`,
    `{ headers: { x: 'a\\r\\nSet-Cookie: evil=1' } }`,
    `{ headers: { x: { a: 1 } } }`
  ];
  for (const expr of bad) {
    await assert.rejects(respond(expr), { code: 'BAD_RESPONSE', status: 502 }, expr);
  }
});

test('returning nothing is an error', async () => {
  await assert.rejects(respond(`undefined`), { code: 'HANDLER_ERROR' });
});

test('response size limit', async () => {
  await assert.rejects(respond(`{ body: 'x'.repeat(5000) }`, { maxResponseBytes: 1000 }), { code: 'RESPONSE_TOO_LARGE' });
  const ok = await respond(`{ body: 'x'.repeat(900) }`, { maxResponseBytes: 1000 });
  assert.equal(ok.body.length, 900);
});

test('unicode survives the round trip', async () => {
  const r = await respond(`{ body: 'héllo ✓ 日本語 \u{1F600}' }`);
  assert.equal(r.body, 'héllo ✓ 日本語 \u{1F600}');
});

// ---------------------------------------------------------------- concurrency

test('a burst against an unloaded service starts exactly one worker', async () => {
  const rt = newRuntime();
  rt.register('c', { code: COUNTER });
  const results = await Promise.all(Array.from({ length: 50 }, () => rt.run('c', GET())));
  const counts = results.map((r) => Number(r.body)).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(results.filter((r) => r.meta.coldStart).length, 1);
  assert.equal(rt.stats().services[0].coldStarts, 1);
});

test('the queue is bounded', async () => {
  const rt = newRuntime({ maxQueue: 3 });
  rt.register('slow', { code: mod(`const t = Date.now(); while (Date.now() - t < 100) {} return { body: 'x' };`) });
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => rt.run('slow', GET())));
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(rejected.length, 2);
  for (const o of rejected) assert.equal(o.reason.code, 'QUEUE_FULL');
  assert.equal(rejected[0].reason.status, 503);
  assert.equal(rejected[0].reason.retryAfterSec, 1);
});

test('different services run in parallel', async () => {
  const rt = newRuntime();
  const busy = mod(`const t = Date.now(); while (Date.now() - t < 300) {} return { body: 'x' };`);
  rt.register('a', { code: busy });
  rt.register('b', { code: busy });
  await Promise.all([rt.run('a', GET()), rt.run('b', GET())]); // warm both
  const t0 = performance.now();
  await Promise.all([rt.run('a', GET()), rt.run('b', GET())]);
  const ms = performance.now() - t0;
  if (os.cpus().length > 1) assert.ok(ms < 550, `took ${ms}ms, expected parallel execution`);
});

// ---------------------------------------------------------------- crash loops

test('a service that keeps failing is quarantined, then recovers', async () => {
  const rt = newRuntime({ timeoutMs: 100, crashLimit: 3, quarantineMs: 700 });
  rt.register('bad', { code: mod(`while (true) {}`) });
  for (let i = 0; i < 3; i++) await assert.rejects(rt.run('bad', GET()), { code: 'TIMEOUT' });
  const t0 = performance.now();
  await assert.rejects(rt.run('bad', GET()), (e) => e.code === 'QUARANTINED' && e.status === 503 && e.retryAfterSec >= 1);
  assert.ok(performance.now() - t0 < 50, 'quarantined requests fail immediately');
  assert.equal(rt.stats().services[0].state, 'quarantined');
  await new Promise((r) => setTimeout(r, 800));
  await assert.rejects(rt.run('bad', GET()), { code: 'TIMEOUT' }, 'after the quarantine it is tried again');
});

test('other services are unaffected by a quarantined one', async () => {
  const rt = newRuntime({ timeoutMs: 100, crashLimit: 2, quarantineMs: 5000 });
  rt.register('bad', { code: mod(`while (true) {}`) });
  rt.register('good', { code: COUNTER });
  for (let i = 0; i < 2; i++) await assert.rejects(rt.run('bad', GET()), { code: 'TIMEOUT' });
  await assert.rejects(rt.run('bad', GET()), { code: 'QUARANTINED' });
  assert.equal((await rt.run('good', GET())).body, '1');
});

// ---------------------------------------------------------------- shutdown / stats

test('stats expose what a dashboard needs', async () => {
  const rt = newRuntime();
  rt.register('c', { code: COUNTER });
  await rt.run('c', GET());
  const s = rt.stats().services[0];
  for (const key of ['id', 'state', 'requests', 'errors', 'timeouts', 'crashes', 'coldStarts', 'lastColdStartMs',
    'lastHeapUsedBytes', 'queueLength', 'inFlight', 'loadedAt', 'lastUsedAt', 'quarantinedUntil']) {
    assert.ok(key in s, `missing ${key}`);
  }
  assert.ok(s.lastHeapUsedBytes > 0);
  assert.ok(s.lastColdStartMs > 0);
  assert.equal(s.queueLength, 0);
});

test('shutdown stops workers and rejects new and queued work', async () => {
  const rt = createRuntime();
  rt.register('slow', { code: mod(`const t = Date.now(); while (Date.now() - t < 300) {} return { body: 'x' };`) });
  const running = rt.run('slow', GET());
  const queued = rt.run('slow', GET());
  const settled = Promise.allSettled([running, queued]);
  await new Promise((r) => setTimeout(r, 100));
  await rt.shutdown();
  const [a, b] = await settled;
  assert.equal(a.status, 'rejected');
  assert.equal(b.status, 'rejected');
  assert.equal(a.reason.code, 'SHUTTING_DOWN');
  await assert.rejects(rt.run('slow', GET()), { code: 'SHUTTING_DOWN' });
  assert.equal(rt.stats().loaded, 0);
});
