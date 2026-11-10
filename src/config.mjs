//Global configuration defaults

const KiB = 1024;
const MiB = 1024 * 1024;

export const RUNTIME_DEFAULTS = Object.freeze({
  timeoutMs: 3000,               // 3s max CPU/handler time per request inside sandbox
  initTimeoutMs: 2000,           // 2s max worker bootstrap & init time
  watchdogGraceMs: 1500,         // 1.5s grace before main thread terminates unresponsive worker
  maxOldGenerationSizeMb: 64,    // 64 MB V8 old gen heap ceiling per worker
  maxYoungGenerationSizeMb: 16,  // 16 MB young gen heap ceiling
  stackSizeMb: 4,                // 4 MB thread stack
  maxCodeBytes: 256 * KiB,
  maxRequestBytes: 1 * MiB,
  maxResponseBytes: 1 * MiB,
  maxQueue: 100,                 // 100 requests max queue per service
  crashLimit: 5,                 // 5 crashes within window triggers quarantine
  crashWindowMs: 60_000,         // 60s window for crash limit
  quarantineMs: 30_000,          // 30s automatic circuit-breaker quarantine
  idleEvictionMs: 60_000,        // 60s idle before automatic LRU worker eviction
  enableSpareWorker: true,       // Pre-warmed idle worker pool

  stripRequestHeaders: Object.freeze([
    'cookie',
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'x-csrf-token'
  ]),

  forceResponseHeaders: Object.freeze({
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox'
  })
});

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
  allowModules: Object.freeze([]),
  maxFindings: 100
});

// Disallowed node built-ins
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

// Globals not permitted inside sandbox
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
