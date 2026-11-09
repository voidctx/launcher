import { createRuntime, scan } from '../src/index.mjs';

/**
 * Numbers for the report. Run on the machine you present on:
 *     node bench/bench.mjs
 * Options (environment): COLD=50  WARM=2000  SERVICES=20
 */

const COLD = Number(process.env.COLD || 50);
const WARM = Number(process.env.WARM || 2000);
const SERVICES = Number(process.env.SERVICES || 20);

const CODE = `let n = 0;
export default { async server(req) { n++; return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n, path: req.path }) }; } };`;
const REQ = { method: 'GET', url: '/bench', headers: { 'user-agent': 'bench' } };

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => n.toFixed(2).padStart(8);
const mb = (n) => (n / 1024 / 1024).toFixed(1);

console.log(`node ${process.version}  ${process.platform}/${process.arch}  cpus=${(await import('node:os')).cpus().length}\n`);

// 1. scan time
{
  const times = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    scan(CODE);
    times.push(performance.now() - t0);
  }
  console.log(`scan (${CODE.length} bytes)           p50 ${fmt(pct(times, 50))} ms   p95 ${fmt(pct(times, 95))} ms`);
}

// 2. cold start: worker start + first request
//    The very first start in a process also loads the worker's source files from disk,
//    so it is reported separately from the steady state.
{
  const rt = createRuntime();
  const run = async () => {
    rt.register('cold', { code: CODE });
    const t0 = performance.now();
    await rt.run('cold', REQ);
    return performance.now() - t0;
  };
  const first = await run();
  const times = [];
  for (let i = 0; i < COLD; i++) times.push(await run());
  await rt.shutdown();
  console.log(`cold start, first in process       ${fmt(first)} ms`);
  console.log(`cold start (spawn + 1st request)   p50 ${fmt(pct(times, 50))} ms   p95 ${fmt(pct(times, 95))} ms   max ${fmt(Math.max(...times))} ms   n=${COLD}`);
}

// 3. warm latency, one request at a time
{
  const rt = createRuntime();
  rt.register('warm', { code: CODE });
  await rt.run('warm', REQ);
  for (let i = 0; i < 100; i++) await rt.run('warm', REQ); // JIT warm-up
  const times = [];
  const t0 = performance.now();
  for (let i = 0; i < WARM; i++) {
    const s = performance.now();
    await rt.run('warm', REQ);
    times.push(performance.now() - s);
  }
  const total = performance.now() - t0;
  await rt.shutdown();
  console.log(`warm request (sequential)          p50 ${fmt(pct(times, 50))} ms   p95 ${fmt(pct(times, 95))} ms   p99 ${fmt(pct(times, 99))} ms   n=${WARM}`);
  console.log(`warm throughput (1 service)        ${(WARM / (total / 1000)).toFixed(0)} req/s`);
}

// 4. queued burst on one warm service
{
  const rt = createRuntime({ maxQueue: 1000 });
  rt.register('burst', { code: CODE });
  await rt.run('burst', REQ);
  const N = 500;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: N }, () => rt.run('burst', REQ)));
  const ms = performance.now() - t0;
  await rt.shutdown();
  console.log(`burst of ${N} queued requests       ${ms.toFixed(0)} ms total  (${(N / (ms / 1000)).toFixed(0)} req/s)`);
}

// 5. memory
{
  global.gc?.();
  const base = process.memoryUsage();
  const rt = createRuntime();
  for (let i = 0; i < SERVICES; i++) rt.register('svc' + i, { code: CODE });
  const afterRegister = process.memoryUsage();
  await Promise.all(Array.from({ length: SERVICES }, (_, i) => rt.run('svc' + i, REQ)));
  await new Promise((r) => setTimeout(r, 200));
  const loaded = process.memoryUsage();
  const heap = rt.stats().services.map((s) => s.lastHeapUsedBytes);
  console.log(`\nmemory: baseline rss ${mb(base.rss)} MB`);
  console.log(`  ${SERVICES} services registered, none loaded   +${mb(afterRegister.rss - base.rss)} MB`);
  console.log(`  ${SERVICES} services loaded (1 worker each)    +${mb(loaded.rss - base.rss)} MB  = ${mb((loaded.rss - base.rss) / SERVICES)} MB per loaded service`);
  console.log(`  JS heap used inside each worker           ~${mb(heap.reduce((a, b) => a + b, 0) / heap.length)} MB`);
  for (let i = 0; i < SERVICES; i++) rt.unload('svc' + i);
  await new Promise((r) => setTimeout(r, 300));
  const unloaded = process.memoryUsage();
  console.log(`  after unloading all                        +${mb(unloaded.rss - base.rss)} MB over baseline`);
  await rt.shutdown();
}
