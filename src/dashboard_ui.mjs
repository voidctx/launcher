function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAuthPage(error = null, mode = 'login') {
  const isSignup = mode === 'signup';
  const title = isSignup ? 'Create Developer Account' : 'Sign In to Launcher';
  const actionUrl = isSignup ? '/api/auth/signup' : '/api/auth/login';
  const switchUrl = isSignup ? '/login' : '/signup';
  const switchText = isSignup ? 'Already have an account? Sign In' : "Don't have an account? Sign Up";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Launcher Edge Runtime</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --error: #f43f5e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 36px; width: 100%; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .logo { font-size: 1.5rem; font-weight: 700; color: var(--primary); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 20px; color: var(--text); }
    .form-group { margin-bottom: 16px; text-align: left; }
    label { display: block; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 6px; }
    input { width: 100%; padding: 10px 14px; background: #070a12; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.95rem; outline: none; transition: border-color 0.15s; }
    input:focus { border-color: var(--primary); }
    button { width: 100%; padding: 12px; background: var(--primary); color: #04101e; border: none; border-radius: 6px; font-weight: 600; font-size: 1rem; cursor: pointer; transition: background 0.15s; margin-top: 8px; }
    button:hover { background: var(--primary-hover); }
    .error-banner { background: rgba(244, 63, 94, 0.15); border: 1px solid var(--error); color: #fda4af; padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 16px; }
    .switch-link { margin-top: 20px; text-align: center; font-size: 0.85rem; }
    .switch-link a { color: var(--primary); text-decoration: none; }
    .switch-link a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚡ Launcher Edge</div>
    <h1>${escapeHtml(title)}</h1>
    ${error ? `<div class="error-banner">${escapeHtml(error)}</div>` : ''}
    <form action="${actionUrl}" method="POST">
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username" placeholder="e.g. dev_alex">
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="${isSignup ? 'new-password' : 'current-password'}" placeholder="At least 6 characters">
      </div>
      <button type="submit">${isSignup ? 'Create Account' : 'Sign In'}</button>
    </form>
    <div class="switch-link">
      <a href="${switchUrl}">${escapeHtml(switchText)}</a>
    </div>
  </div>
</body>
</html>`;
}

export function renderDashboardPage({ user, session, services = [], recentLogs = [], bucketStats = {}, billingSummary = {} }) {
  const csrfToken = session?.csrfToken || '';
  const userBucket = bucketStats.user || { tokens: 30, capacity: 30 };
  const apiBucket = bucketStats.apiKey || { tokens: 60, capacity: 60 };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Developer Console - Launcher Edge Runtime</title>
  <style>
    :root {
      --bg: #080c14;
      --card-bg: #0f172a;
      --border: #1e293b;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding-bottom: 60px; }
    header { background: #0d1322; border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; }
    .brand { font-size: 1.25rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 8px; }
    .user-nav { display: flex; align-items: center; gap: 16px; font-size: 0.9rem; }
    .logout-btn { background: none; border: 1px solid var(--border); color: var(--text-muted); padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
    .logout-btn:hover { color: var(--danger); border-color: var(--danger); }
    .container { max-width: 1200px; margin: 32px auto; padding: 0 20px; display: grid; gap: 24px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); }
    h2 { font-size: 1.15rem; font-weight: 600; margin-bottom: 16px; color: var(--text); display: flex; align-items: center; justify-content: space-between; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 800px) { .grid-2 { grid-template-columns: 1fr; } }
    .metric-row { display: flex; gap: 16px; margin-top: 8px; }
    .metric-box { flex: 1; background: #070b14; border: 1px solid var(--border); border-radius: 8px; padding: 14px; text-align: center; }
    .metric-val { font-size: 1.5rem; font-weight: 700; color: var(--primary); margin-top: 4px; }
    .metric-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .key-box { background: #070b14; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; font-family: monospace; font-size: 0.9rem; margin-top: 10px; color: #a5f3fc; }
    .btn-sm { padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; border: none; transition: 0.15s; }
    .btn-primary { background: var(--primary); color: #04101e; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-danger { background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #fca5a5; }
    .btn-danger:hover { background: var(--danger); color: white; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.85rem; }
    th { text-align: left; padding: 10px 12px; color: var(--text-muted); border-bottom: 1px solid var(--border); font-weight: 500; }
    td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .tag-200 { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .tag-429 { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .tag-500 { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    textarea, input[type="text"] { width: 100%; background: #070b14; border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 10px 12px; font-family: monospace; font-size: 0.85rem; outline: none; margin-bottom: 12px; }
    textarea:focus, input[type="text"]:focus { border-color: var(--primary); }
    .toast { position: fixed; bottom: 20px; right: 20px; background: #1e293b; border: 1px solid var(--primary); color: #f8fafc; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size: 0.9rem; display: none; z-index: 100; }
  </style>
</head>
<body>
  <header>
    <div class="brand">⚡ Launcher Edge Runtime</div>
    <div class="user-nav">
      <span>Logged in as <strong>${escapeHtml(user.username)}</strong></span>
      <form action="/api/auth/logout" method="POST" style="display:inline;">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <button type="submit" class="logout-btn">Sign Out</button>
      </form>
    </div>
  </header>

  <div class="container">
    <!-- Top Row: API Key & Billing Meters -->
    <div class="grid-2">
      <!-- API Key Box -->
      <div class="card">
        <h2>
          <span>API Key Authentication</span>
          <button class="btn-sm btn-primary" onclick="rotateKey()">Rotate Key</button>
        </h2>
        <p style="font-size: 0.85rem; color: var(--text-muted);">Use this key in <code>Authorization: Bearer &lt;key&gt;</code> or <code>x-api-key: &lt;key&gt;</code> headers for metered API calls.</p>
        <div class="key-box">
          <span id="apiKeyVal">${escapeHtml(user.apiKey || 'None generated')}</span>
          <button class="btn-sm" style="background:#1e293b; color:#fff;" onclick="copyKey()">Copy</button>
        </div>
        <div class="metric-row">
          <div class="metric-box">
            <div class="metric-label">Rate Limit Tokens</div>
            <div class="metric-val">${userBucket.tokens}/${userBucket.capacity}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Tier</div>
            <div class="metric-val" style="font-size: 1.1rem; text-transform: uppercase;">${escapeHtml(user.tier || 'STANDARD')}</div>
          </div>
        </div>
      </div>

      <!-- Billing Overview -->
      <div class="card">
        <h2><span>Billing & Consumption Meter</span></h2>
        <div class="metric-row">
          <div class="metric-box">
            <div class="metric-label">Total Requests</div>
            <div class="metric-val">${(billingSummary.totalRequests || 0).toLocaleString()}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Compute Time</div>
            <div class="metric-val">${(billingSummary.computeTimeMs || 0).toLocaleString()} ms</div>
          </div>
          <div class="metric-box">
            <div class="metric-label">Est. Cost</div>
            <div class="metric-val">$${(billingSummary.estimatedCostUsd || 0).toFixed(4)}</div>
          </div>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 14px;">
          Pricing: $0.15 per 100,000 requests. All requests run inside isolated V8 worker threads with memory limits.
        </p>
      </div>
    </div>

    <!-- Middle Row: Deploy Microservice -->
    <div class="card">
      <h2><span>Deploy New Microservice</span></h2>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
        Upload JavaScript ESM code. Code is pre-scanned with the AST-free security scanner and executed inside an isolated worker isolate.
      </p>
      <form id="deployForm" onsubmit="handleDeploy(event)">
        <input type="text" id="svcName" placeholder="Service Name (e.g. weather_api, text_parser)" required pattern="[a-zA-Z0-9_-]{1,64}">
        <textarea id="svcCode" rows="8" placeholder="export default {\n  async server(req) {\n    return {\n      status: 200,\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ message: 'Hello from isolated worker' })\n    };\n  }\n};" required></textarea>
        <button type="submit" class="btn-sm btn-primary" style="padding: 10px 20px; font-size: 0.9rem;">Scan & Deploy</button>
      </form>
      <div id="deployFeedback" style="margin-top: 12px; font-size: 0.85rem; display: none;"></div>
    </div>

    <!-- Your Services List -->
    <div class="card">
      <h2><span>Your Hosted Microservices (${services.length})</span></h2>
      ${services.length === 0 ? '<p style="color:var(--text-muted); font-size:0.9rem;">No microservices registered yet. Deploy your first one above!</p>' : `
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Endpoint URL</th>
              <th>Invocations</th>
              <th>Compute Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${services.map(s => `
              <tr>
                <td><strong>/${escapeHtml(s.name)}</strong></td>
                <td><a href="/${escapeHtml(s.name)}" target="_blank" style="color:var(--primary); text-decoration:none;">/${escapeHtml(s.name)}</a></td>
                <td>${(s.invocations || 0).toLocaleString()}</td>
                <td>${(s.totalComputeMs || 0).toFixed(1)} ms</td>
                <td>
                  <button class="btn-sm" style="background:#1e293b; color:#cbd5e1; margin-right:6px;" onclick="unloadSvc('${escapeHtml(s.name)}')">Unload Worker</button>
                  <button class="btn-sm btn-danger" onclick="deleteSvc('${escapeHtml(s.name)}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <!-- Real-time Invocation History -->
    <div class="card">
      <h2><span>Real-Time Invocation Logs</span></h2>
      ${recentLogs.length === 0 ? '<p style="color:var(--text-muted); font-size:0.9rem;">No requests logged yet.</p>' : `
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Service</th>
              <th>Caller</th>
              <th>Status</th>
              <th>Latency</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            ${recentLogs.slice(0, 15).map(l => `
              <tr>
                <td>${new Date(l.timestamp).toLocaleTimeString()}</td>
                <td>/${escapeHtml(l.serviceName || '-')}</td>
                <td>${escapeHtml(l.authType || 'anon')}</td>
                <td><span class="tag tag-${l.status || 200}">${l.status || 200}</span></td>
                <td>${l.latencyMs !== undefined ? l.latencyMs.toFixed(2) + ' ms' : '-'}</td>
                <td>${escapeHtml(l.ip || '127.0.0.1')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const csrfToken = '${escapeHtml(csrfToken)}';

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    function copyKey() {
      const val = document.getElementById('apiKeyVal').innerText;
      navigator.clipboard.writeText(val);
      showToast('API Key copied to clipboard!');
    }

    async function rotateKey() {
      if (!confirm('Are you sure you want to rotate your API key? The old key will immediately stop working.')) return;
      try {
        const res = await fetch('/api/auth/rotate-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }
        });
        const data = await res.json();
        if (data.ok) {
          document.getElementById('apiKeyVal').innerText = data.newKey;
          showToast('API key successfully rotated!');
        } else {
          alert(data.error || 'Failed to rotate key');
        }
      } catch (err) {
        alert('Network error');
      }
    }

    async function handleDeploy(e) {
      e.preventDefault();
      const name = document.getElementById('svcName').value.trim();
      const code = document.getElementById('svcCode').value;
      const fb = document.getElementById('deployFeedback');

      try {
        const res = await fetch('/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({ name, code })
        });
        const data = await res.json();
        fb.style.display = 'block';
        if (data.deployed) {
          fb.style.color = '#34d399';
          fb.innerHTML = '✔ Service successfully scanned and deployed! Refreshing...';
          setTimeout(() => location.reload(), 1000);
        } else {
          fb.style.color = '#f87171';
          const reasons = (data.report && data.report.reasons) ? data.report.reasons.map(r => r.message).join('<br>') : (data.message || 'Deploy rejected');
          fb.innerHTML = '✖ Deploy Rejected by Security Scanner:<br>' + reasons;
        }
      } catch (err) {
        alert('Deploy request failed');
      }
    }

    async function unloadSvc(name) {
      const res = await fetch('/api/services/' + name + '/unload', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
      const data = await res.json();
      showToast('Worker memory for /' + name + ' evicted.');
    }

    async function deleteSvc(name) {
      if (!confirm('Delete service /' + name + '?')) return;
      const res = await fetch('/api/services/' + name, { method: 'DELETE', headers: { 'x-csrf-token': csrfToken } });
      location.reload();
    }
  </script>
</body>
</html>`;
}
