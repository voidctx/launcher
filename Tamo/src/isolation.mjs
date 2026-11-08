import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { RUNTIME_DEFAULTS } from './config.mjs';
import { ServiceError } from './errors.mjs';
import { analyze } from './source.mjs';
import { normalizeRequest, sanitizeResponse } from './protocol.mjs';

/**
 * Runtime that executes services in isolation.
 *
 *   const rt = createRuntime(options?);
 *   rt.register(id, { code | file, limits? })   make a service known (no worker yet)
 *   await rt.run(id, { method, url, headers, body })
 *        -> { status, headers, body, logs, warnings, meta }
 *   rt.unload(id, { force? })    stop the worker, keep the registration
 *   rt.unregister(id)            stop the worker, forget the service
 *   rt.stats()                   per-service state for dashboards
 *   await rt.shutdown()
 *
 * Lifecycle of a service:  registered -> (first request) loading -> ready
 * -> (unload / crash / timeout) -> unloaded -> (next request) loading ...
 *
 * One worker thread per service, one request at a time per worker. Requests
 * that arrive while the service is busy or still loading wait in a queue, so
 * a burst against an unloaded service starts exactly one worker.
 */

const WORKER_URL = new URL('./sandbox-worker.mjs', import.meta.url);
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function createRuntime(userOptions = {}) {
  const options = { ...RUNTIME_DEFAULTS, ...userOptions };
  const services = new Map();
  let closed = false;

  // ---------------------------------------------------------------- helpers

  function limitsFor(entry) {
    return { ...options, ...entry.limits };
  }

  function getEntry(id) {
    const entry = services.get(id);
    if (!entry) throw new ServiceError('SERVICE_NOT_FOUND');
    return entry;
  }

  function readSource(entry) {
    const lim = limitsFor(entry);
    let code;
    if (typeof entry.spec.code === 'string') {
      code = entry.spec.code;
    } else {
      try {
        const st = fs.statSync(entry.spec.file);
        if (st.size > lim.maxCodeBytes) {
          throw new ServiceError('LOAD_FAILED', { detail: 'service file is too large' });
        }
        code = fs.readFileSync(entry.spec.file, 'utf8');
      } catch (e) {
        if (e instanceof ServiceError) throw e;
        throw new ServiceError('LOAD_FAILED', { detail: 'service file cannot be read' });
      }
    }
    if (Buffer.byteLength(code, 'utf8') > lim.maxCodeBytes) {
      throw new ServiceError('LOAD_FAILED', { detail: 'service code is too large' });
    }
    return code;
  }

  function prepareBody(entry) {
    const code = readSource(entry);
    const a = analyze(code);
    if (!a.ok) {
      const first = a.errors[0];
      throw new ServiceError('LOAD_FAILED', { detail: first ? `${first.id}: ${first.message}` : 'invalid source' });
    }
    return a.body;
  }

  function recordCrash(entry) {
    const lim = limitsFor(entry);
    const now = Date.now();
    entry.crashes = entry.crashes.filter((t) => now - t < lim.crashWindowMs);
    entry.crashes.push(now);
    entry.stats.crashes++;
    if (entry.crashes.length >= lim.crashLimit) {
      entry.quarantinedUntil = now + lim.quarantineMs;
      entry.crashes = [];
    }
  }

  function describeWorkerFailure(err) {
    if (err && err.code === 'ERR_WORKER_OUT_OF_MEMORY') return new ServiceError('OUT_OF_MEMORY');
    return new ServiceError('CRASHED', { detail: err && err.message });
  }

  // Detach and kill the current worker of an entry. Idempotent.
  function dropWorker(entry, worker, error, { crash = true } = {}) {
    if (entry.worker !== worker) return;
    entry.worker = null;
    entry.state = 'unloaded';
    entry.loadedAt = null;
    if (entry.pending) {
      const p = entry.pending;
      entry.pending = null;
      clearTimeout(p.timer);
      p.reject(error);
    }
    if (entry.loading) {
      const l = entry.loading;
      entry.loading = null;
      clearTimeout(l.timer);
      l.reject(error);
    }
    worker.terminate().catch(() => {});
    if (crash && error) {
      entry.lastError = { code: error.code, at: Date.now() };
      recordCrash(entry);
    }
  }

  // ---------------------------------------------------------------- workers

  function spawn(entry) {
    const lim = limitsFor(entry);
    const body = prepareBody(entry); // throws LOAD_FAILED before any thread is started
    const startedAt = performance.now();

    const worker = new Worker(WORKER_URL, {
      env: {},
      argv: [],
      execArgv: [],
      stdin: false,
      stdout: false,
      stderr: false,
      resourceLimits: {
        maxOldGenerationSizeMb: lim.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: lim.maxYoungGenerationSizeMb,
        stackSizeMb: lim.stackSizeMb
      },
      workerData: {
        timeoutMs: lim.timeoutMs,
        initTimeoutMs: lim.initTimeoutMs,
        maxResponseBytes: lim.maxResponseBytes,
        forceResponseHeaders: lim.forceResponseHeaders
      }
    });
    worker.unref();
    entry.worker = worker;
    entry.state = 'loading';

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        dropWorker(entry, worker, new ServiceError('TIMEOUT', { detail: 'service did not start in time' }));
      }, lim.initTimeoutMs + lim.watchdogGraceMs);
      entry.loading = { resolve, reject, timer, startedAt };
    });
    // The rejection is always consumed by processJob; avoid an unhandled-rejection report
    // for the (impossible) case where nobody awaits it.
    ready.catch(() => {});

    worker.on('message', (msg) => onMessage(entry, worker, msg));
    worker.on('error', (err) => dropWorker(entry, worker, describeWorkerFailure(err)));
    worker.on('exit', (code) => {
      dropWorker(entry, worker, new ServiceError('CRASHED', { detail: `worker exited with code ${code}` }));
    });

    worker.postMessage({ type: 'init', body });
    return ready;
  }

  function onMessage(entry, worker, msg) {
    if (entry.worker !== worker || !msg || typeof msg !== 'object') return;

    if (msg.type === 'ready') {
      const l = entry.loading;
      if (!l) return;
      entry.loading = null;
      clearTimeout(l.timer);
      entry.state = 'ready';
      entry.loadedAt = Date.now();
      const ms = performance.now() - l.startedAt;
      entry.stats.coldStarts++;
      entry.stats.lastColdStartMs = ms;
      l.resolve(ms);
      return;
    }

    if (msg.type === 'init-error') {
      const err = msg.timeout
        ? new ServiceError('TIMEOUT', { detail: String(msg.message) })
        : new ServiceError('LOAD_FAILED', { detail: String(msg.message) });
      dropWorker(entry, worker, err);
      return;
    }

    if (msg.type === 'res') {
      const p = entry.pending;
      if (!p || p.id !== msg.id) return;
      entry.pending = null;
      clearTimeout(p.timer);
      handleResult(entry, worker, p, msg);
    }
  }

  function handleResult(entry, worker, p, msg) {
    if (msg.ok) {
      let response;
      try {
        // Validated again here: this thread never trusts what the worker sends.
        response = sanitizeResponse(msg.response, limitsFor(entry));
        const fromWorker = Array.isArray(msg.response && msg.response.warnings)
          ? msg.response.warnings.filter((x) => typeof x === 'string').slice(0, 20)
          : [];
        response.warnings = [...fromWorker, ...response.warnings];
      } catch (e) {
        entry.stats.errors++;
        p.reject(e);
        return;
      }
      const logs = Array.isArray(msg.logs) ? msg.logs.filter((x) => typeof x === 'string').slice(0, 50) : [];
      entry.stats.lastHeapUsedBytes = Number(msg.heapUsedBytes) || 0;
      p.resolve({ response, logs, handlerMs: Number(msg.handlerMs) || 0, heapUsedBytes: entry.stats.lastHeapUsedBytes });
      return;
    }

    const e = msg.error || {};
    const code = typeof e.code === 'string' ? e.code : 'HANDLER_ERROR';
    const detail = e.message === undefined ? undefined : String(e.message);

    if (code === 'TIMEOUT') {
      // State of a service that was interrupted half-way cannot be trusted: restart it.
      entry.stats.timeouts++;
      entry.stats.errors++;
      dropWorker(entry, worker, new ServiceError('TIMEOUT', { detail }));
      // dropWorker rejected p only if it was still pending; it is not any more.
      p.reject(new ServiceError('TIMEOUT', { detail }));
      return;
    }

    entry.stats.errors++;
    const known = ['HANDLER_ERROR', 'BAD_RESPONSE', 'RESPONSE_TOO_LARGE'];
    p.reject(new ServiceError(known.includes(code) ? code : 'HANDLER_ERROR', { detail }));
  }

  function send(entry, reqJson) {
    const lim = limitsFor(entry);
    const worker = entry.worker;
    return new Promise((resolve, reject) => {
      const id = entry.nextReqId++;
      const timer = setTimeout(() => {
        dropWorker(entry, worker, new ServiceError('TIMEOUT', { detail: 'watchdog: no answer from the worker' }));
        entry.stats.timeouts++;
      }, lim.timeoutMs + lim.watchdogGraceMs);
      entry.pending = { id, resolve, reject, timer };
      worker.postMessage({ type: 'req', id, reqJson });
    });
  }

  // ---------------------------------------------------------------- queue

  async function pump(entry) {
    if (entry.busy) return;
    entry.busy = true;
    try {
      while (entry.queue.length > 0) {
        const job = entry.queue.shift();
        await processJob(entry, job);
      }
    } finally {
      entry.busy = false;
    }
  }

  async function processJob(entry, job) {
    const startedAt = performance.now();
    entry.active = true;
    try {
      if (closed) throw new ServiceError('SHUTTING_DOWN');
      if (entry.quarantinedUntil > Date.now()) {
        throw new ServiceError('QUARANTINED', {
          retryAfterSec: Math.max(1, Math.ceil((entry.quarantinedUntil - Date.now()) / 1000))
        });
      }
      let coldStart = false;
      let coldStartMs = 0;
      if (!entry.worker || entry.state !== 'ready') {
        coldStart = true;
        coldStartMs = await spawn(entry);
      }
      entry.inFlight = true;
      let result;
      try {
        result = await send(entry, job.reqJson);
      } finally {
        entry.inFlight = false;
      }
      entry.stats.requests++;
      entry.lastUsedAt = Date.now();
      const now = performance.now();
      entry.active = false;
      job.resolve({
        status: result.response.status,
        headers: result.response.headers,
        body: result.response.body,
        logs: result.logs,
        warnings: result.response.warnings,
        meta: {
          coldStart,
          coldStartMs: coldStart ? coldStartMs : 0,
          queuedMs: startedAt - job.enqueuedAt,
          handlerMs: result.handlerMs,
          totalMs: now - job.enqueuedAt,
          heapUsedBytes: result.heapUsedBytes
        }
      });
    } catch (err) {
      entry.active = false;
      entry.stats.requests++;
      if (!(err instanceof ServiceError)) {
        job.reject(new ServiceError('CRASHED', { detail: err && err.message }));
      } else {
        if (err.code === 'LOAD_FAILED' && entry.state !== 'unloaded') entry.state = 'unloaded';
        job.reject(err);
      }
    }
  }

  // ---------------------------------------------------------------- API

  function register(id, spec = {}) {
    if (closed) throw new ServiceError('SHUTTING_DOWN');
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      throw new ServiceError('INVALID_SOURCE', { detail: 'service id must match [a-zA-Z0-9_-]{1,64}' });
    }
    const hasCode = typeof spec.code === 'string';
    const hasFile = typeof spec.file === 'string';
    if (hasCode === hasFile) {
      throw new ServiceError('INVALID_SOURCE', { detail: 'give exactly one of { code } or { file }' });
    }

    const next = {
      id,
      spec: hasCode ? { code: spec.code } : { file: spec.file },
      limits: { ...(spec.limits || {}) },
      worker: null,
      state: 'unloaded',
      loading: null,
      pending: null,
      queue: [],
      busy: false,
      active: false,
      inFlight: false,
      nextReqId: 1,
      crashes: [],
      quarantinedUntil: 0,
      lastError: null,
      loadedAt: null,
      lastUsedAt: null,
      registeredAt: Date.now(),
      stats: {
        requests: 0, errors: 0, timeouts: 0, crashes: 0,
        coldStarts: 0, lastColdStartMs: 0, lastHeapUsedBytes: 0
      }
    };

    // Validate code given inline right away (a file is read when it is loaded).
    if (hasCode) {
      try {
        prepareBody(next);
      } catch (e) {
        throw new ServiceError('INVALID_SOURCE', { detail: e && e.detail });
      }
    }

    const old = services.get(id);
    if (old) {
      // Update in place: stop the old version, fail what was waiting for it.
      stopEntry(old, new ServiceError('SHUTTING_DOWN', { detail: 'service was replaced' }));
    }
    services.set(id, next);
    return { id, state: next.state };
  }

  function stopEntry(entry, error) {
    for (const job of entry.queue.splice(0)) job.reject(error);
    if (entry.worker) dropWorker(entry, entry.worker, error, { crash: false });
  }

  function unload(id, { force = false } = {}) {
    const entry = getEntry(id);
    if (!entry.worker) return true;
    if (!force && (entry.active || entry.queue.length > 0 || entry.inFlight)) return false;
    dropWorker(entry, entry.worker, new ServiceError('SHUTTING_DOWN', { detail: 'service was unloaded' }), { crash: false });
    return true;
  }

  function unregister(id) {
    const entry = services.get(id);
    if (!entry) return false;
    services.delete(id);
    stopEntry(entry, new ServiceError('SERVICE_NOT_FOUND'));
    return true;
  }

  function run(id, request) {
    if (closed) return Promise.reject(new ServiceError('SHUTTING_DOWN'));
    let entry;
    let reqJson;
    try {
      entry = getEntry(id);
      reqJson = normalizeRequest(request, limitsFor(entry));
    } catch (e) {
      return Promise.reject(e);
    }
    const lim = limitsFor(entry);
    if (entry.queue.length >= lim.maxQueue) {
      return Promise.reject(new ServiceError('QUEUE_FULL', { retryAfterSec: 1 }));
    }
    return new Promise((resolve, reject) => {
      entry.queue.push({ reqJson, resolve, reject, enqueuedAt: performance.now() });
      pump(entry);
    });
  }

  function stats() {
    const list = [];
    for (const e of services.values()) {
      const quarantined = e.quarantinedUntil > Date.now();
      list.push({
        id: e.id,
        state: quarantined ? 'quarantined' : e.state,
        source: e.spec.code !== undefined ? 'code' : 'file',
        requests: e.stats.requests,
        errors: e.stats.errors,
        timeouts: e.stats.timeouts,
        crashes: e.stats.crashes,
        coldStarts: e.stats.coldStarts,
        lastColdStartMs: e.stats.lastColdStartMs,
        lastHeapUsedBytes: e.stats.lastHeapUsedBytes,
        queueLength: e.queue.length,
        inFlight: e.inFlight,
        registeredAt: e.registeredAt,
        loadedAt: e.loadedAt,
        lastUsedAt: e.lastUsedAt,
        lastError: e.lastError,
        quarantinedUntil: quarantined ? e.quarantinedUntil : null
      });
    }
    return {
      registered: list.length,
      loaded: list.filter((s) => s.state === 'ready' || s.state === 'loading').length,
      services: list
    };
  }

  async function shutdown() {
    closed = true;
    const kills = [];
    for (const entry of services.values()) {
      const err = new ServiceError('SHUTTING_DOWN');
      for (const job of entry.queue.splice(0)) job.reject(err);
      const w = entry.worker;
      if (w) {
        dropWorker(entry, w, err, { crash: false });
        kills.push(w.terminate().catch(() => {}));
      }
    }
    await Promise.all(kills);
  }

  return {
    register,
    unregister,
    unload,
    run,
    stats,
    shutdown,
    has: (id) => services.has(id),
    list: () => [...services.keys()]
  };
}
