// public/js/dashboard.js - Admin Gateway Frontend Logic
let currentCsrfToken = null;
let autoRefreshTimer = null;

const authScreen = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const refreshBtn = document.getElementById('refresh-btn');
const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
const currentUsernameEl = document.getElementById('current-username');

const statTotalServices = document.getElementById('stat-total-services');
const statLoadedServices = document.getElementById('stat-loaded-services');
const statEvictedServices = document.getElementById('stat-evicted-services');
const statResidentMemory = document.getElementById('stat-resident-memory');
const statMemorySaved = document.getElementById('stat-memory-saved');
const statSavingsPct = document.getElementById('stat-savings-pct');
const statTotalRequests = document.getElementById('stat-total-requests');

const servicesTableBody = document.getElementById('services-table-body');
const simulationPills = document.getElementById('simulation-pills');

const serviceModal = document.getElementById('service-modal');
const modalTitle = document.getElementById('modal-title');
const serviceForm = document.getElementById('service-form');
const openRegisterModalBtn = document.getElementById('open-register-modal-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');

const formIsEdit = document.getElementById('form-is-edit');
const formServiceId = document.getElementById('form-service-id');
const formName = document.getElementById('form-name');
const formUri = document.getElementById('form-uri');
const formHeader = document.getElementById('form-header');
const formMemoryCap = document.getElementById('form-memory-cap');
const formFile = document.getElementById('form-file');
const formDesc = document.getElementById('form-desc');
const formSecurity = document.getElementById('form-security');

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function apiRequest(url, options = {}) {
  options.headers = options.headers || {};
  if (!options.headers['Content-Type'] && options.body) {
    options.headers['Content-Type'] = 'application/json';
  }
  if (currentCsrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
    options.headers['x-csrf-token'] = currentCsrfToken;
  }
  options.credentials = 'same-origin';

  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !url.includes('/login') && !url.includes('/me')) {
    showToast('Session expired. Please log in again.', 'error');
    setAuthState(false);
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }

  return data;
}

async function checkAuthSession() {
  try {
    const data = await apiRequest('/api/admin/me');
    if (data.authenticated && data.user) {
      currentCsrfToken = data.csrfToken;
      currentUsernameEl.innerText = data.user.username;
      setAuthState(true);
      loadDashboardData();
    } else {
      setAuthState(false);
    }
  } catch (err) {
    setAuthState(false);
  }
}

function setAuthState(isAuthenticated) {
  if (isAuthenticated) {
    authScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    startAutoRefresh();
  } else {
    authScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
    stopAutoRefresh();
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await apiRequest('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (res.success) {
      currentCsrfToken = res.csrfToken;
      currentUsernameEl.innerText = res.user.username;
      showToast(`Welcome back, ${res.user.username}!`, 'success');
      setAuthState(true);
      loadDashboardData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await apiRequest('/api/admin/logout', { method: 'POST' });
    showToast('Logged out successfully', 'info');
  } catch (err) {
  } finally {
    currentCsrfToken = null;
    setAuthState(false);
  }
});

refreshBtn.addEventListener('click', () => {
  loadDashboardData();
  showToast('Dashboard telemetry refreshed', 'info');
});

