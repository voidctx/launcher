import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRuntime, scan, deployService, runService, serviceStats,
  hasService, unregisterService, shutdownRuntime
} from '../src/index.mjs';

/**
 * These tests run hostile code straight through the runtime, WITHOUT the
 * scanner, to show that the sandbox holds even when the scanner is bypassed.
 */

const rt = createRuntime();
after(async () => {
  await rt.shutdown();
  await shutdownRuntime();
});
const GET = { method: 'GET', url: '/', headers: {} };

async function probe(source) {
  const id = 'p' + Math.random().toString(36).slice(2, 10);
  rt.register(id, { code: `export default { async server(req) {\n${source}\n} };` });
  try {
    return JSON.parse((await rt.run(id, GET)).body);
  } finally {
    rt.unregister(id);
  }
}

test('no host globals exist inside the sandbox', async () => {
  const out = await probe(`
    const r = {};
    for (const n of ['process', 'require', 'module', 'exports', 'Buffer', 'fetch', 'setTimeout', 'setInterval',
      'setImmediate', 'queueMicrotask', 'URL', 'TextEncoder', 'structuredClone', 'global', '__dirname', '__filename',
      'WebSocket', 'XMLHttpRequest', 'performance', 'navigator', 'window', 'document', 'crypto']) {
      r[n] = typeof globalThis[n];
    }
    return { body: JSON.stringify(r) };`);
  for (const [name, type] of Object.entries(out)) assert.equal(type, 'undefined', name);
});

test('eval and new Function are blocked', async () => {
  const out = await probe(`
    const r = {};
    try { r.eval = String(eval('1+1')); } catch (e) { r.eval = e.name; }
    try { r.fn = String(new Function('return 1')()); } catch (e) { r.fn = e.name; }
    try { r.indirect = String((0, eval)('1+1')); } catch (e) { r.indirect = e.name; }
    return { body: JSON.stringify(r) };`);
  assert.deepEqual(out, { eval: 'EvalError', fn: 'EvalError', indirect: 'EvalError' });
});

test('constructor chains do not reach the host', async () => {
  const out = await probe(`
    const r = {};
    const attempts = {
      arrow: () => (() => {}).constructor.constructor('return typeof process')(),
      object: () => ({}).constructor.constructor('return typeof process')(),
      global: () => globalThis.constructor.constructor('return typeof process')(),
      objectCtor: () => Object.constructor('return typeof process')(),
      reqObj: () => req.constructor.constructor('return typeof process')(),
      reqHeaders: () => req.headers.constructor.constructor('return typeof process')(),
      asyncFn: () => (async () => {}).constructor('return typeof process')(),
      genFn: () => (function* () {}).constructor('return typeof process')(),
      proto: () => Object.getPrototypeOf(globalThis).constructor.constructor('return typeof process')()
    };
    for (const [k, f] of Object.entries(attempts)) {
      try { r[k] = String(f()); } catch (e) { r[k] = 'ERR:' + e.name; }
    }
    return { body: JSON.stringify(r) };`);
  for (const [k, v] of Object.entries(out)) {
    assert.ok(v === 'undefined' || v.startsWith('ERR:'), `${k} -> ${v}`);
    assert.notEqual(v, 'object', k);
  }
});

test('dynamic import() is not possible', async () => {
  const out = await probe(`
    const r = {};
    for (const m of ['node:fs', 'fs', 'node:child_process', 'data:text/javascript,export default 1', 'file:///etc/passwd']) {
      try { await import(m); r[m] = 'LOADED'; } catch (e) { r[m] = 'blocked'; }
    }
    return { body: JSON.stringify(r) };`);
  for (const [m, v] of Object.entries(out)) assert.equal(v, 'blocked', m);
});

test('stack-trace and prototype tricks find nothing', async () => {
  const out = await probe(`
    const r = {};
    try {
      let got;
      Error.prepareStackTrace = (e, stack) => { got = stack; return 'x'; };
      new Error('x').stack;
      const fn = got && got[0] && got[0].getFunction && got[0].getFunction();
      const self = got && got[0] && got[0].getThis && got[0].getThis();
      r.callsite = [typeof fn, typeof self].join(',');
      r.viaFn = fn ? String(fn.constructor('return typeof process')()) : 'none';
    } catch (e) { r.callsite = 'ERR:' + e.name; r.viaFn = 'ERR:' + e.name; }
    try { r.proto = typeof Object.getPrototypeOf(Object.getPrototypeOf(globalThis)).process; } catch (e) { r.proto = 'ERR'; }
    return { body: JSON.stringify(r) };`);
  assert.ok(out.viaFn === 'none' || out.viaFn === 'undefined' || out.viaFn.startsWith('ERR:'), JSON.stringify(out));
  assert.equal(out.proto, 'undefined');
});

