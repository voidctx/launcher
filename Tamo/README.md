# Tamo: isolation runtime and code scanner

My part of the launcher project. Zero dependencies, plain Node.js (>= 18.18, tested on 22).

```
Tamo/
  src/
    index.mjs          public API (import from here)
    scanner.mjs        malicious content identifier  -> verdict approved / flagged / rejected
    tokenizer.mjs      small JS tokenizer the scanner is built on
    source.mjs         export-default handling + syntax gate (shared by scanner and runtime)
    isolation.mjs      runtime: one worker thread per service, lazy start, limits, queue, quarantine
    sandbox-worker.mjs worker entry: runs the service in a locked-down vm context
    protocol.mjs       request normalisation, response validation
    config.mjs         defaults, deny lists
    errors.mjs         ServiceError
  test/                139 tests  (npm test)
  bench/bench.mjs      numbers for the report (npm run bench)
  bench/memcycle.mjs   memory under load/evict churn (npm run bench:mem)
```

## Service format

```js
let count = 0;                       // state lives as long as the service stays loaded
export default {
  async server(req) {
    count++;
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count }) };
  }
};
```

`req` = `{ method, url, path, query, headers, body }` (headers lower-case; cookie, authorization,
x-api-key, x-csrf-token are removed). Result = `{ status?, headers?, body? }`, body must be a string.

Services are pure computation: no imports, no network, no files, no timers, no typed arrays.
They get a request and return a response.

## API (what the others call)

```js
import { deployService, runService, unloadService, unregisterService,
         serviceStats, scan, ServiceError } from '../Tamo/src/index.mjs';

// 1. Upload: scan + register in one call
const { deployed, report } = deployService(name, code);
//    deployed=false -> store `report` (rejected: show reasons; flagged: wait for admin)
//    admin approves a flagged service:  deployService(name, code, { allowFlagged: true })

// 2. Request
try {
  const r = await runService(name, { method: req.method, url: req.url, headers: req.headers, body });
  res.writeHead(r.status, r.headers); res.end(r.body);
  // r.logs (console output), r.warnings, r.meta { coldStart, coldStartMs, queuedMs, handlerMs, totalMs, heapUsedBytes }
} catch (e) {
  if (!(e instanceof ServiceError)) throw e;
  // e.status (HTTP), e.publicMessage (safe to show), e.code, e.detail (internal), e.retryAfterSec (503s)
}

// 3. Admin / eviction
unloadService(name);               // frees the worker, false if busy (use { force: true } to override)
unregisterService(name);           // delete
serviceStats();                    // { registered, loaded, services: [{ id, state, requests, errors, timeouts,
                                   //   crashes, coldStarts, lastColdStartMs, lastHeapUsedBytes, queueLength,
                                   //   inFlight, loadedAt, lastUsedAt, lastError, quarantinedUntil }] }
```

`scan(code)` alone returns `{ verdict, reasons[{ id, severity, title, message, line, column, snippet }],
summary, stats, sha256, scannerVersion, scannedAt }`. `sha256` identifies the exact code that was
scanned. `message` and `snippet` contain text from the scanned code: escape them in HTML.

Error codes: BAD_REQUEST 400, REQUEST_TOO_LARGE 413, SERVICE_NOT_FOUND 404, INVALID_SOURCE 400,
LOAD_FAILED 500, HANDLER_ERROR 500, OUT_OF_MEMORY 500, CRASHED 500, BAD_RESPONSE 502,
RESPONSE_TOO_LARGE 502, TIMEOUT 504, QUEUE_FULL 503, QUARANTINED 503, SHUTTING_DOWN 503.

## Two layers

1. Scanner (deploy time). Tokenizes the code (so comments and strings do not fool it), then looks for
   imports, `require`, `eval`, `Function`, `process`, `globalThis`, `.constructor.constructor`, unicode-escaped
   identifiers, computed access to sensitive names, forbidden module names, plus a raw-text safety net.
   high -> rejected, medium -> flagged, otherwise approved. Also checks size, NUL bytes, syntax, and that there is
   exactly one top-level `export default`.
