/**
 * Dashboard & Auth UI templates
 * Pure HTML, CSS, and Vanilla JavaScript
 */

export function renderAuthPage(errorMessage = '', successMessage = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Launcher | Sign In & Signup</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --border: #334155;
      --error: #f87171;
      --success: #4ade80;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .auth-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }
    .auth-header {
      padding: 30px 30px 10px;
      text-align: center;
    }
    .logo {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--primary);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .logo-icon {
      background: var(--primary);
      color: #000;
      border-radius: 8px;
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      margin-top: 20px;
    }
    .tab-btn {
      flex: 1;
      padding: 14px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      color: var(--primary);
      border-bottom: 2px solid var(--primary);
      background: rgba(56, 189, 248, 0.05);
    }
    .form-container {
      padding: 30px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 6px;
      color: var(--text-muted);
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 12px 14px;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: #fff;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: var(--primary);
    }
    .submit-btn {
      width: 100%;
      padding: 12px;
      background: var(--primary);
      color: #0f172a;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .submit-btn:hover {
      background: var(--primary-hover);
    }
    .alert {
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      text-align: center;
    }
    .alert-error {
      background: rgba(248, 113, 113, 0.15);
      border: 1px solid var(--error);
      color: var(--error);
    }
    .alert-success {
      background: rgba(74, 222, 128, 0.15);
      border: 1px solid var(--success);
      color: var(--success);
    }
    .note {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 15px;
      text-align: center;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="auth-header">
      <div class="logo">
        <span class="logo-icon">▲</span> Launcher
      </div>
      <p class="subtitle">Modular Microservice Runtime & Hosting</p>
    </div>

    <div class="tabs">
      <button class="tab-btn active" id="loginTabBtn" onclick="switchTab('login')">Sign In</button>
      <button class="tab-btn" id="signupTabBtn" onclick="switchTab('signup')">Create Account</button>
    </div>

    <div class="form-container">
      <div id="alertBox">
        ${errorMessage ? `<div class="alert alert-error">${errorMessage}</div>` : ''}
        ${successMessage ? `<div class="alert alert-success">${successMessage}</div>` : ''}
      </div>

      <!-- Login Form -->
      <form id="loginForm" method="POST" action="/api/auth/login">
        <div class="form-group">
          <label for="login-username">Username</label>
          <input type="text" id="login-username" name="username" required autocomplete="username" placeholder="e.g. srinibas" autofocus>
        </div>
        <div class="form-group">
          <label for="login-password">Password</label>
          <input type="password" id="login-password" name="password" required autocomplete="current-password" placeholder="••••••••">
        </div>
        <button type="submit" class="submit-btn">Sign In with Session</button>
      </form>

      <!-- Signup Form -->
      <form id="signupForm" method="POST" action="/api/auth/signup" style="display: none;">
        <div class="form-group">
          <label for="signup-username">Desired Username</label>
          <input type="text" id="signup-username" name="username" required autocomplete="username" placeholder="e.g. developer">
        </div>
        <div class="form-group">
          <label for="signup-password">Password (hashed with scrypt)</label>
          <input type="password" id="signup-password" name="password" required autocomplete="new-password" placeholder="At least 6 characters">
        </div>
        <button type="submit" class="submit-btn">Create Account</button>
      </form>

      <p class="note">
        🔒 Secured with server-side session cookies (HttpOnly, SameSite, Secure). Passwords hashed using scrypt.
      </p>
    </div>
  </div>

  <script>
    function switchTab(mode) {
      const loginForm = document.getElementById('loginForm');
      const signupForm = document.getElementById('signupForm');
      const loginTab = document.getElementById('loginTabBtn');
      const signupTab = document.getElementById('signupTabBtn');

      if (mode === 'login') {
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
      } else {
        loginForm.style.display = 'none';
        signupForm.style.display = 'block';
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
      }
    }
  </script>
</body>
</html>`;
}

export function renderDashboardPage({ user, session, services = [], recentLogs = [], bucketStats = {} }) {
  const csrfToken = session.csrfToken;
  const username = user.username;
  const apiKey = user.apiKey || 'None';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Launcher | Developer Dashboard</title>
  <meta name="csrf-token" content="${csrfToken}">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --card-header: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --border: #374151;
      --border-light: #2d3748;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --code-bg: #030712;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Navbar */
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 14px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 20px;
      font-weight: 700;
      color: var(--primary);
    }
    .brand-icon {
      background: var(--primary);
      color: #0b0f19;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .nav-user {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .user-pill {
      background: #1f2937;
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .user-pill strong { color: #fff; }
    .btn-logout {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-logout:hover {
      background: rgba(248, 113, 113, 0.1);
      border-color: var(--danger);
      color: var(--danger);
    }

    /* Layout */
    .container {
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      padding: 24px;
      flex: 1;
    }

    /* Nav Tabs */
    .nav-tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
      overflow-x: auto;
    }
    .nav-tab {
      padding: 12px 18px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .nav-tab:hover {
      color: var(--text);
    }
    .nav-tab.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
      background: rgba(56, 189, 248, 0.05);
      border-radius: 6px 6px 0 0;
    }

    /* Tab Content */
    .tab-pane {
      display: none;
    }
    .tab-pane.active {
      display: block;
      animation: fadeIn 0.15s ease-in;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 24px;
    }
    .card-header {
      padding: 18px 24px;
      background: var(--card-header);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-title {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card-body {
      padding: 24px;
    }

    /* Grid */
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
    }
    @media (max-width: 768px) {
      .grid-2 { grid-template-columns: 1fr; }
    }

    /* Buttons */
    .btn {
      padding: 9px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--primary);
      color: #0b0f19;
      font-weight: 600;
    }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-danger {
      background: rgba(248, 113, 113, 0.15);
      border: 1px solid var(--danger);
      color: var(--danger);
    }
    .btn-danger:hover { background: var(--danger); color: #fff; }
    .btn-secondary {
      background: #1f2937;
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-secondary:hover { background: #374151; }

    /* Tables */
    .table-container {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th {
      padding: 12px 16px;
      background: #1f2937;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-light);
      font-size: 14px;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success { background: rgba(52, 211, 153, 0.15); color: var(--success); }
    .badge-warning { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
    .badge-info { background: rgba(56, 189, 248, 0.15); color: var(--primary); }

    /* Code & Key Boxes */
    .key-box {
      display: flex;
      align-items: center;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 15px;
      margin: 12px 0;
    }
    .key-value {
      flex: 1;
      letter-spacing: 1px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .code-preview {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
      overflow-x: auto;
      color: #e2e8f0;
      margin-top: 10px;
    }

    /* Forms & Inputs */
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 6px;
      color: var(--text-muted);
    }
    input[type="text"], select, textarea {
      width: 100%;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      outline: none;
    }
    textarea {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      resize: vertical;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--primary);
    }

    /* Stats Cards */
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
    }
    .stat-title {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .stat-val {
      font-size: 28px;
      font-weight: 700;
      color: var(--primary);
    }
    .progress-bar-bg {
      background: #1f2937;
      border-radius: 6px;
      height: 8px;
      margin-top: 10px;
      overflow: hidden;
    }
    .progress-bar-fill {
      background: var(--primary);
      height: 100%;
      transition: width 0.3s;
    }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1f2937;
      border: 1px solid var(--primary);
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
      display: none;
      z-index: 1000;
      animation: slideUp 0.2s ease-out;
    }
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <div class="nav-brand">
      <div class="brand-icon">▲</div>
      <span>Launcher Platform</span>
    </div>
    <div class="nav-user">
      <div class="user-pill">
        <span>👤 User: <strong>${username}</strong> (${user.role})</span>
      </div>
      <form method="POST" action="/api/auth/logout" style="margin: 0;">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <button type="submit" class="btn-logout">Sign Out</button>
      </form>
    </div>
  </header>

  <div class="container">
    <!-- Tabs Header -->
    <div class="nav-tabs">
      <button class="nav-tab active" data-tab="services" onclick="switchNavTab('services', this)">🚀 My Services (<span id="servicesCount">${services.length}</span>)</button>
      <button class="nav-tab" data-tab="deploy" onclick="switchNavTab('deploy', this)">➕ Deploy Service</button>
      <button class="nav-tab" data-tab="keys" onclick="switchNavTab('keys', this)">🔑 API Keys & Auth</button>
      <button class="nav-tab" data-tab="ratelimit" onclick="switchNavTab('ratelimit', this)">📊 Rate Limiter (Token Bucket)</button>
      <button class="nav-tab" data-tab="logs" onclick="switchNavTab('logs', this)">📜 Real-time Logs</button>
    </div>

    <!-- 1. TAB: My Services -->
    <div id="tab-services" class="tab-pane active">
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span>Hosted Modules</span>
          </div>
          <button class="btn btn-primary" onclick="switchNavTab('deploy')">+ Deploy New Module</button>
        </div>
        <div class="card-body">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Service Route</th>
                  <th>Owner</th>
                  <th>Invocations</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="servicesTableBody">
                ${services.length === 0 ? `
                  <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
                      No services deployed yet. Click "Deploy Service" above to launch your first native ESM handler!
                    </td>
                  </tr>
                ` : services.map(s => `
                  <tr id="service-row-${s.name}">
                    <td>
                      <strong><a href="/${s.name}" target="_blank" style="color: var(--primary); text-decoration: none;">/${s.name}</a></strong>
                    </td>
                    <td>${s.userId === user.id ? 'You' : 'System'}</td>
                    <td>${s.invocations || 0} calls</td>
                    <td><span class="badge badge-success">● Active</span></td>
                    <td>${new Date(s.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button class="btn btn-secondary" onclick="testService('${s.name}')">⚡ Test</button>
                      <button class="btn btn-secondary" onclick="copyServiceUrl('${s.name}')">🔗 Copy URL</button>
                      <button class="btn btn-danger" onclick="deleteService('${s.name}')">🗑 Delete</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Quick Test Output Card -->
      <div id="testOutputCard" class="card" style="display: none;">
        <div class="card-header">
          <div class="card-title">⚡ Live Service Test Result (<span id="testTargetService"></span>)</div>
          <button class="btn btn-secondary" onclick="document.getElementById('testOutputCard').style.display='none'">Close</button>
        </div>
        <div class="card-body">
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">Response Status: <strong id="testStatus"></strong> | Time: <span id="testTime"></span>ms</p>
          <pre id="testResponseBox" class="code-preview"></pre>
        </div>
      </div>
    </div>

    <!-- 2. TAB: Deploy Service -->
    <div id="tab-deploy" class="tab-pane">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Upload or Deploy a Service</div>
        </div>
        <div class="card-body">
          <form id="deployForm" onsubmit="handleDeploy(event)">
            <div class="grid-2">
              <div class="form-group">
                <label for="serviceName">Service Route Name (e.g. "greeting", "calculator")</label>
                <input type="text" id="serviceName" required placeholder="lowercase alphanumeric slug" pattern="^[a-zA-Z0-9_-]+$">
                <small style="color: var(--text-muted); font-size: 12px; margin-top: 4px; display: block;">
                  Exposed at <code>http://localhost:65535/&lt;name&gt;</code>
                </small>
              </div>
              <div class="form-group">
                <label for="templateSelect">Load Boilerplate Template</label>
                <select id="templateSelect" onchange="loadTemplate(this.value)">
                  <option value="json">JSON API Handler</option>
                  <option value="echo">Echo Headers & Method</option>
                  <option value="counter">Dynamic Counter & State</option>
                  <option value="html">Custom HTML Document</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Upload .mjs File (Optional)</label>
              <input type="file" id="serviceFile" accept=".mjs,.js" onchange="handleFileUpload(event)" style="padding: 6px; background: transparent; border: 1px dashed var(--border); width: 100%; border-radius: 6px;">
            </div>

            <div class="form-group">
              <label for="serviceCode">Module Code (Native Node.js ESM)</label>
              <textarea id="serviceCode" rows="14" required spellcheck="false"></textarea>
            </div>

            <button type="submit" class="btn btn-primary" id="deploySubmitBtn">🚀 Deploy Service</button>
          </form>
        </div>
      </div>
    </div>

    <!-- 3. TAB: API Keys & Auth -->
    <div id="tab-keys" class="tab-pane">
      <div class="card">
        <div class="card-header">
          <div class="card-title">API Keys for Programmatic Invocation</div>
        </div>
        <div class="card-body">
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6;">
            <strong>Why API Keys?</strong> The Dashboard uses ambient <code>HttpOnly</code> session cookies. Programmatic clients (such as <code>curl</code>, GitHub Actions, microservices, or backend daemons) do not have a browser cookie session. You must supply your API key via the <code>X-API-Key</code> or <code>Authorization: Bearer</code> header.
          </p>

          <div style="margin-top: 20px;">
            <label>Your Active API Key</label>
            <div class="key-box">
              <span id="apiKeyDisplay" class="key-value">${apiKey}</span>
              <button class="btn btn-secondary" onclick="toggleApiKeyVisibility()" style="margin-left: 8px;">👁 Reveal / Mask</button>
              <button class="btn btn-secondary" onclick="copyApiKey()" style="margin-left: 8px;">📋 Copy</button>
            </div>
          </div>

          <div style="margin-top: 20px; display: flex; gap: 12px; align-items: center;">
            <button class="btn btn-danger" onclick="rotateApiKey()">🔄 Rotate API Key</button>
            <span style="font-size: 13px; color: var(--text-muted);">
              ⚠️ Key rotation immediately revokes the current key and provisions a new 48-hex secret.
            </span>
          </div>

          <div style="margin-top: 30px;">
            <h4 style="font-size: 15px; margin-bottom: 8px;">Example cURL Request</h4>
            <pre class="code-preview" id="curlExample">curl -X GET "http://localhost:65535/abce" \\
  -H "X-API-Key: ${apiKey}"</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. TAB: Rate Limiter (Token Bucket) -->
    <div id="tab-ratelimit" class="tab-pane">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Token Bucket Algorithm Monitor</div>
        </div>
        <div class="card-body">
          <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 24px;">
            Launcher enforces rate limiting through an in-memory <strong>Token Bucket</strong>. Requests consume 1 token. Buckets refill continuously up to maximum capacity. When depleted, Launcher rejects incoming requests with <strong>HTTP 429 Too Many Requests</strong> and returns a <code>Retry-After</code> countdown header.
          </p>

          <div class="grid-3">
            <div class="stat-card">
              <div class="stat-title">User Session Rate Limit</div>
              <div class="stat-val" id="statUserTokens">30 / 30</div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="barUserTokens" style="width: 100%;"></div>
              </div>
              <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Burst: 30 tokens | Refill: 5 tokens/sec</p>
            </div>

            <div class="stat-card">
              <div class="stat-title">API Key Rate Limit</div>
              <div class="stat-val" id="statApiTokens">60 / 60</div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="barApiTokens" style="width: 100%;"></div>
              </div>
              <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Burst: 60 tokens | Refill: 10 tokens/sec</p>
            </div>

            <div class="stat-card">
              <div class="stat-title">Per-Service Protection</div>
              <div class="stat-val" id="statSvcTokens">100 / 100</div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="barSvcTokens" style="width: 100%;"></div>
              </div>
              <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Burst: 100 tokens | Refill: 20 tokens/sec</p>
            </div>
          </div>

          <div style="margin-top: 24px;">
            <button class="btn btn-secondary" onclick="simulateBurstTraffic()">⚡ Simulate Burst & Trigger 429</button>
            <button class="btn btn-secondary" onclick="refreshRateLimitStats()">🔄 Refresh Bucket Levels</button>
          </div>
          <div id="burstOutput" class="code-preview" style="display: none; margin-top: 14px;"></div>
        </div>
      </div>
    </div>

    <!-- 5. TAB: Real-time Logs -->
    <div id="tab-logs" class="tab-pane">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Live Request Logs</div>
          <button class="btn btn-secondary" onclick="fetchLiveLogs()">🔄 Refresh</button>
        </div>
        <div class="card-body">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Service</th>
                  <th>Auth Method</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>IP / User-Agent</th>
                </tr>
              </thead>
              <tbody id="logsTableBody">
                ${recentLogs.length === 0 ? `
                  <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
                      No logs captured yet. Send requests to see live audit logs!
                    </td>
                  </tr>
                ` : recentLogs.map(l => `
                  <tr>
                    <td>${new Date(l.timestamp).toLocaleTimeString()}</td>
                    <td><strong>/${l.serviceName}</strong></td>
                    <td><span class="badge ${l.authType === 'api-key' ? 'badge-info' : 'badge-warning'}">${l.authType}</span></td>
                    <td>
                      <span class="badge ${l.status < 400 ? 'badge-success' : l.status === 429 ? 'badge-warning' : 'badge-danger'}">
                        ${l.status}
                      </span>
                    </td>
                    <td>${l.latencyMs || 0} ms</td>
                    <td style="color: var(--text-muted); font-size: 12px;">${l.ip || '127.0.0.1'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- Toast Notification -->
  <div id="toast"></div>

  <script>
    const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    let rawApiKey = "${apiKey}";
    let isKeyMasked = true;

    // Switch Tabs
    function switchNavTab(tabName, el) {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      const targetTab = el || document.querySelector('[data-tab="' + tabName + '"]');
      if (targetTab) targetTab.classList.add('active');

      const targetPane = document.getElementById('tab-' + tabName);
      if (targetPane) targetPane.classList.add('active');

      if (tabName === 'ratelimit') refreshRateLimitStats();
      if (tabName === 'logs') fetchLiveLogs();
    }

    // Show Toast
    function showToast(message) {
      const toast = document.getElementById('toast');
      toast.innerText = message;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    }

    // Boilerplate code templates
    const templates = {
      json: \`export default {
  async server(req) {
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Hello from Launcher JSON API",
        timestamp: new Date().toISOString()
      })
    };
  }
};\`,
      echo: \`export default {
  async server(req) {
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers
      }, null, 2)
    };
  }
};\`,
      counter: \`let count = 0;
export default {
  async server(req) {
    count++;
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "counter",
        currentCount: count
      })
    };
  }
};\`,
      html: \`export default {
  async server(req) {
    return {
      status: 200,
      headers: { "Content-Type": "text/html" },
      body: "<html><body style='font-family:sans-serif;padding:30px;'><h1>Launcher Custom Page</h1><p>Served by native Node.js ESM module.</p></body></html>"
    };
  }
};\`
    };

    function loadTemplate(key) {
      document.getElementById('serviceCode').value = templates[key] || templates.json;
    }
    // Set default template
    document.getElementById('serviceCode').value = templates.json;

    // Handle File Upload into Editor
    function handleFileUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        document.getElementById('serviceCode').value = evt.target.result;
        if (!document.getElementById('serviceName').value) {
          const defaultName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
          document.getElementById('serviceName').value = defaultName;
        }
      };
      reader.readAsText(file);
    }

    // Deploy Service Handler
    async function handleDeploy(e) {
      e.preventDefault();
      const name = document.getElementById('serviceName').value.trim();
      const code = document.getElementById('serviceCode').value;

      try {
        const res = await fetch('/api/services', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': CSRF_TOKEN
          },
          body: JSON.stringify({ name, code })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Deployment failed');

        showToast('Service /' + name + ' deployed successfully!');
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        alert('Deployment error: ' + err.message);
      }
    }

    // Test Service
    async function testService(name) {
      const start = performance.now();
      const card = document.getElementById('testOutputCard');
      const box = document.getElementById('testResponseBox');
      const target = document.getElementById('testTargetService');
      const statusSpan = document.getElementById('testStatus');
      const timeSpan = document.getElementById('testTime');

      target.innerText = '/' + name;
      card.style.display = 'block';
      box.innerText = 'Sending request...';

      try {
        const res = await fetch('/' + name);
        const duration = Math.round(performance.now() - start);
        const text = await res.text();

        statusSpan.innerText = res.status + ' ' + res.statusText;
        timeSpan.innerText = duration;
        box.innerText = text;
      } catch (err) {
        box.innerText = 'Network Error: ' + err.message;
      }
    }

    // Delete Service
    async function deleteService(name) {
      if (!confirm('Are you sure you want to delete /' + name + '?')) return;
      try {
        const res = await fetch('/api/services/' + encodeURIComponent(name), {
          method: 'DELETE',
          headers: {
            'X-CSRF-Token': CSRF_TOKEN
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Deletion failed');

        showToast('Service /' + name + ' deleted.');
        const row = document.getElementById('service-row-' + name);
        if (row) row.remove();
      } catch (err) {
        alert('Delete error: ' + err.message);
      }
    }

    // Copy Service URL
    function copyServiceUrl(name) {
      const url = location.origin + '/' + name;
      navigator.clipboard.writeText(url);
      showToast('Copied: ' + url);
    }

    // API Key Masking & Toggle
    function toggleApiKeyVisibility() {
      const display = document.getElementById('apiKeyDisplay');
      if (isKeyMasked) {
        display.innerText = rawApiKey;
        isKeyMasked = false;
      } else {
        display.innerText = rawApiKey.slice(0, 7) + '••••••••••••••••••••••••••••••';
        isKeyMasked = true;
      }
    }
    // Initially mask key
    if (rawApiKey && rawApiKey !== 'None') {
      document.getElementById('apiKeyDisplay').innerText = rawApiKey.slice(0, 7) + '••••••••••••••••••••••••••••••';
    }

    function copyApiKey() {
      navigator.clipboard.writeText(rawApiKey);
      showToast('API Key copied to clipboard!');
    }

    // Rotate API Key
    async function rotateApiKey() {
      if (!confirm('Are you sure you want to rotate your API Key? All existing automated callers will be invalidated.')) return;
      try {
        const res = await fetch('/api/auth/rotate-key', {
          method: 'POST',
          headers: {
            'X-CSRF-Token': CSRF_TOKEN
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Rotation failed');

        rawApiKey = data.newKey;
        isKeyMasked = false;
        document.getElementById('apiKeyDisplay').innerText = rawApiKey;
        document.getElementById('curlExample').innerText =
          'curl -X GET "http://localhost:65535/abce" \\\\\n  -H "X-API-Key: ' + rawApiKey + '"';

        showToast('New API key generated successfully!');
      } catch (err) {
        alert('Rotation error: ' + err.message);
      }
    }

    // Rate Limiting Stats & Simulation
    async function refreshRateLimitStats() {
      try {
        const res = await fetch('/api/ratelimit/stats');
        const data = await res.json();
        if (data.user) {
          document.getElementById('statUserTokens').innerText = data.user.tokens + ' / ' + data.user.capacity;
          document.getElementById('barUserTokens').style.width = data.user.percentage + '%';
        }
        if (data.apiKey) {
          document.getElementById('statApiTokens').innerText = data.apiKey.tokens + ' / ' + data.apiKey.capacity;
          document.getElementById('barApiTokens').style.width = data.apiKey.percentage + '%';
        }
      } catch (err) {
        console.error('Failed to refresh rate limits:', err);
      }
    }

    async function simulateBurstTraffic() {
      const box = document.getElementById('burstOutput');
      box.style.display = 'block';
      box.innerText = 'Simulating rapid requests to demonstrate token bucket 429 response...\\n';

      for (let i = 1; i <= 35; i++) {
        try {
          const res = await fetch('/api/ratelimit/test-hit');
          const data = await res.json();
          if (res.status === 429) {
            box.innerText += \`[Request \${i}] HTTP 429 Too Many Requests | Retry-After: \${res.headers.get('retry-after') || data.retryAfter}s\\n\`;
            break;
          } else {
            box.innerText += \`[Request \${i}] Status \${res.status} OK | Remaining Tokens: \${data.remaining}\\n\`;
          }
        } catch (err) {
          box.innerText += \`[Request \${i}] Error: \${err.message}\\n\`;
        }
      }
      refreshRateLimitStats();
    }

    // Fetch Live Logs
    async function fetchLiveLogs() {
      try {
        const res = await fetch('/api/logs');
        const logs = await res.json();
        const tbody = document.getElementById('logsTableBody');
        if (!logs || logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No logs recorded yet.</td></tr>';
          return;
        }
        tbody.innerHTML = logs.map(l => \`
          <tr>
            <td>\${new Date(l.timestamp).toLocaleTimeString()}</td>
            <td><strong>/\${l.serviceName}</strong></td>
            <td><span class="badge \${l.authType === 'api-key' ? 'badge-info' : 'badge-warning'}">\${l.authType}</span></td>
            <td>
              <span class="badge \${l.status < 400 ? 'badge-success' : l.status === 429 ? 'badge-warning' : 'badge-danger'}">
                \${l.status}
              </span>
            </td>
            <td>\${l.latencyMs || 0} ms</td>
            <td style="color: var(--text-muted); font-size: 12px;">\${l.ip || '127.0.0.1'}</td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Failed to fetch logs:', err);
      }
    }
  </script>
</body>
</html>`;
}
