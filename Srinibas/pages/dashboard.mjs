import { getSessionFromRequest } from '../src/auth.mjs';
import { inspectBucket, RATE_LIMIT_CONFIGS } from '../src/ratelimit.mjs';
import { Store } from '../src/store.mjs';

/**
 * Next.js SSR — getServerSideProps
 */
export async function getServerSideProps({ req }) {
  const session = getSessionFromRequest(req);
  const user = session ? Store.getUserById(session.userId) : null;

  if (!user) return { redirect: { destination: '/login' } };

  const services  = Store.getUserServices(user.id);
  const logs      = Store.getUserLogs(user.id, 30);
  const userRate  = inspectBucket(`user:${user.id}`, RATE_LIMIT_CONFIGS.user);
  const apiRate   = user.apiKey ? inspectBucket(`key:${user.apiKey}`, RATE_LIMIT_CONFIGS.apiKey) : null;

  return { props: { user, csrf: session.csrfToken, services, logs, userRate, apiRate } };
}

/**
 * SSR Page Component — returns HTML string
 */
export default function Dashboard({ user, csrf, services, logs, userRate, apiRate }) {

  const svcRows = services.map(s => `
    <tr>
      <td><a href="/${s.name}" target="_blank">/${s.name} ↗</a></td>
      <td>${new Date(s.createdAt).toLocaleDateString()}</td>
      <td><span class="badge badge-info">${s.invocations || 0} hits</span></td>
      <td style="text-align:right"><button class="btn btn-danger btn-sm" onclick="delService('${s.name}')">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px">No services deployed yet</td></tr>';

  const logRows = logs.map(l => {
    const cls = l.status < 300 ? 'badge-ok' : l.status === 429 ? 'badge-warn' : 'badge-err';
    return `<tr>
      <td style="color:var(--muted)">${new Date(l.timestamp).toLocaleTimeString()}</td>
      <td>/${l.serviceName || 'api'}</td>
      <td><span class="badge ${cls}">${l.status}</span></td>
      <td style="font-family:var(--mono)">${l.latencyMs || 0}ms</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px">No logs yet</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="csrf-token" content="${csrf}">
  <title>Dashboard — Launcher</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <nav class="nav">
    <div class="nav-brand"><span>▲</span> Launcher</div>
    <div class="nav-links">
      <div class="pill">👤 <strong>${user.username}</strong> (${user.role})</div>
      <a href="/">Home</a>
      <a href="/about">About</a>
      <button class="btn btn-outline btn-sm" onclick="logout()">Sign Out</button>
    </div>
  </nav>

  <div class="container">
    <h1 style="font-size:28px;font-weight:800;margin-bottom:4px">Developer Dashboard</h1>
    <p style="color:var(--muted);margin-bottom:24px">Server-side rendered with <code>getServerSideProps</code> • Zero npm packages</p>

    <!-- Dashboard Tabs -->
    <div class="tabs">
      <button class="tab active" data-tab="services" onclick="switchTab('services')">🚀 Services</button>
      <button class="tab" data-tab="keys" onclick="switchTab('keys')">🔑 API Keys</button>
      <button class="tab" data-tab="rate" onclick="switchTab('rate')">🪣 Rate Limiter</button>
      <button class="tab" data-tab="logs" onclick="switchTab('logs')">📊 Logs</button>
    </div>

    <!-- TAB: Services -->
    <div id="pane-services" class="tab-pane active">
      <div class="card">
        <div class="card-head">
          <h3>🚀 Deployed Microservices</h3>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('deploy-modal').classList.add('open')">+ Deploy Service</button>
        </div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Route</th><th>Created</th><th>Hits</th><th style="text-align:right">Action</th></tr></thead>
            <tbody>${svcRows}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB: API Keys -->
    <div id="pane-keys" class="tab-pane">
      <div class="card">
        <div class="card-head"><h3>🔑 Developer API Key</h3></div>
        <div class="card-body">
          <p style="color:var(--muted);font-size:13px;margin-bottom:12px">Use with <code>x-api-key</code> header or <code>Authorization: Bearer</code></p>
          <div class="code" id="api-key-display" style="user-select:all;margin-bottom:14px">${user.apiKey || 'No key generated'}</div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('api-key-display').textContent);toast('Copied!')">Copy</button>
            <button class="btn btn-danger btn-sm" onclick="rotateKey()">Rotate Key</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB: Rate Limiter -->
    <div id="pane-rate" class="tab-pane">
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>Session Bucket</h3></div>
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
              <span style="color:var(--muted)">Capacity: ${userRate.capacity} • Fill: ${userRate.fillRate}/s</span>
              <span id="user-tokens" style="font-weight:700;color:var(--accent)">${userRate.tokens} (${userRate.percentage}%)</span>
            </div>
            <div class="progress"><div class="progress-fill" id="user-bar" style="width:${userRate.percentage}%"></div></div>
          </div>
        </div>
        ${apiRate ? `<div class="card">
          <div class="card-head"><h3>API Key Bucket</h3></div>
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
              <span style="color:var(--muted)">Capacity: ${apiRate.capacity} • Fill: ${apiRate.fillRate}/s</span>
              <span style="font-weight:700;color:var(--accent)">${apiRate.tokens} (${apiRate.percentage}%)</span>
            </div>
            <div class="progress"><div class="progress-fill" style="width:${apiRate.percentage}%"></div></div>
          </div>
        </div>` : ''}
      </div>
      <div style="margin-top:16px">
        <button class="btn btn-primary btn-sm" onclick="burstTest()">Simulate Burst Hit</button>
        <span id="burst-result" style="margin-left:10px;font-size:13px;color:var(--muted)"></span>
      </div>
    </div>

    <!-- TAB: Logs -->
    <div id="pane-logs" class="tab-pane">
      <div class="card">
        <div class="card-head"><h3>📊 Request Logs</h3></div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Time</th><th>Route</th><th>Status</th><th>Latency</th></tr></thead>
            <tbody>${logRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Deploy Modal -->
  <div id="deploy-modal" class="modal-bg">
    <div class="modal">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:4px">Deploy New Service</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:20px">Service will be live at <code>/&lt;name&gt;</code> immediately.</p>
      <form onsubmit="return deployService(event)">
        <div class="form-group">
          <label>Service Name</label>
          <input type="text" id="svc-name" placeholder="my-service" required>
        </div>
        <div class="form-group">
          <label>Module Code</label>
          <textarea id="svc-code" rows="8" required>export default {
  async server(req) {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    };
  }
};</textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('deploy-modal').classList.remove('open')">Cancel</button>
          <button type="submit" class="btn btn-primary">Deploy</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    async function logout() {
      await api('/api/auth?action=logout', { method: 'POST' });
      location.href = '/login';
    }

    async function rotateKey() {
      if (!confirm('Rotate your API key? The old key stops working immediately.')) return;
      const { ok, data } = await api('/api/auth?action=rotate-key', { method: 'POST' });
      if (ok) { document.getElementById('api-key-display').textContent = data.newKey; toast('Key rotated!'); }
      else toast(data.error || 'Failed', 'error');
    }

    async function deployService(e) {
      e.preventDefault();
      const name = document.getElementById('svc-name').value.trim();
      const code = document.getElementById('svc-code').value;
      const { ok, data } = await api('/api/services', { method: 'POST', body: { name, code } });
      if (ok) { toast('Deployed /' + name + '!'); setTimeout(() => location.reload(), 800); }
      else toast(data.error || 'Deploy failed', 'error');
      return false;
    }

    async function delService(name) {
      if (!confirm('Delete /' + name + '?')) return;
      const { ok } = await api('/api/services?name=' + name, { method: 'DELETE' });
      if (ok) { toast('Deleted'); setTimeout(() => location.reload(), 800); }
    }

    async function burstTest() {
      const el = document.getElementById('burst-result');
      const res = await fetch('/api/ratelimit?action=test-hit');
      const d = await res.json();
      if (res.status === 429) el.innerHTML = '<span style="color:var(--red)">429 Too Many Requests — wait ' + d.retryAfter + 's</span>';
      else el.innerHTML = '<span style="color:var(--green)">200 OK — ' + d.remaining + ' tokens left</span>';
      // refresh gauge
      const s = await (await fetch('/api/ratelimit?action=stats')).json();
      if (s.user) {
        document.getElementById('user-tokens').textContent = s.user.tokens + ' (' + s.user.percentage + '%)';
        document.getElementById('user-bar').style.width = s.user.percentage + '%';
      }
    }
  </script>
</body>
</html>`;
}
