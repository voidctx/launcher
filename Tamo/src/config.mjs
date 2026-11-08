/**
 * Central configuration. Everything here can be overridden per runtime
 * (createRuntime(options)), per service (register(id, { limits })) or per
 * scan (scan(code, options)).
 */

const KiB = 1024;
const MiB = 1024 * 1024;

export const RUNTIME_DEFAULTS = Object.freeze({
  // --- time -------------------------------------------------------------
  // Limit for one request inside the sandbox (synchronous work + the
  // promise continuations of the handler). Enforced by V8 (vm timeout).
  timeoutMs: 3000,
  // Limit for loading a service (running its top-level code).
  initTimeoutMs: 3000,
  // The main thread kills a worker that has not answered this long after
  // timeoutMs. Last line of defence if the in-worker timeout fails.
  watchdogGraceMs: 1500,

  // --- memory (per worker) ----------------------------------------------
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,

  // --- sizes --------------------------------------------------------------
  maxCodeBytes: 256 * KiB,
  maxRequestBytes: 1 * MiB,
  maxResponseBytes: 1 * MiB,

  // --- concurrency ---------------------------------------------------------
  // Requests are processed one at a time per service. This many may wait.
  maxQueue: 100,

  // --- crash-loop protection ----------------------------------------------
  // crashLimit worker crashes (timeout, out-of-memory, crash, failed load)
  // inside crashWindowMs put the service in quarantine for quarantineMs.
  crashLimit: 5,
  crashWindowMs: 60_000,
  quarantineMs: 30_000,

  // Request headers the sandboxed code never sees (platform credentials).
  stripRequestHeaders: Object.freeze([
    'cookie',
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'x-csrf-token'
  ]),

  // Headers added to every service response (override with {} to disable).
  forceResponseHeaders: Object.freeze({
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox'
  })
});

// Response headers a service may never set. They are removed (a warning is
// attached to the result) because they are either connection-level or let a
// hosted service act on the platform's origin.
export const BLOCKED_RESPONSE_HEADERS = Object.freeze(new Set([
  'set-cookie',
  'set-cookie2',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'proxy-authenticate',
  'proxy-authorization'
]));

export const SCAN_DEFAULTS = Object.freeze({
  maxCodeBytes: 256 * KiB,
  // Exact import specifiers that are allowed. Empty on purpose: the sandbox
  // does not provide any module, so every import would fail at runtime.
  allowModules: Object.freeze([]),
  maxFindings: 100
});

// Node built-ins that get a specific explanation when imported.
// Key = module name without the "node:" prefix and without sub-path.
export const DENY_MODULES = Object.freeze(new Map([
  ['child_process', 'starts operating-system processes'],
  ['cluster', 'starts operating-system processes'],
  ['worker_threads', 'starts threads outside the sandbox'],
  ['fs', 'reads and writes files'],
  ['net', 'opens raw network connections'],
  ['dgram', 'opens raw network sockets'],
  ['dns', 'performs DNS lookups'],
  ['http', 'performs network requests'],
  ['https', 'performs network requests'],
  ['http2', 'performs network requests'],
  ['tls', 'opens network connections'],
  ['os', 'exposes host information'],
  ['vm', 'creates execution contexts'],
  ['v8', 'exposes runtime internals'],
  ['module', 'loads arbitrary modules'],
  ['process', 'exposes the host process'],
  ['inspector', 'exposes the debugger'],
  ['repl', 'starts an interactive shell'],
  ['readline', 'reads from the host terminal'],
  ['tty', 'accesses the host terminal'],
  ['perf_hooks', 'exposes host timing internals'],
  ['async_hooks', 'exposes runtime internals'],
  ['crypto', 'is not provided inside the sandbox'],
  ['zlib', 'is not provided inside the sandbox'],
  ['stream', 'is not provided inside the sandbox'],
  ['buffer', 'is not provided inside the sandbox'],
  ['events', 'is not provided inside the sandbox'],
  ['url', 'is not provided inside the sandbox (use req.path and req.query)'],
  ['path', 'is not provided inside the sandbox'],
  ['util', 'is not provided inside the sandbox']
]));

// Globals that do not exist inside the sandbox. Using them is only a note
// (severity "low"): the code would fail at runtime, it is not an attack.
export const UNSUPPORTED_GLOBALS = Object.freeze(new Map([
  ['setTimeout', 'timers are not available in the sandbox'],
  ['setInterval', 'timers are not available in the sandbox'],
  ['setImmediate', 'timers are not available in the sandbox'],
  ['queueMicrotask', 'not available in the sandbox'],
  ['fetch', 'network access is not available in the sandbox'],
  ['XMLHttpRequest', 'network access is not available in the sandbox'],
  ['WebSocket', 'network access is not available in the sandbox'],
  ['Buffer', 'Buffer is not available in the sandbox'],
  ['structuredClone', 'not available in the sandbox'],
  ['TextEncoder', 'not available in the sandbox'],
  ['TextDecoder', 'not available in the sandbox'],
  ['URL', 'not available in the sandbox (use req.path and req.query)'],
  ['URLSearchParams', 'not available in the sandbox (use req.query)'],
  ['ArrayBuffer', 'binary buffers are removed from the sandbox'],
  ['SharedArrayBuffer', 'binary buffers are removed from the sandbox'],
  ['DataView', 'binary buffers are removed from the sandbox'],
  ['Uint8Array', 'typed arrays are removed from the sandbox'],
  ['Int8Array', 'typed arrays are removed from the sandbox'],
  ['Uint16Array', 'typed arrays are removed from the sandbox'],
  ['Int16Array', 'typed arrays are removed from the sandbox'],
  ['Uint32Array', 'typed arrays are removed from the sandbox'],
  ['Int32Array', 'typed arrays are removed from the sandbox'],
  ['Float32Array', 'typed arrays are removed from the sandbox'],
  ['Float64Array', 'typed arrays are removed from the sandbox'],
  ['WebAssembly', 'WebAssembly is removed from the sandbox'],
  ['Atomics', 'Atomics is removed from the sandbox']
]));