async function loadDashboardData() {
  try {
    const [servicesData, statsData] = await Promise.all([
      apiRequest('/api/admin/services'),
      apiRequest('/api/admin/system/stats')
    ]);

    if (statsData.success) {
      renderStats(statsData.stats);
    }

    if (servicesData.success) {
      renderServices(servicesData.services);
      renderSimulationPills(servicesData.services);
    }
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}

function renderStats(stats) {
  statTotalServices.innerText = stats.totalServices;
  statLoadedServices.innerText = stats.loadedServices;
  statEvictedServices.innerText = stats.evictedServices;
  statResidentMemory.innerText = `${stats.residentMemoryMb} MB`;
  statMemorySaved.innerText = `${stats.memorySavedMb} MB`;
  statSavingsPct.innerText = stats.savingsPercentage;
  statTotalRequests.innerText = stats.totalRequests;
}

function renderServices(services) {
  if (!services || services.length === 0) {
    servicesTableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No services registered yet. Click "+ Register New Service" to add one.</td></tr>`;
    return;
  }

  servicesTableBody.innerHTML = services.map(s => {
    const isLoaded = s.state === 'loaded';
    const statusBadge = isLoaded 
      ? `<span class="badge badge-loaded">● LOADED</span>`
      : `<span class="badge badge-evicted">○ EVICTED</span>`;

    const securityClass = s.securityStatus === 'approved' ? 'badge-approved' : (s.securityStatus === 'flagged' ? 'badge-flagged' : 'badge-rejected');
    const securityBadge = `<span class="badge ${securityClass}">${(s.securityStatus || 'approved').toUpperCase()}</span>`;
    const memoryText = isLoaded ? `<strong>${s.memoryMb} MB</strong>` : `<span class="text-muted">0 MB (Idle)</span>`;

    return `
      <tr data-service-id="${s.id}">
        <td>
          <div class="service-title">${escapeHtml(s.name)}</div>
          <div class="service-sub">ID: ${escapeHtml(s.id)}</div>
        </td>
        <td>
          <div><code>${escapeHtml(s.uriPrefix)}</code></div>
          ${s.headerMatch ? `<div class="service-sub text-muted">${escapeHtml(s.headerMatch)}</div>` : ''}
        </td>
        <td>${statusBadge}</td>
        <td>${memoryText}</td>
        <td><strong>${s.requestCount}</strong></td>
        <td>${securityBadge}</td>
        <td>
          <div class="actions-cell">
            ${isLoaded 
              ? `<button class="btn btn-secondary btn-sm" onclick="unloadService('${s.id}')" title="Evict from RAM to save memory">🛑 Unload</button>`
              : `<button class="btn btn-success btn-sm" onclick="loadService('${s.id}')" title="Pre-warm / Load into RAM">🚀 Load</button>`
            }
            <button class="btn btn-secondary btn-sm" onclick="simulateTraffic('${s.id}')" title="Fire simulated request">⚡ Test</button>
            <button class="btn btn-secondary btn-sm" onclick="openEditModal('${s.id}')" title="Edit Service">✏️</button>
            <button class="btn btn-outline-danger btn-sm" onclick="deleteService('${s.id}', '${escapeHtml(s.name)}')" title="Delete Service">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderSimulationPills(services) {
  simulationPills.innerHTML = services.map(s => `
    <button class="sim-btn" onclick="simulateTraffic('${s.id}')">
      <span>Hit <strong>${escapeHtml(s.name)}</strong></span>
      <code>${s.uriPrefix}</code>
    </button>
  `).join('');
}

window.loadService = async function(id) {
  try {
    const res = await apiRequest(`/api/admin/services/${id}/load`, { method: 'POST' });
    showToast(`Loaded ${res.service.name} into RAM!`, 'success');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.unloadService = async function(id) {
  try {
    const res = await apiRequest(`/api/admin/services/${id}/unload`, { method: 'POST' });
    showToast(`Evicted ${res.service.name} from RAM!`, 'info');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.simulateTraffic = async function(id) {
  try {
    const res = await apiRequest(`/api/admin/services/${id}/simulate-request`, { method: 'POST' });
    showToast(`Dispatched request to ${res.service.name}! (State: ${res.service.state})`, 'success');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteService = async function(id, name) {
  if (!confirm(`Are you sure you want to remove service "${name}"?`)) return;
  try {
    await apiRequest(`/api/admin/services/${id}`, { method: 'DELETE' });
    showToast(`Service "${name}" removed.`, 'info');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

openRegisterModalBtn.addEventListener('click', () => {
  modalTitle.innerText = 'Register New Service';
  formIsEdit.value = 'false';
  formServiceId.value = '';
  serviceForm.reset();
  formSecurity.value = 'approved';
  formMemoryCap.value = '32';
  formFile.value = './sample-services/hello-service.js';
  serviceModal.classList.remove('hidden');
});

window.openEditModal = async function(id) {
  try {
    const res = await apiRequest(`/api/admin/services/${id}`);
    const s = res.service;
    modalTitle.innerText = `Update Service: ${s.name}`;
    formIsEdit.value = 'true';
    formServiceId.value = s.id;
    formName.value = s.name;
    formUri.value = s.uriPrefix;
    formHeader.value = s.headerMatch || '';
    formMemoryCap.value = s.memoryCapMb || 32;
    formFile.value = s.handlerFile || '';
    formDesc.value = s.description || '';
    formSecurity.value = s.securityStatus || 'approved';
    serviceModal.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

modalCloseBtn.addEventListener('click', () => serviceModal.classList.add('hidden'));
modalCancelBtn.addEventListener('click', () => serviceModal.classList.add('hidden'));

serviceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const isEdit = formIsEdit.value === 'true';
  const id = formServiceId.value;

  const payload = {
    name: formName.value.trim(),
    uriPrefix: formUri.value.trim(),
    headerMatch: formHeader.value.trim(),
    memoryCapMb: parseInt(formMemoryCap.value, 10) || 32,
    handlerFile: formFile.value.trim(),
    description: formDesc.value.trim(),
    securityStatus: formSecurity.value
  };

  try {
    if (isEdit) {
      await apiRequest(`/api/admin/services/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast(`Service '${payload.name}' updated!`, 'success');
    } else {
      await apiRequest('/api/admin/services', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast(`Service '${payload.name}' registered!`, 'success');
    }
    serviceModal.classList.add('hidden');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function startAutoRefresh() {
  stopAutoRefresh();
  if (autoRefreshToggle.checked) {
    autoRefreshTimer = setInterval(() => {
      loadDashboardData();
    }, 3000);
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

autoRefreshToggle.addEventListener('change', () => {
  if (autoRefreshToggle.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', checkAuthSession);