test('patching Promise.prototype.then cannot capture anything from the host', async () => {
  const out = await probe(`
    const seen = [];
    const orig = Promise.prototype.then;
    Promise.prototype.then = function (a, b) {
      try { seen.push(typeof a === 'function' ? String(a.constructor('return typeof process')()) : typeof a); } catch (e) { seen.push('ERR:' + e.name); }
      return orig.call(this, a, b);
    };
    await null;
    return { body: JSON.stringify(seen) };`);
  for (const v of out) assert.ok(v === 'undefined' || v === 'function' || v.startsWith('ERR:'), v);
  assert.ok(!out.includes('object'));
});

test('the bridge cannot be replaced or removed', async () => {
  const out = await probe(`
    const r = {};
    try { globalThis.__bridge = { start() {}, poll() { return 'Ofake'; } }; r.assign = 'assigned'; } catch (e) { r.assign = e.name; }
    try { r.del = String(delete globalThis.__bridge); } catch (e) { r.del = e.name; }
    r.still = typeof __bridge;
    return { body: JSON.stringify(r) };`);
  assert.equal(out.still, 'object');
  assert.notEqual(out.del, 'true');
});

test('a service that corrupts built-ins only hurts itself', async () => {
  const id = 'corrupt';
  rt.register(id, {
    code: `export default { async server() {
      JSON.stringify = () => { throw new Error('nope'); };
      JSON.parse = () => { throw new Error('nope'); };
      Promise.resolve = () => { throw new Error('nope'); };
      return { body: 'still answers' };
    } };`
  });
  const r = await rt.run(id, GET);
  assert.equal(r.body, 'still answers');
  assert.equal((await rt.run(id, GET)).body, 'still answers');
});

test('a service cannot see or touch the worker environment', async () => {
  process.env.TAMO_SECRET_FOR_TEST = 'top-secret';
  const out = await probe(`
    let leaked = 'none';
    try { leaked = String(globalThis.process && globalThis.process.env.TAMO_SECRET_FOR_TEST); } catch (e) { leaked = 'ERR'; }
    return { body: JSON.stringify({ leaked }) };`);
  assert.ok(out.leaked === 'undefined' || out.leaked === 'ERR' || out.leaked === 'none');
  assert.notEqual(out.leaked, 'top-secret');
  delete process.env.TAMO_SECRET_FOR_TEST;
});

// ---------------------------------------------------------------- scanner + runtime together

test('deployService: approved code is registered and runs', async () => {
  const code = `export default { async server(req) { return { body: 'deployed ' + req.path }; } };`;
  const { deployed, report } = deployService('dep-ok', code);
  assert.equal(deployed, true);
  assert.equal(report.verdict, 'approved');
  assert.ok(hasService('dep-ok'));
  const r = await runService('dep-ok', { method: 'GET', url: '/dep-ok' });
  assert.equal(r.body, 'deployed /dep-ok');
  assert.equal(serviceStats().services.find((s) => s.id === 'dep-ok').state, 'ready');
  unregisterService('dep-ok');
});

test('deployService: rejected code is never registered', () => {
  const { deployed, report } = deployService('dep-bad', `export default { async server() { process.exit(); } };`, { allowFlagged: true });
  assert.equal(deployed, false);
  assert.equal(report.verdict, 'rejected');
  assert.equal(hasService('dep-bad'), false);
});

test('deployService: flagged code needs explicit approval', async () => {
  const code = `export default { async server() { return { body: typeof globalThis }; } };`;
  const first = deployService('dep-flag', code);
  assert.equal(first.deployed, false);
  assert.equal(first.report.verdict, 'flagged');
  assert.equal(hasService('dep-flag'), false);
  const second = deployService('dep-flag', code, { allowFlagged: true });
  assert.equal(second.deployed, true);
  assert.equal((await runService('dep-flag', { url: '/' })).body, 'object');
  unregisterService('dep-flag');
});

test('everything the scanner approves can actually be loaded and run', async () => {
  const samples = [
    `export default { async server() { return { body: 'a' }; } };`,
    `let n = 0;\nexport default { async server() { n++; return { body: String(n) }; } };`,
    'export default { async server(req) { return { headers: { "content-type": "text/html" }, body: `<p>${req.method}</p>` }; } };',
    `const helper = (x) => x * 2;\nexport default { server: async (req) => ({ body: String(helper(21)) }) };`,
    `export default { server(req) { return { body: 'sync handler' }; } };`
  ];
  for (const [i, code] of samples.entries()) {
    const report = scan(code);
    assert.equal(report.verdict, 'approved', code);
    const id = 'ap' + i;
    rt.register(id, { code });
    const r = await rt.run(id, GET);
    assert.equal(r.status, 200, code);
    rt.unregister(id);
  }
});
