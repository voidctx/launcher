import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';
import v8 from 'node:v8';
import { performance } from 'node:perf_hooks';
import { sanitizeResponse } from './protocol.mjs';
import { FUNCTION_PARAMS, SOURCE_FILENAME } from './source.mjs';

const { timeoutMs, initTimeoutMs, maxResponseBytes, forceResponseHeaders } = workerData;
const MAX_LOG_LINES = 50;

const blockDynamicImport = () => {
  throw new Error('Dynamic import is blocked in this sandbox');
};

const BOOTSTRAP = `(function () {
  'use strict';
  var g = globalThis;
  var REMOVE = [
    'SharedArrayBuffer', 'Atomics', 'WebAssembly', 'ArrayBuffer', 'DataView',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
    'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
    'BigUint64Array', 'Float16Array', 'FinalizationRegistry', 'WeakRef'
  ];
  for (var i = 0; i < REMOVE.length; i++) {
    try { delete g[REMOVE[i]]; } catch (e) {}
  }

  var presolve = Promise.resolve.bind(Promise);
  var pthen = Promise.prototype.then;
  var parse = JSON.parse;
  var stringify = JSON.stringify;
  var logs = [];

  function fmt(v) {
    if (typeof v === 'string') return v;
    try { var s = stringify(v); return s === undefined ? String(v) : s; } catch (e) { return '[unserializable]'; }
  }
  function log() {
    if (logs.length >= ${MAX_LOG_LINES}) return;
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
    var s = parts.join(' ');
    logs.push(s.length > 300 ? s.slice(0, 300) : s);
  }
  g.console = { log: log, info: log, warn: log, error: log, debug: log };

  function errMsg(e) {
    try {
      var m = (e !== null && typeof e === 'object' && 'message' in e) ? e.message : e;
      m = String(m);
      return m.length > 300 ? m.slice(0, 300) : m;
    } catch (x) { return 'error'; }
  }

  var handler = null;
  var state = null;

  function init(fn) {
    try {
      var ex = { default: undefined };
      fn(ex);
      var d = ex.default;
      if (d === null || (typeof d !== 'object' && typeof d !== 'function') || typeof d.server !== 'function') {
        return 'EThe module must export default an object with a server(req) function';
      }
      handler = d;
      return 'OK';
    } catch (e) { return 'E' + errMsg(e); }
  }

  function start(reqJson) {
    state = { s: 'pending' };
    logs.length = 0;
    var req;
    try { req = parse(reqJson); } catch (e) { state = { s: 'error', m: 'bad request' }; return; }
    var p;
    try { p = presolve(handler.server(req)); } catch (e) { state = { s: 'error', m: errMsg(e) }; return; }
    pthen.call(p, function (v) {
      try {
        var j = stringify(v);
        state = (j === undefined) ? { s: 'error', m: 'the handler returned undefined' } : { s: 'ok', j: j };
      } catch (e) { state = { s: 'error', m: errMsg(e) }; }
    }, function (e) { state = { s: 'error', m: errMsg(e) }; });
  }

  function poll() {
    var st = state;
    if (st === null) return 'N';
    if (st.s === 'ok') return 'O' + st.j;
    if (st.s === 'error') return 'E' + st.m;
    return 'P';
  }

  function dumpLogs() { return stringify(logs); }

  Object.defineProperty(g, '__bridge', {
    value: Object.freeze({ init: init, start: start, poll: poll, logs: dumpLogs }),
    writable: false, configurable: false, enumerable: false
  });
})()`;

let sandbox = null;
let ctx = null;

function post(msg) {
  parentPort.postMessage(msg);
}

function hostError(e) {
  if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { code: 'TIMEOUT' };
  let message = 'error';
  try { message = String((e && e.message) || e).slice(0, 300); } catch {}
  return { code: 'HANDLER_ERROR', message };
}

function createContext() {
  sandbox = Object.create(null);
  ctx = vm.createContext(sandbox, {
    name: 'service',
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate'
  });
  vm.runInContext(BOOTSTRAP, ctx, {
    timeout: initTimeoutMs,
    filename: 'bootstrap.js',
    importModuleDynamically: blockDynamicImport
  });
}

