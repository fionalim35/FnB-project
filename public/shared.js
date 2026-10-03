/* Shared helpers for staff portals (admin / kitchen / cashier) */
'use strict';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
let CUR = 'RM';
const fmt = (n) => `${CUR}${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (t) => new Date(t).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function toast(msg, isErr) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/** Staff session: one token per role, kept in localStorage. */
function createApi(role) {
  const KEY = `fnb_token_${role}`;
  const api = {
    token: localStorage.getItem(KEY) || '',
    onAuthLost: null,
    async call(method, url, body) {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { api.token = ''; localStorage.removeItem(KEY); if (api.onAuthLost) api.onAuthLost(); }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
    get: (u) => api.call('GET', u),
    post: (u, b) => api.call('POST', u, b || {}),
    put: (u, b) => api.call('PUT', u, b || {}),
    del: (u) => api.call('DELETE', u),
    async login(pin) {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, pin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      api.token = data.token; localStorage.setItem(KEY, data.token);
    },
    logout() { api.token = ''; localStorage.removeItem(KEY); location.reload(); },
  };
  return api;
}

/** Shows a PIN gate until logged in, then calls start(). */
function requireLogin(api, title, start) {
  const gate = document.createElement('div');
  gate.className = 'gate';
  gate.innerHTML = `<form class="gate-card"><h1>${esc(title)}</h1><p class="muted">Enter your staff PIN to continue</p>
    <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" autofocus>
    <button class="btn primary lg" type="submit">Log in</button><div class="gate-err" id="gerr"></div></form>`;
  const show = () => { document.body.appendChild(gate); $('#pin', gate).value = ''; $('#pin', gate).focus(); };
  const hide = () => gate.remove();
  gate.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.login($('#pin', gate).value); hide(); start(); }
    catch (err) { $('#gerr', gate).textContent = err.message; }
  });
  api.onAuthLost = show;
  // With a saved token we just start; any 401 re-opens the gate via onAuthLost.
  if (api.token) start(); else show();
}

/** Live updates: call fn() (debounced) whenever the server broadcasts a change. */
function live(fn) {
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(fn, 250); };
  const es = new EventSource('/api/events');
  es.onmessage = fire;
  es.onerror = () => {};
  setInterval(fn, 30000); // safety net
  return es;
}

function modal(html, { wide } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  return { el: wrap.firstElementChild, close };
}