2. Runtime (every request). It does not trust the scanner.
   - one worker thread per service, heap limits per worker (64 MB old / 16 MB young by default), empty environment
   - code runs in a separate V8 context: no process/require/fs/fetch/timers/Buffer/URL, no `import()`,
     no `eval` / `new Function`, no ArrayBuffer / typed arrays / WebAssembly (memory the heap limit cannot see)
   - 3 s limit per request enforced by V8, so `while(true){}`, endless promise loops and catastrophic regexes
     are interrupted; the main thread also has a watchdog that kills the worker
   - only strings cross the boundary; no promise from the service is ever awaited by the host
   - after a timeout, out-of-memory or crash the worker is discarded; 5 failures in 60 s put the service in
     30 s quarantine
   - responses are validated twice (worker and main thread): status 200-599, string headers, no Set-Cookie /
     Content-Length / Transfer-Encoding, string body, size limit; `X-Content-Type-Options: nosniff` and
     `Content-Security-Policy: sandbox` are always added
   - requests to a service are queued one at a time (max 100), so a burst on an unloaded service starts one worker

## Measured (`npm run bench`, `npm run bench:mem`)

| | MacBook Air, Node 24.5, arm64, 10 cores | Linux VM, Node 22, 1 vCPU |
|---|---|---|
| scan of a small service | 0.01 ms median | 0.04 ms median |
| cold start (start worker + first request) | 12 ms median (29 ms was the slowest of 20) | 34 ms median, 38 ms max |
| warm request | 0.13 ms median, 0.17 ms p99 | 0.21 ms median, 1.7 ms p99 |
| warm throughput, one service | about 7,700 req/s | about 3,500 req/s |
| memory per loaded service | 9.1 MB (about 6.9 MB JS heap) | 9.2 MB |
| registered but not loaded | about 0 | about 0 |

Cold start is a new V8 isolate plus Node's bootstrap, so it depends on the machine: about 12 ms on the Mac,
about 34 ms on the slow VM. It is not the 5-10 ms of the original proposal. The saving is that a service
that is not loaded costs close to nothing; a loaded one costs about 9 MB, so the cap on resident
services decides the memory ceiling (see below).

Memory under load/evict churn (`npm run bench:mem`: 100 services through a cap of 20, six passes, 600 cold
starts). Mac: RSS 277 MB after pass 1 and 290 MB after pass 6, growth shrinking to almost nothing, so evicted
workers' memory is reused and nothing leaks. After everything was unloaded the Mac process stayed about 188 MB
above its baseline: macOS keeps freed memory in the process instead of shrinking RSS, and the next workers
reuse it. The Linux VM gave most of it back (42 MB over baseline after unloading). So RSS is bounded by the
cap on resident services, not by how many services have ever been loaded. Size the cap as cap x 12 MB
typical (measured under churn), up to cap x 70 MB if every service sits at its heap limit. Do not claim
that memory returns to the operating system after an unload on macOS; on Linux it largely does.

## Limits (be upfront about these)

- Node's documentation says `vm` is not a security mechanism. This design avoids the usual escapes
  (no host object enters the context, nothing from it is awaited, string code generation is off), and the tests try
  them, but a bug in V8 or Node could still break out. A worker has the same OS permissions as the gateway.
  For a public deployment run the gateway as an unprivileged user, in a container, with no secrets in its
  environment or readable files.
- The scanner is a rule-based filter. It cannot prove code is safe, and the regex-vs-division decision in the
  tokenizer is a heuristic. That is why the runtime does not depend on the verdict.
- CPU limit is a time limit per request, not CPU accounting. Memory limit covers the JS heap.
- Limits are set by the platform (`register(id, { limits })`), never from user input.
- Services in different workers do not share state. If Archisman runs several workers for one service, each has
  its own `count`.
- `Content-Security-Policy: sandbox` stops scripts in HTML responses. Pass `forceResponseHeaders: {}` to
  `createRuntime` to turn it off.
- Test suite verified on macOS arm64 with Node 24.5 and on Linux with Node 22 (all 139 pass, including the
  parallel-execution test on 10 cores). Not verified: Node 18/20, Windows.

## Viva questions

- Can the scanner catch everything? No. It is the first layer. The runtime still blocks everything it misses.
- Why worker_threads and not child_process? Faster to start and lighter than a separate process (measured
  here: about 9 MB per loaded service), and terminate() frees the memory. Threads share the process, so the vm context and the empty environment are what
  restrict capabilities.
- Why does `while(true)` not freeze the gateway? It runs in another thread; V8 interrupts it after the timeout and
  the main thread would kill the worker anyway.
- What if two requests arrive while the service is not loaded? They queue; one worker is started.
- Why is the cold start higher than 5-10 ms? A worker is a new V8 isolate plus Node's bootstrap. A spare idle worker
  would hide it (not built).
- Why can't a service read the session cookie? Credential headers are removed before the request enters the
  sandbox, and Set-Cookie is removed from responses.
