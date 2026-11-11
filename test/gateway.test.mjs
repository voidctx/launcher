import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../launcher.mjs';
import { shutdownRuntime } from '../src/index.mjs';
import { Store } from '../src/store.mjs';
import { generateApiKeyForUser } from '../src/apikey.mjs';
import { hashPassword } from '../src/auth.mjs';

let baseUrl = '';

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const headers = { ...(options.headers || {}) };
    if (!('x-api-key' in headers) && !('authorization' in headers) && !options.noAuth) {
      const admin = Store.getUserByUsername('admin');
      if (admin && admin.apiKey) {
        headers['x-api-key'] = admin.apiKey;
      }
    }
    const req = http.request(url, {
      method: options.method || 'GET',
      headers
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

test('HTTP Gateway: API key required for stats, deploy, unload, delete', async () => {
  const statsRes = await request('/api/stats', { noAuth: true, headers: { 'Accept': 'application/json' } });
  assert.equal(statsRes.status, 401);

  const billingRes = await request('/api/billing', { noAuth: true, headers: { 'Accept': 'application/json' } });
  assert.equal(billingRes.status, 401);

  const rateRes = await request('/api/ratelimit/stats', { noAuth: true, headers: { 'Accept': 'application/json' } });
  assert.equal(rateRes.status, 401);

  const deployRes = await request('/api/deploy', {
    method: 'POST',
    noAuth: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'auth_test', code: 'export default { async server() { return { body: "ok" }; } };' })
  });
  assert.equal(deployRes.status, 401);

  const unloadRes = await request('/api/services/auth_test/unload', { method: 'POST', noAuth: true });
  assert.equal(unloadRes.status, 401);

  const deleteRes = await request('/api/services/auth_test', { method: 'DELETE', noAuth: true });
  assert.equal(deleteRes.status, 401);

  const badKeyRes = await request('/api/stats', { headers: { 'x-api-key': 'lnch_invalidkey123' } });
  assert.equal(badKeyRes.status, 401);
});

test('HTTP Gateway: Ownership check prevents overwriting or deleting another user service', async () => {
  const user1 = Store.saveUser({
    id: 'usr_test_1_' + Date.now(),
    username: 'testuser1',
    passwordHash: hashPassword('password123'),
    role: 'user',
    apiKey: null
  });
  const key1 = generateApiKeyForUser(user1.id);

  const user2 = Store.saveUser({
    id: 'usr_test_2_' + Date.now(),
    username: 'testuser2',
    passwordHash: hashPassword('password123'),
    role: 'user',
    apiKey: null
  });
  const key2 = generateApiKeyForUser(user2.id);

  const code1 = 'export default { async server() { return { status: 200, body: "v1" }; } };';
  const dep1 = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key1 },
    body: JSON.stringify({ name: 'owned_svc', code: code1 })
  });
  assert.equal(dep1.status, 200);

  const code2 = 'export default { async server() { return { status: 200, body: "v2" }; } };';
  const overwriteFail = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key2 },
    body: JSON.stringify({ name: 'owned_svc', code: code2 })
  });
  assert.equal(overwriteFail.status, 403);

  const unloadFail = await request('/api/services/owned_svc/unload', {
    method: 'POST',
    headers: { 'x-api-key': key2 }
  });
  assert.equal(unloadFail.status, 403);

  const deleteFail = await request('/api/services/owned_svc', {
    method: 'DELETE',
    headers: { 'x-api-key': key2 }
  });
  assert.equal(deleteFail.status, 403);

  const overwriteOk = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key1 },
    body: JSON.stringify({ name: 'owned_svc', code: code2 })
  });
  assert.equal(overwriteOk.status, 200);

  const deleteOk = await request('/api/services/owned_svc', {
    method: 'DELETE',
    headers: { 'x-api-key': key1 }
  });
  assert.equal(deleteOk.status, 200);
});

test('HTTP Gateway: Review gate allowFlagged is admin-only', async () => {
  const user = Store.saveUser({
    id: 'usr_test_gate_' + Date.now(),
    username: 'testusergate',
    passwordHash: hashPassword('password123'),
    role: 'user',
    apiKey: null
  });
  const userKey = generateApiKeyForUser(user.id);
  const adminKey = Store.getUserByUsername('admin').apiKey;

  const flaggedCode = 'export default { async server() { return { status: 200, body: typeof globalThis }; } };';

  const userBypassAttempt = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': userKey },
    body: JSON.stringify({ name: 'flagged_svc', code: flaggedCode, allowFlagged: true })
  });
  assert.equal(userBypassAttempt.status, 403);

  const userNormalAttempt = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': userKey },
    body: JSON.stringify({ name: 'flagged_svc', code: flaggedCode })
  });
  assert.equal(userNormalAttempt.status, 400);

  const adminDeploy = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': adminKey },
    body: JSON.stringify({ name: 'flagged_svc', code: flaggedCode, allowFlagged: true })
  });
  assert.equal(adminDeploy.status, 200);

  const invokeRes = await request('/flagged_svc');
  assert.equal(invokeRes.status, 200);
  assert.equal(invokeRes.body, 'object');

  await request('/api/services/flagged_svc', {
    method: 'DELETE',
    headers: { 'x-api-key': adminKey }
  });
});

test('HTTP Gateway: Quota and billing are charged based on API key', async () => {
  const user = Store.saveUser({
    id: 'usr_billing_' + Date.now(),
    username: 'billinguser',
    passwordHash: hashPassword('password123'),
    role: 'user',
    apiKey: null
  });
  const key = generateApiKeyForUser(user.id);

  const dep = await request('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      name: 'bill_svc',
      code: 'export default { async server() { return { status: 200, body: "ok" }; } };'
    })
  });
  assert.equal(dep.status, 200);

  const beforeSummary = Store.getBillingSummary(user.id);
  const beforeReqs = beforeSummary.totalRequests;

  await request('/bill_svc', { noAuth: true });
  const midSummary = Store.getBillingSummary(user.id);
  assert.equal(midSummary.totalRequests, beforeReqs);

  await request('/bill_svc', { headers: { 'x-api-key': key } });
  const afterSummary = Store.getBillingSummary(user.id);
  assert.equal(afterSummary.totalRequests, beforeReqs + 1);

  const billingEndpointRes = await request('/api/billing', { headers: { 'x-api-key': key } });
  assert.equal(billingEndpointRes.status, 200);
  const bData = JSON.parse(billingEndpointRes.body);
  assert.equal(bData.ok, true);
  assert.equal(bData.billing.userId, user.id);

  await request('/api/services/bill_svc', {
    method: 'DELETE',
    headers: { 'x-api-key': key }
  });
});
