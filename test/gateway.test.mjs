import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../launcher.mjs';
import { shutdownRuntime } from '../src/index.mjs';

let baseUrl = '';

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await shutdownRuntime();
});

test('HTTP Gateway: GET / serves landing page', async () => {
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Launcher Edge Gateway'));
});

test('HTTP Gateway: GET /api/stats returns zero-dependency runtime stats', async () => {
  const res = await request('/api/stats', { headers: { 'Accept': 'application/json' } });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.zeroDependency, true);
  assert.ok(typeof data.stats.registered === 'number');
});

test('HTTP Gateway: Auto-onboard and execute modules/abce.mjs', async () => {
  const res = await request('/abce');
  assert.equal(res.status, 200);
  assert.equal(res.body, 'Hello from /abce!');
  assert.equal(res.headers['x-execution-status'], 'success');
  assert.ok('x-handler-time-ms' in res.headers);
  assert.ok('x-total-time-ms' in res.headers);
  assert.ok('x-memory-heap-bytes' in res.headers);
});

test('HTTP Gateway: Deploy untrusted service with pre-flight scanner', async () => {
  const payload = JSON.stringify({
    name: 'calc_service',
    code: `export default {
      async server(req) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calc: 40 + 2, path: req.path })
        };
      }
    };`
  });

  const deployRes = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  });

  assert.equal(deployRes.status, 200);
  const deployData = JSON.parse(deployRes.body);
  assert.equal(deployData.deployed, true);
  assert.equal(deployData.report.verdict, 'approved');

  // Invoke deployed service
  const invokeRes = await request('/calc_service');
  assert.equal(invokeRes.status, 200);
  const bodyData = JSON.parse(invokeRes.body);
  assert.equal(bodyData.calc, 42);
  assert.equal(invokeRes.headers['x-execution-status'], 'success');
});

test('HTTP Gateway: Deploy malicious service is rejected at Stage 1 scan', async () => {
  const payload = JSON.stringify({
    name: 'malicious',
    code: `export default {
      async server(req) {
        const fs = await import('fs');
        return { status: 200, body: 'owned' };
      }
    };`
  });

  const res = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  });

  assert.equal(res.status, 400);
  const data = JSON.parse(res.body);
  assert.equal(data.deployed, false);
  assert.equal(data.report.verdict, 'rejected');
  assert.ok(data.report.reasons.some((r) => r.id === 'IMP001'));
});

test('HTTP Gateway: Infinite loop handler is interrupted by Stage 2 watchdog without crashing gateway', async () => {
  const payload = JSON.stringify({
    name: 'loop_svc',
    code: `export default {
      async server(req) {
        while(true) {}
      }
    };`
  });

  // Deploy allowing flagged (the scanner marks while(true) as low note LOOP001)
  const deployRes = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  });
  assert.equal(deployRes.status, 200);

  // Invoke: V8 timeout will interrupt it
  const invokeRes = await request('/loop_svc', { headers: { 'Accept': 'application/json' } });
  assert.equal(invokeRes.status, 504); // TIMEOUT
  const errData = JSON.parse(invokeRes.body);
  assert.equal(errData.error, 'TIMEOUT');

  // Gateway itself is completely unharmed!
  const statsRes = await request('/api/stats');
  assert.equal(statsRes.status, 200);
});

test('HTTP Gateway: Memory eviction and service deletion', async () => {
  // Unload worker
  const unloadRes = await request('/api/services/calc_service/unload', { method: 'POST' });
  assert.equal(unloadRes.status, 200);

  // Unregister service
  const deleteRes = await request('/api/services/calc_service', { method: 'DELETE' });
  assert.equal(deleteRes.status, 200);

  // Calling it now returns 404
  const res = await request('/calc_service', { headers: { 'Accept': 'application/json' } });
  assert.equal(res.status, 404);
});
