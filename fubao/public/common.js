(function () {
  const FB = (window.FB = {});
  FB.tokenKey = 'fb_token';
  FB.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FB.money = (n) => { n = Number(n) || 0; return 'RM' + (Number.isInteger(n) ? n.toLocaleString('en-MY') : n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
  FB.pts = (n) => (Number(n) || 0).toFixed(2).replace(/\.00$/, '');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  FB.MON = MON; FB.DAYS = DAYS;
  FB.date = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
  FB.dow = (s) => DAYS[new Date(s.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
  FB.dateLong = (s) => (s ? `${FB.dow(s)}, ${FB.date(s)}` : '');
  FB.time = (t) => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; };
  FB.dt = (s) => (s ? `${FB.date(s)}, ${FB.time(s.slice(11, 16))}` : '');
  FB.stamp = (ms) => { const d = new Date(ms + 8 * 3600e3); const iso = d.toISOString(); return FB.date(iso.slice(0, 10)) + ', ' + FB.time(iso.slice(11, 16)); };
  FB.dur = (m) => { m = Number(m) || 0; const h = Math.floor(m / 60), r = m % 60; return (h ? h + ' hr' : '') + (h && r ? ' ' : '') + (r ? r + ' min' : ''); };
  FB.todayMY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  FB.addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  FB.api = async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json' };
    const t = localStorage.getItem(FB.tokenKey);
    if (t) headers.Authorization = 'Bearer ' + t;
    let r;
    try { r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('No connection. Please check your internet and try again.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && t && FB.onAuthFail) FB.onAuthFail();
      const e = new Error(j.error || 'Something went wrong'); e.status = r.status; throw e;
    }
    return j;
  };
  FB.get = (u) => FB.api('GET', u); FB.post = (u, b) => FB.api('POST', u, b || {}); FB.put = (u, b) => FB.api('PUT', u, b || {}); FB.del = (u) => FB.api('DELETE', u);

  FB.toast = (msg, type) => {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + (type || ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), type === 'err' ? 4500 : 2600);
  };
  FB.err = (e) => FB.toast(e && e.message ? e.message : String(e), 'err');

  FB.modal = (title, html, opts = {}) => {
    const o = document.createElement('div'); o.className = 'ovl';
    o.innerHTML = `<div class="sheet ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="sheet-h"><h2>${FB.esc(title)}</h2><button class="x" type="button" aria-label="Close">×</button></div><div class="sheet-b">${html}</div></div>`;
    document.body.appendChild(o);
    const close = () => { o.remove(); if (opts.onClose) opts.onClose(); };
    o.querySelector('.x').onclick = close;
    o.addEventListener('mousedown', (e) => { if (e.target === o && !opts.sticky) close(); });
    return { el: o.querySelector('.sheet-b'), root: o, close };
  };
  FB.confirm = (msg, okText = 'Yes, continue', danger) => new Promise((res) => {
    const m = FB.modal('Please confirm', `<p>${FB.esc(msg)}</p><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" data-n>Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-y>${FB.esc(okText)}</button></div>`, { onClose: () => res(false) });
    m.el.querySelector('[data-n]').onclick = () => { m.close(); };
    m.el.querySelector('[data-y]').onclick = () => { m.root.remove(); res(true); };
  });
  FB.prompt = (title, label, ok = 'Save') => new Promise((res) => {
    const m = FB.modal(title, `<div class="field"><label class="f">${FB.esc(label)}</label><input type="text" id="pr"></div><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-n>Cancel</button><button class="btn" data-y>${FB.esc(ok)}</button></div>`, { onClose: () => res(null) });
    m.el.querySelector('#pr').focus();
    m.el.querySelector('[data-n]').onclick = () => m.close();
    m.el.querySelector('[data-y]').onclick = () => { const v = m.el.querySelector('#pr').value; m.root.remove(); res(v); };
  });

  // downscale phone photos before upload
  FB.resizeImage = (file, max = 1280, q = 0.85) => new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image file'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read the image'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read the image'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });

  FB.icon = (cat, name) => {
    const t = ((cat || '') + ' ' + (name || '')).toLowerCase();
    if (/lash|eye/.test(t)) return '👁️'; if (/brow|lip|embroid|liner/.test(t)) return '🌸'; if (/mani|nail/.test(t)) return '💅';
    if (/facial|skin|filler|aesthetic/.test(t)) return '✨'; return '💎';
  };
  FB.img = (item, cls = 'thumb') => {
    const src = (item.images && item.images[0]) || item.image;
    if (src) return `<img class="${cls}" src="${FB.esc(src)}" alt="${FB.esc(item.name || item.title)}" loading="lazy">`;
    return `<div class="${cls} ph" aria-hidden="true">${FB.icon(item.category, item.name || item.title)}</div>`;
  };

  // countdown timers: <span data-cd="<epoch ms end>"></span>
  FB.cdHtml = (remainingMs) => `<span class="cd" data-cd="${Date.now() + remainingMs}"></span>`;
  function tick() {
    document.querySelectorAll('[data-cd]').forEach((el) => {
      let ms = Number(el.dataset.cd) - Date.now();
      if (ms <= 0) { el.innerHTML = '<b>Ended</b>'; return; }
      const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      const p = (n) => String(n).padStart(2, '0');
      el.innerHTML = (d ? `<b>${d}<small>day${d > 1 ? 's' : ''}</small></b>` : '') + `<b>${p(h)}<small>hrs</small></b><b>${p(m)}<small>min</small></b><b>${p(x)}<small>sec</small></b>`;
    });
  }
  setInterval(tick, 1000);
  FB.tick = tick;

  FB.badge = (status) => {
    const map = {
      pending: ['Awaiting approval', 'warn'], confirmed: ['Confirmed', 'ok'], completed: ['Completed', 'info'], cancelled: ['Cancelled', 'grey'], rejected: ['Declined', 'bad'], no_show: ['No-show', 'bad'],
      pending_payment: ['Awaiting payment', 'warn'], paid: ['Paid', 'ok'], active: ['Active', 'ok'], awaiting_payment: ['Awaiting payment', 'warn'], expired: ['Expired', 'bad'], used_up: ['All used', 'grey'],
      review: ['Receipt under review', 'info'], unpaid: ['Unpaid', 'warn'], rejected_pay: ['Rejected', 'bad'],
    };
    const [t, c] = map[status] || [status, '']; return `<span class="badge ${c}">${FB.esc(t)}</span>`;
  };
  FB.fileInput = (accept = 'image/*') => `<input type="file" accept="${accept}" capture="environment" style="display:none">`;
})();

// Forgot / reset password view (shared by customer app and staff portal)
FB.forgotView = function (box, back) {
  const esc = FB.esc;
  box.innerHTML = `<div class="center" style="margin:10px 0 18px"><h1>Reset password</h1><p class="muted">We will email a 6-digit code to the email address on your account.</p></div>
    <form class="card" id="fg1"><div class="field"><label class="f">Contact number or email</label><input type="text" name="identifier" required></div><button class="btn block">Send me a code</button></form>
    <form class="card hide" id="fg2" style="margin-top:12px"><div class="note" id="fgmsg" style="margin-bottom:10px"></div><div class="field"><label class="f">6-digit code from your email</label><input type="text" name="code" inputmode="numeric" maxlength="6" required></div><div class="field"><label class="f">New password (min 6 characters)</label><input type="password" name="password" minlength="6" required></div><button class="btn block">Set new password</button></form>
    <p class="center" style="margin-top:14px"><button class="link" id="fgback">← Back to log in</button></p>`;
  let ident = '';
  box.querySelector('#fgback').onclick = back;
  box.querySelector('#fg1').onsubmit = async (e) => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    try { ident = e.target.identifier.value; const r = await FB.post('/api/auth/forgot', { identifier: ident }); box.querySelector('#fgmsg').textContent = r.message; box.querySelector('#fg2').classList.remove('hide'); } catch (x) { FB.err(x); }
    btn.disabled = false;
  };
  box.querySelector('#fg2').onsubmit = async (e) => {
    e.preventDefault();
    try { await FB.post('/api/auth/reset', { identifier: ident, code: e.target.code.value, password: e.target.password.value }); FB.toast('Password changed. Please log in.', 'ok'); back(); } catch (x) { FB.err(x); }
  };
};
