import { createRuntime } from '../src/index.mjs';

/**
 * Does memory stay bounded when services are loaded and evicted again and again?
 * This is what the gateway does once it has a cap on resident services.
 *
 *     node bench/memcycle.mjs                 TOTAL=100 CAP=20 PASSES=6
 *     node --expose-gc bench/memcycle.mjs     also forces a GC in the host before each reading
 *
 * Reading the result: RSS climbs while the first CAP workers load, then should flatten.
 * If it keeps climbing by roughly the same amount every pass, something leaks.
 */

const TOTAL = Number(process.env.TOTAL || 100);
const CAP = Number(process.env.CAP || 20);
const PASSES = Number(process.env.PASSES || 6);

const CODE = `let n = 0;
export default { async server() { n++; return { body: String(n) }; } };`;
const REQ = { method: 'GET', url: '/', headers: {} };
const mb = (n) => (n / 1024 / 1024).toFixed(1).padStart(7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rt = createRuntime();
for (let i = 0; i < TOTAL; i++) rt.register('svc' + i, { code: CODE });

console.log(`node ${process.version} ${process.platform}/${process.arch}   ${TOTAL} services, at most ${CAP} loaded at a time\n`);
global.gc?.();
const base = process.memoryUsage().rss;
console.log(`baseline rss ${mb(base)} MB\n`);
console.log('pass   rss MB   over baseline   loaded   cold starts so far');

const resident = [];
let coldStarts = 0;
const readings = [];
for (let pass = 1; pass <= PASSES; pass++) {
  for (let i = 0; i < TOTAL; i++) {
    const id = 'svc' + i;
    const r = await rt.run(id, REQ);
    if (r.meta.coldStart) coldStarts++;
    resident.push(id);
    if (resident.length > CAP) rt.unload(resident.shift());
  }
  await sleep(500);
  global.gc?.();
  const rss = process.memoryUsage().rss;
  readings.push(rss);
  console.log(`${String(pass).padStart(4)}  ${mb(rss)}   ${mb(rss - base)}      ${String(rt.stats().loaded).padStart(5)}   ${coldStarts}`);
}

// drain: unload everything, give the OS time
for (const id of resident) rt.unload(id);
await sleep(1500);
global.gc?.();
const end = process.memoryUsage().rss;
console.log(`\nafter unloading everything and waiting 1.5 s: ${mb(end)} MB (${mb(end - base)} MB over baseline)`);

const growth = readings[readings.length - 1] - readings[1];
const perPass = growth / Math.max(1, readings.length - 2);
console.log(`growth from pass 2 to pass ${PASSES}: ${mb(growth)} MB  (${mb(perPass)} MB per pass)`);
console.log(Math.abs(perPass) < 8 * 1024 * 1024
  ? 'verdict: flat. Memory is reused, the retained amount is allocator slack, not a leak.'
  : 'verdict: still growing. Send this output, something is not being released.');
await rt.shutdown();
