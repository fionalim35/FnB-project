'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pd = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pd(d.getMonth() + 1)}-${pd(d.getDate())}`;
const dOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (s) => dOf(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pd(m)}${h < 12 ? 'AM' : 'PM'}`; };
const fmtStamp = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const safe = (fn) => { try { return fn(); } catch { return null; } };

function makeApi(prefix, tokenKey, onAuthFail) {
  const api = async (method, path, body) => {
    const t = safe(() => localStorage.getItem(tokenKey));
    const r = await fetch(prefix + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {}; try { data = await r.json(); } catch { /* empty */ }
    if (r.status === 401 && onAuthFail && !path.includes('login')) onAuthFail();
    if (!r.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = r.status; throw e; }
    return data;
  };
  api.get = (p) => api('GET', p); api.post = (p, b) => api('POST', p, b || {}); api.put = (p, b) => api('PUT', p, b || {}); api.del = (p) => api('DELETE', p);
  api.setToken = (t) => safe(() => (t ? localStorage.setItem(tokenKey, t) : localStorage.removeItem(tokenKey)));
  api.hasToken = () => !!safe(() => localStorage.getItem(tokenKey));
  return api;
}

let toastTimer;
function toast(msg, type) {
  $$('.toast').forEach((t) => t.remove());
  const el = document.createElement('div'); el.className = 'toast ' + (type || ''); el.setAttribute('role', 'status'); el.textContent = msg;
  document.body.appendChild(el); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3200);
}
function openModal(html, wide) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  bg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  return { el: bg.firstElementChild, close };
}
function thumb(item, big) {
  const cls = 'thumb' + (big ? ' lg' : '');
  const img = item.images ? item.images[0] : item.image;
  return img ? `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy">` : `<div class="${cls}" aria-hidden="true">${esc(item.icon || (item.name || '?')[0])}</div>`;
}
function barChart(series, key, fmt) {
  const max = Math.max(1, ...series.map((s) => s[key]));
  return `<div class="bars">${series.map((s) => `<div class="bar" style="height:${Math.max(1, (s[key] / max) * 100)}%"><span>${esc(s.label)}: ${fmt ? fmt(s[key]) : s[key]}</span></div>`).join('')}</div>
  <div class="axis">${series.map((s, i) => `<div>${series.length > 15 && i % 3 ? '' : esc(s.label)}</div>`).join('')}</div>`;
}
async function uploadImage(file, tokenKey) {
  const bmp = await createImageBitmap(file).catch(() => null);
  let blob = file;
  if (bmp) {
    const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  }
  const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg', Authorization: 'Bearer ' + safe(() => localStorage.getItem(tokenKey)) }, body: blob });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Upload failed');
  return d.url;
}
const STATUS = {
  hold: ['Awaiting payment', 'warn'], scheduled: ['Scheduled', 'info'], in_progress: ['In progress', 'warn'], completed: ['Completed', 'ok'], no_show: ['No show', 'bad'], cancelled: ['Cancelled', 'gray'],
  pending_payment: ['Awaiting payment', 'warn'], paid: ['Paid', 'ok'], expired: ['Expired', 'gray'],
};
const statusBadge = (s) => `<span class="badge ${(STATUS[s] || ['', ''])[1]}">${esc((STATUS[s] || [s])[0])}</span>`;
const PAY = { billplz: 'Online banking / card (Billplz)', card: 'Credit / debit card', fpx: 'Online banking (FPX)', ewallet: 'E-wallet' };
