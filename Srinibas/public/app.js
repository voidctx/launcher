/* Vanilla Next.js — client-side helpers (zero libraries) */

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function csrfToken() {
  return $('meta[name="csrf-token"]')?.content || '';
}

async function api(url, opts = {}) {
  opts.headers = opts.headers || {};
  const csrf = csrfToken();
  if (csrf) opts.headers['X-CSRF-Token'] = csrf;
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function toast(msg, type) {
  let box = $('#toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  const bg = type === 'error' ? '#f38ba8' : '#cba6f7';
  el.style.cssText = `background:#313244;color:#cdd6f4;border:1px solid ${bg};padding:10px 16px;border-radius:8px;font-size:13px;opacity:0;transform:translateY(8px);transition:all .3s`;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
}