function handleInit(m) {
  const t0 = performance.now();
  try {
    createContext();
    const fn = vm.compileFunction(m.body, FUNCTION_PARAMS, {
      filename: SOURCE_FILENAME,
      parsingContext: ctx,
      importModuleDynamically: blockDynamicImport
    });
    sandbox.__fn = fn;
    let r;
    try {
      r = vm.runInContext('__bridge.init(__fn)', ctx, {
        timeout: initTimeoutMs,
        filename: 'init.js',
        importModuleDynamically: blockDynamicImport
      });
    } finally {
      delete sandbox.__fn;
    }
    if (typeof r !== 'string') {
      return post({ type: 'init-error', message: 'unexpected result from the service loader' });
    }
    if (r === 'OK') return post({ type: 'ready', loadMs: performance.now() - t0 });
    return post({ type: 'init-error', message: r.slice(1) });
  } catch (e) {
    const he = hostError(e);
    return post({
      type: 'init-error',
      timeout: he.code === 'TIMEOUT',
      message: he.code === 'TIMEOUT' ? 'the top-level code of the service ran too long' : he.message
    });
  }
}

async function handleReq(m) {
  const t0 = performance.now();
  try {
    vm.runInContext('__bridge.start(' + JSON.stringify(m.reqJson) + ')', ctx, {
      timeout: timeoutMs,
      filename: 'invoke.js',
      importModuleDynamically: blockDynamicImport
    });
  } catch (e) {
    return post({ type: 'res', id: m.id, error: hostError(e) });
  }

  let out;
  let logJson;
  try {
    out = vm.runInContext('__bridge.poll()', ctx, {
      timeout: 1000,
      filename: 'poll.js',
      importModuleDynamically: blockDynamicImport
    });

    // Allow microtask ticks for async continuations to settle
    for (let i = 0; i < 50 && out === 'P'; i++) {
      await new Promise((r) => setImmediate(r));
      out = vm.runInContext('__bridge.poll()', ctx, {
        timeout: 1000,
        filename: 'poll.js',
        importModuleDynamically: blockDynamicImport
      });
    }

    logJson = vm.runInContext('__bridge.logs()', ctx, {
      timeout: 1000,
      filename: 'logs.js',
      importModuleDynamically: blockDynamicImport
    });
  } catch (e) {
    return post({ type: 'res', id: m.id, error: hostError(e) });
  }
  if (typeof out !== 'string') {
    return post({ type: 'res', id: m.id, error: { code: 'BAD_RESPONSE', message: 'unexpected result from the service' } });
  }

  const tag = out[0];
  if (tag === 'E') {
    return post({ type: 'res', id: m.id, error: { code: 'HANDLER_ERROR', message: out.slice(1, 301) } });
  }
  if (tag !== 'O') {
    return post({
      type: 'res',
      id: m.id,
      error: { code: 'HANDLER_ERROR', message: 'the handler did not finish (it waits for something that can never happen)' }
    });
  }
  if (out.length > maxResponseBytes + 1024) {
    return post({ type: 'res', id: m.id, error: { code: 'RESPONSE_TOO_LARGE' } });
  }

  let parsed;
  try {
    parsed = JSON.parse(out.slice(1));
  } catch {
    return post({ type: 'res', id: m.id, error: { code: 'BAD_RESPONSE', message: 'result is not valid JSON' } });
  }

  let response;
  try {
    response = sanitizeResponse(parsed, { maxResponseBytes, forceResponseHeaders });
  } catch (e) {
    return post({
      type: 'res',
      id: m.id,
      error: { code: e.code || 'BAD_RESPONSE', message: e.detail || e.message }
    });
  }

  let logs = [];
  try {
    const arr = JSON.parse(typeof logJson === 'string' ? logJson : '[]');
    if (Array.isArray(arr)) logs = arr.filter((x) => typeof x === 'string').slice(0, MAX_LOG_LINES);
  } catch {}

  post({
    type: 'res',
    id: m.id,
    ok: true,
    response,
    logs,
    handlerMs: performance.now() - t0,
    heapUsedBytes: v8.getHeapStatistics().used_heap_size
  });
}

process.on('unhandledRejection', () => {});

parentPort.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init') handleInit(m);
  else if (m.type === 'req') handleReq(m);
});
