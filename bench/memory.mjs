import { createRuntime } from '../src/index.mjs';

/**
 * Does memory come back after services are unloaded?
 *
 *   node bench/memory.mjs
 *   ROUNDS=8 SERVICES=20 node --expose-gc bench/memory.mjs
 *
 * One reading ("+125 MB after unloading") cannot tell a leak from the
 * operating system keeping freed pages in the process. Repeating the same
 * load/unload cycle can:
 *   - "after unload" rises by about the same amount every round  -> leak
 *   - it rises in round 1-2, then stays flat                     -> freed memory is kept for reuse, no leak
 * The worker count column must always return to 0.
 */

const ROUNDS = Number(process.env.ROUNDS || 6);
const N = Number(process.env.SERVICES || 20);
const CODE = `let n = 0;\nexport default { async server() { n++; return { body: String(n) }; } };`;
const REQ = { method: 'GET', url: '/', headers: {} };

const mb = (b) => (b / 1024 / 1024).toFixed(1).padStart(7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = () => process.getActiveResourcesInfo().filter((t) => /worker/i.test(t)).length;
const gc = () => { if (global.gc) global.gc(); };

const rt = createRuntime();
console.log(`node ${process.version} ${process.platform}/${process.arch}   ${N} services per round, gc ${global.gc ? 'exposed' : 'not exposed'}\n`);
console.log('round   loaded rss   after unload (0.5 s)   after unload (3 s)   main heap   workers');

gc();
await sleep(200);
const base = process.memoryUsage().rss;
console.log(`base    ${mb(base)}`);

let first = null;
for (let round = 1; round <= ROUNDS; round++) {
  for (let i = 0; i < N; i++) rt.register('s' + i, { code: CODE });
  await Promise.all(Array.from({ length: N }, (_, i) => rt.run('s' + i, REQ)));
  await sleep(200);
  const loaded = process.memoryUsage().rss;

  for (let i = 0; i < N; i++) rt.unload('s' + i);
  await sleep(500);
  const a = process.memoryUsage().rss;
  gc();
  await sleep(2500);
  gc();
  const m = process.memoryUsage();
  if (first === null) first = m.rss;
  console.log(`${String(round).padEnd(7)} ${mb(loaded)}   ${mb(a)}              ${mb(m.rss)}           ${mb(m.heapUsed)}   ${live()}`);
}

const last = process.memoryUsage().rss;
console.log(`\nbase ${mb(base).trim()} MB, after round 1 ${mb(first).trim()} MB, after round ${ROUNDS} ${mb(last).trim()} MB`);
const growthPerRound = (last - first) / Math.max(1, ROUNDS - 1) / 1024 / 1024;
console.log(`growth per round after the first: ${growthPerRound.toFixed(1)} MB  (${N} loads + unloads each)`);
await rt.shutdown();
