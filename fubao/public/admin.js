(function () {
  'use strict';
  const { esc, money, pts } = FB;
  FB.tokenKey = 'fb_admin_token';
  const root = document.getElementById('root');
  const S = { user: null, services: [], staff: [], page: 'dashboard' };
  const A = {};
  const token = () => localStorage.getItem(FB.tokenKey);
  const isOwner = () => S.user && S.user.role === 'owner';
  FB.onAuthFail = () => { localStorage.removeItem(FB.tokenKey); S.user = null; showLogin(); };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && A[el.dataset.act]) { e.preventDefault(); Promise.resolve(A[el.dataset.act](el, e)).catch(FB.err); }
  });

  // ------------------------------------------------------------------ small UI helpers
  const F = {
    text: (n, l, v, x = {}) => `<div class="field"><label class="f">${l}</label><input type="${x.type || 'text'}" name="${n}" value="${esc(v == null ? '' : v)}" ${x.req ? 'required' : ''} ${x.attrs || ''}>${x.hint ? `<div class="hint">${x.hint}</div>` : ''}</div>`,
    area: (n, l, v, x = {}) => `<div class="field"><label class="f">${l}</label><textarea name="${n}" ${x.attrs || ''}>${esc(v || '')}</textarea>${x.hint ? `<div class="hint">${x.hint}</div>` : ''}</div>`,
    select: (n, l, opts, v, x = {}) => `<div class="field"><label class="f">${l}</label><select name="${n}" ${x.attrs || ''}>${opts.map(([k, t]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${x.hint ? `<div class="hint">${x.hint}</div>` : ''}</div>`,
    check: (n, l, v, x = {}) => `<div class="field"><label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" name="${n}" ${v ? 'checked' : ''}> <span>${l}</span></label>${x.hint ? `<div class="hint">${x.hint}</div>` : ''}</div>`,
  };
  const collect = (form) => { const o = {}; form.querySelectorAll('input,select,textarea').forEach((el) => { if (!el.name) return; o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return o; };
  const tbl = (head, rows, empty = 'Nothing here yet.') => rows.length ? `<div class="tablewrap"><table class="t"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<div class="card empty">${empty}</div>`;
  const loadServices = async () => { S.services = (await FB.get('/api/admin/services')).items; };
  const loadStaff = async () => { S.staff = (await FB.get('/api/admin/staff')).items; };

  // image uploader
  function imageField(box, imgs, max = 6) {
    const render = () => {
      box.innerHTML = `<div class="imgrow">${imgs.map((u, i) => `<div class="im"><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('')}${imgs.length < max ? '<label class="upl" title="Add photo">＋<input type="file" accept="image/*" hidden></label>' : ''}</div>`;
      box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { imgs.splice(Number(b.dataset.rm), 1); render(); }; });
      const inp = box.querySelector('input[type=file]');
      if (inp) inp.onchange = async () => {
        try { const data = await FB.resizeImage(inp.files[0], 1200, 0.85); const r = await FB.post('/api/admin/upload', { image: data }); imgs.push(r.url); render(); } catch (e) { FB.err(e); }
      };
    };
    render();
  }
  // weekly hours editor
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function hoursHtml(w) {
    return [1, 2, 3, 4, 5, 6, 0].map((d) => { const r = (w && w[d]) || []; const a = r[0] || {}, b = r[1] || {};
      return `<div class="hrs" data-d="${d}"><div class="dn">${DN[d]}</div><input type="checkbox" class="op" ${r.length ? 'checked' : ''} aria-label="Open ${DN[d]}"><input type="time" class="s1" value="${a.s || '10:00'}"><input type="time" class="e1" value="${a.e || '19:00'}"><div class="h2"><input type="time" class="s2" value="${b.s || ''}"><input type="time" class="e2" value="${b.e || ''}"></div></div>`; }).join('') + '<div class="hint">Tick the days that are open. The second pair of times is optional (e.g. a break between 1pm-2pm: 10:00-13:00 and 14:00-19:00).</div>';
  }
  function readHours(box) {
    const w = {};
    box.querySelectorAll('.hrs').forEach((row) => {
      const d = row.dataset.d, r = [];
      if (row.querySelector('.op').checked) {
        r.push({ s: row.querySelector('.s1').value, e: row.querySelector('.e1').value });
        const s2 = row.querySelector('.s2').value, e2 = row.querySelector('.e2').value;
        if (s2 && e2) r.push({ s: s2, e: e2 });
      }
      w[d] = r;
    });
    return w;
  }
  const rangeText = (rs) => (rs && rs.length ? rs.map((r) => `${FB.time(r.s)}-${FB.time(r.e)}`).join(', ') : 'Off');
  const statusBadge = (s) => FB.badge(s);

  // ------------------------------------------------------------------ shell
  const NAV_OWNER = [['dashboard', '📊', 'Dashboard'], ['bookings', '📅', 'Bookings'], ['calendar', '🗓️', 'Calendar & hours'], ['services', '💆', 'Services'], ['packages', '🎁', 'Packages'], ['promos', '⚡', 'Flash promotions'], ['vouchers', '🏷️', 'Vouchers'], ['customers', '👥', 'Customers'], ['payments', '💳', 'Orders & payments'], ['staff', '💅', 'Beauticians'], ['settings', '⚙️', 'Settings']];
  const NAV_STAFF = [['schedule', '📅', 'My schedule']];
  function shell() {
    const nav = isOwner() ? NAV_OWNER : NAV_STAFF;
    root.innerHTML = `<div id="mbar"><button id="menu" aria-label="Menu">☰</button><span>Fubao Portal</span></div><div id="layout"><aside id="side"><div class="logo">Fubao<small>Beauty Centre</small></div><div style="margin-top:14px">${nav.map(([k, i, t]) => `<a href="#/${k}" data-k="${k}">${i} ${t}</a>`).join('')}</div><div class="who">${esc(S.user.name)}<br>${isOwner() ? 'Owner' : 'Beautician'}</div><a href="#" data-act="logout">🚪 Log out</a>${isOwner() ? '<a href="/" target="_blank" rel="noopener">🔗 View customer app</a>' : ''}</aside><main id="main"></main></div>`;
    document.getElementById('menu').onclick = () => document.getElementById('side').classList.toggle('open');
    document.getElementById('side').addEventListener('click', (e) => { if (e.target.closest('a[data-k]')) document.getElementById('side').classList.remove('open'); if (e.target === document.getElementById('side')) document.getElementById('side').classList.remove('open'); });
  }
  A.logout = async () => { try { await FB.post('/api/auth/logout'); } catch {} localStorage.removeItem(FB.tokenKey); S.user = null; showLogin(); };
  const main = () => document.getElementById('main');
  async function route() {
    if (!S.user) return;
    const page = (location.hash.slice(2) || (isOwner() ? 'dashboard' : 'schedule')).split('?')[0];
    const pages = isOwner() ? { dashboard: pgDashboard, bookings: pgBookings, calendar: pgCalendar, services: pgServices, packages: pgPackages, promos: pgPromos, vouchers: pgVouchers, customers: pgCustomers, payments: pgPayments, staff: pgStaff, settings: pgSettings } : { schedule: pgSchedule };
    const fn = pages[page] || Object.values(pages)[0];
    S.page = pages[page] ? page : Object.keys(pages)[0];
    document.querySelectorAll('#side a[data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === S.page));
    main().innerHTML = '<div class="loading"><span class="sp"></span></div>';
    window.scrollTo(0, 0);
    try { await fn(); } catch (e) { main().innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', route);
  const refresh = () => route();

  // ------------------------------------------------------------------ login
  function showLogin() {
    root.innerHTML = `<div class="login"><div class="center" style="margin-bottom:18px"><h1>Fubao Portal</h1><p class="muted">Owner & beautician sign in</p></div><form class="card" id="lf"><div class="field"><label class="f">Contact number or email</label><input type="text" name="identifier" required autocomplete="username"></div><div class="field"><label class="f">Password</label><input type="password" name="password" required autocomplete="current-password"></div><button class="btn block">Sign in</button><p class="center" style="margin:10px 0 0"><button type="button" class="link small" data-act="forgot">Forgot password?</button></p></form><p class="tiny muted center" style="margin-top:12px">Customers: <a href="/">open the customer app</a></p></div>`;
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await FB.post('/api/auth/login', Object.fromEntries(new FormData(e.target)));
        if (r.user.role === 'customer') { btn.disabled = false; return FB.toast('This is the staff portal. Customers please use the customer app.', 'err'); }
        localStorage.setItem(FB.tokenKey, r.token); S.user = r.user; await start();
      } catch (x) { btn.disabled = false; FB.err(x); }
    };
  }
  A.forgot = () => FB.forgotView(root.querySelector('.login'), showLogin);
  async function start() {
    try { S.user = (await FB.get('/api/me')).user; } catch { return showLogin(); }
    if (S.user.role === 'customer') { localStorage.removeItem(FB.tokenKey); return showLogin(); }
    shell();
    if (isOwner()) { await Promise.all([loadServices(), loadStaff()]); }
    route();
  }

  // ------------------------------------------------------------------ dashboard
  async function pgDashboard() {
    const s = await FB.get('/api/admin/stats');
    S.bks = s.upcoming;
    main().innerHTML = `<div class="pg-h"><div><h1>Dashboard</h1><div class="muted">Today is ${FB.dateLong(s.today)}</div></div><button class="btn" data-act="newBooking">＋ New booking</button></div>
      <div class="stats"><a class="sc" href="#/bookings"><b>${s.todayBookings}</b><span>Bookings today</span></a><a class="sc ${s.pendingApprovals ? 'alert' : ''}" href="#/bookings" data-act="goPending"><b>${s.pendingApprovals}</b><span>Waiting for approval</span></a><a class="sc ${s.pendingPayments ? 'alert' : ''}" href="#/payments"><b>${s.pendingPayments}</b><span>Receipts to verify</span></a><a class="sc" href="#/payments"><b>${money(s.revenueMonth)}</b><span>Confirmed payments this month</span></a><a class="sc" href="#/customers"><b>${s.customers}</b><span>Customers</span></a><a class="sc" href="#/customers"><b>${s.activeEntitlements}</b><span>Active package balances</span></a></div>
      <h2 style="margin-bottom:10px">Upcoming appointments</h2>${tbl(['When', 'Customer', 'Treatment', 'Where', 'Beautician', 'Status', ''], s.upcoming.map((b) => `<tr><td><b>${FB.date(b.date)}</b><br>${FB.time(b.start)}</td><td>${esc(b.customerName)}<br><span class="muted small">${esc(b.customerPhone)}</span></td><td>${esc(b.serviceName)}</td><td>${b.mode === 'home' ? '🚗 Home' : '🏠 Studio'}</td><td>${esc(b.beauticianName)}</td><td>${statusBadge(b.status)}</td><td><button class="ibtn" data-act="manageBk" data-id="${b.id}">Manage</button></td></tr>`), 'No upcoming appointments.')}`;
  }
  A.goPending = () => { S.bkFilter = { status: 'pending', from: '', to: '', beauticianId: '' }; location.hash = '#/bookings'; };

  // ------------------------------------------------------------------ bookings
  async function pgBookings() {
    const f = S.bkFilter || (S.bkFilter = { status: '', from: FB.todayMY(), to: '', beauticianId: '' });
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const { bookings } = await FB.get('/api/admin/bookings?' + qs);
    S.bks = bookings;
    main().innerHTML = `<div class="pg-h"><h1>Bookings</h1><button class="btn" data-act="newBooking">＋ New booking</button></div>
      <div class="filters"><div class="field"><label class="f">Status</label><select id="fs"><option value="">All</option>${[['pending', 'Awaiting approval'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['rejected', 'Declined'], ['no_show', 'No-show']].map(([k, t]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label class="f">From</label><input type="date" id="ff" value="${f.from || ''}"></div><div class="field"><label class="f">To</label><input type="date" id="ft" value="${f.to || ''}"></div>
        <div class="field"><label class="f">Beautician</label><select id="fb"><option value="">All</option>${S.staff.map((b) => `<option value="${b.id}" ${f.beauticianId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div><button class="btn ghost sm" data-act="clearBk">Clear dates</button></div>
      ${tbl(['No.', 'When', 'Customer', 'Treatment', 'Where', 'Beautician', 'Status', ''], bookings.map((b) => `<tr><td class="small">${esc(b.no)}</td><td><b>${FB.date(b.date)}</b><br>${FB.time(b.start)}-${FB.time(b.end)}</td><td>${esc(b.customerName)}<br><span class="muted small">${esc(b.customerPhone)}</span></td><td>${esc(b.serviceName)}<br><span class="muted tiny">${esc(b.title)}</span></td><td>${b.mode === 'home' ? '🚗 Home' + (b.feeStatus !== 'paid' ? `<br><span class="tiny">Fee ${FB.badge(b.feeStatus)}</span>` : '') : '🏠 Studio'}</td><td>${esc(b.beauticianName)}${b.autoAssigned ? '<br><span class="tiny muted">auto</span>' : ''}</td><td>${statusBadge(b.status)}</td><td><button class="ibtn" data-act="manageBk" data-id="${b.id}">Manage</button></td></tr>`), 'No bookings match.')}`;
    const rebind = (id, k) => { document.getElementById(id).onchange = (e) => { f[k] = e.target.value; pgBookings(); }; };
    rebind('fs', 'status'); rebind('ff', 'from'); rebind('ft', 'to'); rebind('fb', 'beauticianId');
  }
  A.clearBk = () => { S.bkFilter = { status: S.bkFilter.status, from: '', to: '', beauticianId: S.bkFilter.beauticianId }; pgBookings(); };
  A.manageBk = async (el) => {
    let b = (S.bks || []).find((x) => x.id === el.dataset.id);
    if (!b) b = (await FB.get('/api/admin/day?date=' + FB.todayMY())).bookings.find((x) => x.id === el.dataset.id);
    if (!b) { const all = (await FB.get('/api/admin/bookings')).bookings; b = all.find((x) => x.id === el.dataset.id); }
    bookingModal(b);
  };
  function bookingModal(b) {
    const quals = S.staff.filter((u) => u.active && u.skills.includes(b.serviceId));
    const open = ['pending', 'confirmed'].includes(b.status);
    const m = FB.modal(`${b.no} · ${b.serviceName}`, `<div class="stack"><div class="row between">${statusBadge(b.status)}<span class="muted small">Requested ${FB.stamp(b.createdAt)}</span></div>
      <div class="card flat"><div class="kv"><span>Customer</span><b>${esc(b.contact.name)} · <a href="tel:${esc(b.contact.phone)}">${esc(b.contact.phone)}</a></b></div><div class="kv"><span>Purchase</span><b>${esc(b.title)}</b></div><div class="kv"><span>Where</span><b>${b.mode === 'home' ? '🚗 Home service' : '🏠 Studio'}</b></div>
        ${b.mode === 'home' ? `<div class="kv"><span>Address</span><b style="text-align:right">${esc(b.contact.address)}<br>${esc(b.contact.area)} · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.contact.address + ' ' + b.contact.area)}">map</a></b></div><div class="kv"><span>Home fee ${money(b.homeFee)}</span><b>${FB.badge(b.feeStatus)}</b></div>${(b.payments || []).map((p) => `<div class="kv"><span>${FB.stamp(p.createdAt)} · ${money(p.amount)} ${FB.badge(p.status === 'pending' ? 'review' : p.status)}</span>${p.receipt ? `<a target="_blank" rel="noopener" href="${p.receipt}?t=${token()}">receipt</a>` : ''}</div>`).join('')}` : ''}
        <div class="kv"><span>Time needed</span><b>${FB.dur(b.durationMin)} + ${b.gapMin} min gap</b></div></div>
      ${open ? `<div class="card flat"><h3 style="margin-bottom:8px">${b.status === 'pending' ? 'Approve / assign' : 'Reassign / reschedule'}</h3><form id="mv"><div class="grid3 stackm"><div class="field"><label class="f">Beautician</label><select name="beauticianId">${quals.map((u) => `<option value="${u.id}" ${u.id === b.beauticianId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div><div class="field"><label class="f">Date</label><input type="date" name="date" value="${b.date}"></div><div class="field"><label class="f">Start time</label><input type="time" name="start" value="${b.start}" step="900"></div></div>
        <div class="row wrap">${b.status === 'pending' ? '<button class="btn ok" data-act="bkDo" data-do="approve" data-id="' + b.id + '">✔ Approve</button>' : ''}<button class="btn ghost" data-act="bkDo" data-do="reschedule" data-id="${b.id}">Save changes</button></div></form></div>` : ''}
      <div class="row wrap">${b.status === 'confirmed' ? `<button class="btn" data-act="bkDo" data-do="complete" data-id="${b.id}">✅ Mark completed (deduct 1 session)</button><button class="btn ghost" data-act="bkDo" data-do="noshow" data-id="${b.id}">No-show</button>` : ''}${b.status === 'pending' ? `<button class="btn ghost" data-act="bkDo" data-do="complete" data-id="${b.id}">Mark completed</button><button class="btn danger" data-act="bkDo" data-do="reject" data-id="${b.id}">Decline</button>` : ''}${open ? `<button class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-act="bkDo" data-do="cancel" data-id="${b.id}">Cancel booking</button>` : ''}</div>
      <div><h3>History</h3><div class="small">${(b.log || []).map((l) => `<div class="kv"><span>${esc(l.text)}</span><span class="muted">${FB.stamp(l.at)} · ${esc(l.by)}</span></div>`).join('')}</div></div></div>`, { wide: true });
    A._bm = m;
  }
  A.bkDo = async (el) => {
    const id = el.dataset.id, action = el.dataset.do, body = { action };
    const form = document.getElementById('mv');
    if (form && ['approve', 'reschedule'].includes(action)) Object.assign(body, collect(form));
    if (action === 'reject' || action === 'cancel') { const r = await FB.prompt(action === 'reject' ? 'Decline booking' : 'Cancel booking', 'Reason (optional, shown to customer)', 'Confirm'); if (r === null) return; body.reason = r; }
    if (action === 'complete' && !(await FB.confirm('Mark this treatment as completed? This deducts 1 session from the customer.'))) return;
    const r = await FB.post(`/api/admin/bookings/${id}/action`, body);
    A._bm && A._bm.close(); FB.toast('Updated', 'ok');
    if (S.page === 'bookings' || S.page === 'dashboard') refresh(); else if (S.dayOpen) A.openDay({ dataset: { date: S.dayOpen } });
    return r;
  };
  A.newBooking = async () => {
    const { items: custs } = await FB.get('/api/admin/customers');
    const m = FB.modal('New booking for a customer', `<form id="nb"><div class="field"><label class="f">Customer</label><select name="customerId" id="nbc"><option value="">Choose customer</option>${custs.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.phone)}</option>`).join('')}</select></div><div id="nbbody" class="muted small">Choose a customer to see what they have purchased.</div></form>`, { wide: true });
    document.getElementById('nbc').onchange = async (e) => {
      const body = document.getElementById('nbbody');
      if (!e.target.value) { body.innerHTML = ''; return; }
      const d = await FB.get('/api/admin/customers/' + e.target.value);
      const ok = d.entitlements.filter((x) => x.bookable);
      if (!ok.length) { body.innerHTML = '<div class="note warn">This customer has no available sessions. Use <b>Customers → Manual sale</b> to add a purchase first.</div>'; return; }
      body.innerHTML = `${F.select('entitlementId', 'Treatment (from purchases)', ok.map((x) => [x.id, `${x.serviceName} - ${x.title} (${x.unlimited ? 'unlimited' : x.available + ' left'})`]), '')}
        <div class="grid3 stackm">${F.select('mode', 'Where', [['studio', 'Studio'], ['home', 'Home service']], 'studio')}${F.text('date', 'Date', FB.todayMY(), { type: 'date', req: true })}${F.text('start', 'Start time', '10:00', { type: 'time', req: true, attrs: 'step="900"' })}</div>
        <div class="grid2 stackm">${F.select('beauticianId', 'Beautician', [['', 'Any qualified beautician'], ...S.staff.filter((s) => s.active).map((s) => [s.id, s.name])], '')}${F.text('name', 'Contact name', d.customer.name)}</div>${F.text('phone', 'Contact number', d.customer.phone)}
        <div id="homebox" class="hide">${F.text('address', 'Home address', d.customer.address)}${F.select('area', 'Area', [['', 'Choose area'], ...((await FB.get('/api/public')).studio.homeAreas.map((a) => [a, a]))], d.customer.area)}</div>
        <button class="btn block">Create confirmed booking</button><p class="hint">Booked by owner = automatically confirmed. The system still blocks overlapping times and times outside working hours.</p>`;
      const mode = body.querySelector('[name=mode]'); mode.onchange = () => body.querySelector('#homebox').classList.toggle('hide', mode.value !== 'home');
    };
    document.getElementById('nb').onsubmit = async (e) => {
      e.preventDefault(); const v = collect(e.target);
      try { await FB.post('/api/admin/bookings', { customerId: v.customerId, entitlementId: v.entitlementId, mode: v.mode, date: v.date, start: v.start, beauticianId: v.beauticianId, contact: { name: v.name, phone: v.phone, address: v.address || '', area: v.area || '' } }); m.close(); FB.toast('Booking created', 'ok'); if (S.page === 'bookings' || S.page === 'dashboard') refresh(); } catch (x) { FB.err(x); }
    };
  };

  // ------------------------------------------------------------------ calendar
  async function pgCalendar() {
    const month = S.calMonth || (S.calMonth = FB.todayMY().slice(0, 7));
    const { days } = await FB.get('/api/admin/calendar?month=' + month);
    const [y, m] = month.split('-').map(Number), lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), today = FB.todayMY();
    main().innerHTML = `<div class="pg-h"><div><h1>Calendar & opening hours</h1><div class="muted">Click a day to change studio hours, set beautician days off, or see appointments.</div></div><div class="row"><button class="btn ghost sm" data-act="calNav" data-d="-1">‹</button><b style="min-width:130px;text-align:center">${FB.MON[m - 1]} ${y}</b><button class="btn ghost sm" data-act="calNav" data-d="1">›</button></div></div>
      <div class="mcal">${DN.map((d) => `<div class="dn">${d}</div>`).join('')}${'<div class="dc empty"></div>'.repeat(lead)}${days.map((d) => `<button class="dc ${d.open ? '' : 'closed'} ${d.date === today ? 'today' : ''}" data-act="openDay" data-date="${d.date}"><b>${Number(d.date.slice(8))}</b>${d.open ? '' : '<span>Closed</span>'}${d.override ? '<span class="tiny">★ special</span>' : ''}${d.bookings ? `<span class="n">${d.bookings} booked</span>` : ''}${d.pending ? `<span class="pn">${d.pending} pending</span>` : ''}</button>`).join('')}</div>
      <p class="hint" style="margin-top:12px">Regular weekly hours are set in <a href="#/settings">Settings</a> (studio) and <a href="#/staff">Beauticians</a> (each person). Use this calendar for public holidays, special hours or days off.</p>`;
  }
  A.calNav = (el) => { const [y, m] = S.calMonth.split('-').map(Number); S.calMonth = new Date(Date.UTC(y, m - 1 + Number(el.dataset.d), 1)).toISOString().slice(0, 7); pgCalendar(); };
  A.openDay = async (el) => {
    const date = el.dataset.date; S.dayOpen = date;
    const d = await FB.get('/api/admin/day?date=' + date);
    const mode = (o) => (!o ? 'default' : o.closed || o.off ? 'off' : 'custom');
    const rangeInputs = (o, ranges) => { const r = (o && o.ranges && o.ranges[0]) || ranges[0] || { s: '10:00', e: '19:00' }; return `<span class="custom row" style="gap:6px"><input type="time" class="cs" value="${r.s}" style="width:110px"><input type="time" class="ce" value="${r.e}" style="width:110px"></span>`; };
    S.dayBks = d.bookings;
    const m = FB.modal(FB.dateLong(date), `<div class="stack"><div class="card flat"><h3 style="margin-bottom:8px">Studio</h3><div class="row wrap" data-scope="studio"><select class="md" style="width:auto"><option value="default" ${mode(d.studio.override) === 'default' ? 'selected' : ''}>Regular hours (${rangeText(d.studio.ranges)})</option><option value="closed" ${mode(d.studio.override) === 'off' ? 'selected' : ''}>Closed all day</option><option value="custom" ${mode(d.studio.override) === 'custom' ? 'selected' : ''}>Special hours</option></select>${rangeInputs(d.studio.override, d.studio.ranges)}<button class="btn sm" data-act="saveDay" data-date="${date}" data-scope="studio">Save</button></div></div>
      <div class="card flat"><h3 style="margin-bottom:8px">Beauticians</h3>${d.staff.map((s) => `<div class="row wrap" style="margin-bottom:8px" data-scope="${s.id}"><b style="min-width:120px">${esc(s.name)}</b><select class="md" style="width:auto"><option value="default" ${mode(s.override) === 'default' ? 'selected' : ''}>Regular (${rangeText(s.ranges)})</option><option value="off" ${mode(s.override) === 'off' ? 'selected' : ''}>Day off</option><option value="custom" ${mode(s.override) === 'custom' ? 'selected' : ''}>Special hours</option></select>${rangeInputs(s.override, s.ranges)}<button class="btn sm" data-act="saveDay" data-date="${date}" data-scope="${s.id}">Save</button></div>`).join('') || '<p class="muted">No beauticians yet.</p>'}<p class="hint">Beautician hours only apply inside the studio's open hours.</p></div>
      <div class="card flat"><div class="row between"><h3>Appointments (${d.bookings.length})</h3><button class="btn sm ghost" data-act="newBooking">＋ New</button></div>${d.bookings.length ? d.staff.concat([{ id: '', name: 'Unassigned' }]).map((s) => { const l = d.bookings.filter((b) => (b.beauticianId || '') === s.id); return l.length ? `<div class="tl"><b>${esc(s.name)}</b>${l.map((b) => `<div class="row between" style="padding:5px 0"><span>${FB.time(b.start)}-${FB.time(b.end)} · ${esc(b.serviceName)} · ${esc(b.customerName)} ${b.mode === 'home' ? '🚗' : ''} ${statusBadge(b.status)}</span><button class="ibtn" data-act="manageBkDay" data-id="${b.id}">Manage</button></div>`).join('')}</div>` : ''; }).join('') : '<p class="muted">No appointments on this day.</p>'}</div></div>`, { wide: true, onClose: () => { S.dayOpen = null; } });
    m.el.querySelectorAll('div[data-scope]').forEach((row) => { const sel = row.querySelector('.md'), cu = row.querySelector('.custom'); const upd = () => cu.classList.toggle('hide', sel.value !== 'custom'); sel.onchange = upd; upd(); });
    A._dm = m;
  };
  A.manageBkDay = (el) => { const b = S.dayBks.find((x) => x.id === el.dataset.id); A._dm.close(); bookingModal(b); };
  A.saveDay = async (el) => {
    const row = el.closest('[data-scope]'), scope = el.dataset.scope, mode = row.querySelector('.md').value, date = el.dataset.date;
    const body = { date, mode, ranges: [{ s: row.querySelector('.cs').value, e: row.querySelector('.ce').value }] };
    await FB.put(scope === 'studio' ? '/api/admin/studio-day' : `/api/admin/staff/${scope}/day`, body);
    FB.toast('Saved', 'ok'); await loadStaff(); A._dm.close(); A.openDay({ dataset: { date } }); if (S.page === 'calendar') pgCalendar();
  };

  // ------------------------------------------------------------------ services
  async function pgServices() {
    await loadServices();
    main().innerHTML = `<div class="pg-h"><div><h1>Services</h1><div class="muted">Single treatments customers can buy. Set price before/after, duration and where it can be done.</div></div><button class="btn" data-act="editService">＋ Add service</button></div>
      ${tbl(['', 'Service', 'Price', 'Time', 'Where', 'Status', ''], S.services.map((s) => `<tr><td style="width:60px">${s.images[0] ? `<img src="${esc(s.images[0])}" class="rcpt" style="width:52px;height:52px">` : `<div class="rcpt ph" style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:22px">${FB.icon(s.category, s.name)}</div>`}</td><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.category)}</span></td><td>${s.priceBefore ? `<span class="strike">${money(s.priceBefore)}</span>` : ''}<b>${money(s.priceAfter)}</b></td><td>${FB.dur(s.durationMin)}<br><span class="muted tiny">+${s.gapMin} min gap</span></td><td class="small">${s.studioAllowed ? '🏠 Studio<br>' : ''}${s.homeAllowed ? '🚗 Home' : ''}</td><td>${s.active ? '<span class="badge ok">Active</span>' : '<span class="badge grey">Hidden</span>'}</td><td><button class="ibtn" data-act="editService" data-id="${s.id}">Edit</button></td></tr>`), 'No services yet.')}`;
  }
  A.editService = (el) => {
    const s = S.services.find((x) => x.id === el.dataset.id) || { name: '', category: '', description: '', images: [], priceBefore: '', priceAfter: '', durationMin: 60, gapMin: 15, studioAllowed: true, homeAllowed: true, validityDays: 0, active: true };
    const imgs = [...s.images], cats = [...new Set(S.services.map((x) => x.category))];
    const m = FB.modal(s.id ? 'Edit service' : 'Add service', `<form id="sf">${F.text('name', 'Service name', s.name, { req: true })}<div class="field"><label class="f">Category</label><input type="text" name="category" list="cats" value="${esc(s.category)}" placeholder="e.g. Lash Extensions"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>${F.area('description', 'Description', s.description)}
      <div class="field"><label class="f">Photos</label><div id="imgs"></div></div>
      <div class="grid2 stackm">${F.text('priceBefore', 'Price before (RM, optional)', s.priceBefore, { type: 'number', attrs: 'step="0.01" min="0"', hint: 'Shown crossed out when higher than the price after.' })}${F.text('priceAfter', 'Price after / selling price (RM)', s.priceAfter, { type: 'number', req: true, attrs: 'step="0.01" min="0"' })}</div>
      <div class="grid2 stackm">${F.text('durationMin', 'Whole session takes (minutes)', s.durationMin, { type: 'number', req: true, attrs: 'min="5" step="5"', hint: 'Used to block the beautician\'s time.' })}${F.text('gapMin', 'Gap after session (minutes)', s.gapMin, { type: 'number', attrs: 'min="0" step="5"', hint: 'Clean-up / rest time before the next booking.' })}</div>
      <div class="grid2 stackm">${F.check('studioAllowed', 'Can be done at the studio', s.studioAllowed)}${F.check('homeAllowed', 'Can be done as home service', s.homeAllowed)}</div>
      ${F.text('validityDays', 'Validity after purchase (days, optional)', s.validityDays, { type: 'number', attrs: 'min="0"', hint: '0 = no expiry. Packages have their own validity.' })}${F.check('active', 'Visible to customers', s.active)}
      <div class="row between"><div>${s.id ? '<button type="button" class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-act="delItem" data-coll="services" data-id="' + s.id + '">Delete</button>' : ''}</div><button class="btn">Save service</button></div></form>`, { wide: true });
    imageField(m.el.querySelector('#imgs'), imgs);
    m.el.querySelector('#sf').onsubmit = async (e) => { e.preventDefault(); try { const b = { ...collect(e.target), images: imgs }; await (s.id ? FB.put('/api/admin/services/' + s.id, b) : FB.post('/api/admin/services', b)); m.close(); FB.toast('Saved', 'ok'); refresh(); } catch (x) { FB.err(x); } };
    A._m = m;
  };
  A.delItem = async (el) => {
    if (!(await FB.confirm('Delete this item? If it has been purchased before, it will be hidden instead.', 'Delete', true))) return;
    const r = await FB.del(`/api/admin/${el.dataset.coll}/${el.dataset.id}`);
    A._m && A._m.close(); FB.toast(r.archived ? 'It has history, so it was hidden instead' : 'Deleted', 'ok'); refresh();
  };

  // ------------------------------------------------------------------ packages
  async function pgPackages() {
    await loadServices();
    const { items } = await FB.get('/api/admin/packages');
    S.packages = items;
    const sn = (id) => (S.services.find((s) => s.id === id) || {}).name || '?';
    main().innerHTML = `<div class="pg-h"><div><h1>Packages</h1><div class="muted">Bundles of sessions. Validity starts counting from the customer's purchase date.</div></div><button class="btn" data-act="editPackage">＋ Add package</button></div>
      ${tbl(['', 'Package', 'Includes', 'Price', 'Validity', 'Status', ''], items.map((p) => `<tr><td style="width:60px">${p.images[0] ? `<img src="${esc(p.images[0])}" class="rcpt" style="width:52px;height:52px">` : '<div class="rcpt ph" style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:22px">🎁</div>'}</td><td><b>${esc(p.name)}</b></td><td class="small">${p.unlimited ? '<span class="badge ok">Unlimited</span><br>' : ''}${p.items.map((i) => `${p.unlimited ? '' : i.qty + ' × '}${esc(sn(i.serviceId))}`).join('<br>')}</td><td>${p.priceBefore ? `<span class="strike">${money(p.priceBefore)}</span>` : ''}<b>${money(p.priceAfter)}</b></td><td>${p.validityDays} days</td><td>${p.active ? '<span class="badge ok">Active</span>' : '<span class="badge grey">Hidden</span>'}</td><td><button class="ibtn" data-act="editPackage" data-id="${p.id}">Edit</button></td></tr>`), 'No packages yet.')}`;
  }
  A.editPackage = (el) => {
    const p = (S.packages || []).find((x) => x.id === el.dataset.id) || { name: '', description: '', images: [], priceBefore: '', priceAfter: '', validityDays: 180, items: [{ serviceId: S.services[0] && S.services[0].id, qty: 6 }], unlimited: false, active: true };
    const imgs = [...p.images], items = p.items.map((i) => ({ ...i }));
    const m = FB.modal(p.id ? 'Edit package' : 'Add package', `<form id="pf">${F.text('name', 'Package name', p.name, { req: true })}${F.area('description', 'Description', p.description)}<div class="field"><label class="f">Photos</label><div id="imgs"></div></div>
      <div class="grid2 stackm">${F.text('priceBefore', 'Price before (RM, optional)', p.priceBefore, { type: 'number', attrs: 'step="0.01" min="0"' })}${F.text('priceAfter', 'Package price (RM)', p.priceAfter, { type: 'number', req: true, attrs: 'step="0.01" min="0"' })}</div>
      ${F.text('validityDays', 'Validity (days from purchase date)', p.validityDays, { type: 'number', req: true, attrs: 'min="0"', hint: 'e.g. 180 for 6 months, 365 for 1 year. The countdown starts the day the customer buys.' })}
      ${F.check('unlimited', 'Unlimited sessions during the validity period', p.unlimited, { hint: 'Customer can use any listed service as many times as they like (e.g. the RM988 member package). Session counts below are ignored.' })}
      <div class="field"><label class="f">Services included</label><div id="items"></div><button type="button" class="btn ghost sm" id="addit" style="margin-top:6px">＋ Add service</button></div>${F.check('active', 'Visible to customers', p.active)}
      <div class="row between"><div>${p.id ? '<button type="button" class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-act="delItem" data-coll="packages" data-id="' + p.id + '">Delete</button>' : ''}</div><button class="btn">Save package</button></div></form>`, { wide: true });
    imageField(m.el.querySelector('#imgs'), imgs);
    const box = m.el.querySelector('#items');
    const draw = () => { box.innerHTML = items.map((it, i) => `<div class="row" style="margin-bottom:6px"><select data-i="${i}" class="isel">${S.services.map((s) => `<option value="${s.id}" ${s.id === it.serviceId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><input type="number" min="1" class="iqty" data-i="${i}" value="${it.qty}" style="width:80px" title="Number of sessions"><button type="button" class="ibtn bad" data-x="${i}">✕</button></div>`).join('');
      box.querySelectorAll('.isel').forEach((s) => { s.onchange = () => { items[s.dataset.i].serviceId = s.value; }; }); box.querySelectorAll('.iqty').forEach((s) => { s.oninput = () => { items[s.dataset.i].qty = Number(s.value) || 1; }; }); box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { items.splice(Number(b.dataset.x), 1); draw(); }; }); };
    draw();
    m.el.querySelector('#addit').onclick = () => { items.push({ serviceId: S.services[0].id, qty: 1 }); draw(); };
    m.el.querySelector('#pf').onsubmit = async (e) => { e.preventDefault(); try { const b = { ...collect(e.target), images: imgs, items }; await (p.id ? FB.put('/api/admin/packages/' + p.id, b) : FB.post('/api/admin/packages', b)); m.close(); FB.toast('Saved', 'ok'); refresh(); } catch (x) { FB.err(x); } };
    A._m = m;
  };

  // ------------------------------------------------------------------ flash promotions
  async function pgPromos() {
    await loadServices();
    const [{ items }, pk] = await Promise.all([FB.get('/api/admin/flashes'), FB.get('/api/admin/packages')]);
    S.flashes = items; S.packages = pk.items;
    const state = (f) => (!f.active ? '<span class="badge grey">Off</span>' : f.remainingMs <= 0 ? '<span class="badge grey">Ended</span>' : f.startsInMs > 0 ? '<span class="badge info">Scheduled</span>' : '<span class="badge ok">Running</span>');
    const nm = (f) => (f.targetType === 'none' ? 'Announcement only' : ((f.targetType === 'service' ? S.services : S.packages).find((x) => x.id === f.targetId) || {}).name || '?');
    main().innerHTML = `<div class="pg-h"><div><h1>Flash promotions</h1><div class="muted">Customers see running offers with a countdown when they log in.</div></div><button class="btn" data-act="editPromo">＋ Add promotion</button></div>
      ${tbl(['Promotion', 'Applies to', 'Special price', 'Runs', 'Status', ''], items.map((f) => `<tr><td><b>${esc(f.title)}</b><br><span class="muted small">${esc(f.description)}</span></td><td>${esc(nm(f))}</td><td>${f.flashPrice != null ? money(f.flashPrice) : '-'}</td><td class="small">${FB.dt(f.startAt)}<br>→ ${FB.dt(f.endAt)}</td><td>${state(f)}</td><td><button class="ibtn" data-act="editPromo" data-id="${f.id}">Edit</button></td></tr>`), 'No promotions yet.')}`;
  }
  A.editPromo = (el) => {
    const t = FB.todayMY();
    const f = S.flashes.find((x) => x.id === el.dataset.id) || { title: '', description: '', image: '', startAt: t + 'T00:00', endAt: FB.addDays(t, 3) + 'T23:59', targetType: 'package', targetId: '', flashPrice: '', active: true };
    const img = f.image ? [f.image] : [];
    const m = FB.modal(f.id ? 'Edit promotion' : 'Add flash promotion', `<form id="ff">${F.text('title', 'Title', f.title, { req: true, attrs: 'placeholder="e.g. Weekend Flash Sale"' })}${F.area('description', 'Message', f.description)}<div class="field"><label class="f">Banner photo (optional)</label><div id="imgs"></div></div>
      <div class="grid2 stackm">${F.text('startAt', 'Starts', f.startAt, { type: 'datetime-local', req: true })}${F.text('endAt', 'Ends (countdown target)', f.endAt, { type: 'datetime-local', req: true })}</div>
      <div class="grid2 stackm">${F.select('targetType', 'Offer applies to', [['package', 'A package'], ['service', 'A single service'], ['none', 'Announcement only']], f.targetType)}<div id="tgt"></div></div>${F.text('flashPrice', 'Flash price (RM)', f.flashPrice, { type: 'number', attrs: 'step="0.01" min="0"', hint: 'Replaces the normal price while the promotion is running.' })}${F.check('active', 'Promotion is switched on', f.active)}
      <div class="row between"><div>${f.id ? '<button type="button" class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-act="delItem" data-coll="flashes" data-id="' + f.id + '">Delete</button>' : ''}</div><button class="btn">Save promotion</button></div></form>`, { wide: true });
    imageField(m.el.querySelector('#imgs'), img, 1);
    const form = m.el.querySelector('#ff'), tt = form.querySelector('[name=targetType]'), tgt = m.el.querySelector('#tgt');
    const drawT = () => { const list = tt.value === 'service' ? S.services : tt.value === 'package' ? S.packages : []; tgt.innerHTML = list.length ? `<label class="f">Which one?</label><select name="targetId">${list.map((x) => `<option value="${x.id}" ${x.id === f.targetId ? 'selected' : ''}>${esc(x.name)} (${money(x.priceAfter)})</option>`).join('')}</select>` : ''; form.querySelector('[name=flashPrice]').closest('.field').classList.toggle('hide', !list.length); };
    tt.onchange = drawT; drawT();
    form.onsubmit = async (e) => { e.preventDefault(); try { const b = { ...collect(e.target), image: img[0] || '' }; await (f.id ? FB.put('/api/admin/flashes/' + f.id, b) : FB.post('/api/admin/flashes', b)); m.close(); FB.toast('Saved', 'ok'); refresh(); } catch (x) { FB.err(x); } };
    A._m = m;
  };

  // ------------------------------------------------------------------ vouchers
  async function pgVouchers() {
    const { items } = await FB.get('/api/admin/vouchers');
    S.vouchers = items;
    main().innerHTML = `<div class="pg-h"><div><h1>Vouchers</h1><div class="muted">Create vouchers for everyone or for specific customers. Customers see them under Rewards and pick them at checkout.</div></div><button class="btn" data-act="editVoucher">＋ Add voucher</button></div>
      ${tbl(['Code', 'Offer', 'For', 'Valid', 'Used', 'Status', ''], items.map((v) => `<tr><td><span class="code">${esc(v.code)}</span><br><span class="small">${esc(v.title)}</span></td><td><b>${v.type === 'percent' ? v.value + '%' : money(v.value)} off</b><br><span class="muted tiny">${v.minSpend ? 'min ' + money(v.minSpend) : 'no minimum'}${v.maxDiscount ? ' · max ' + money(v.maxDiscount) : ''}</span></td><td class="small">${v.scope === 'all' ? 'All customers' : v.customerIds.length + ' customer(s)'}<br><span class="muted">${v.appliesTo === 'all' ? 'Any purchase' : v.appliesTo === 'package' ? 'Packages only' : 'Services only'}</span></td><td class="small">${v.startDate ? FB.date(v.startDate) : 'Now'} → ${v.endDate ? FB.date(v.endDate) : 'No expiry'}</td><td>${v.used}${v.totalLimit ? ' / ' + v.totalLimit : ''}</td><td>${v.active ? '<span class="badge ok">On</span>' : '<span class="badge grey">Off</span>'}</td><td><button class="ibtn" data-act="editVoucher" data-id="${v.id}">Edit</button></td></tr>`), 'No vouchers yet.')}`;
  }
  A.editVoucher = async (el) => {
    const { items: custs } = await FB.get('/api/admin/customers');
    const v = S.vouchers.find((x) => x.id === el.dataset.id) || { code: '', title: '', description: '', type: 'amount', value: '', minSpend: 0, maxDiscount: 0, startDate: '', endDate: '', scope: 'all', customerIds: [], appliesTo: 'all', perCustomerLimit: 1, totalLimit: 0, active: true };
    const m = FB.modal(v.id ? 'Edit voucher' : 'Add voucher', `<form id="vf"><div class="grid2 stackm">${F.text('code', 'Voucher code', v.code, { req: true, attrs: 'style="text-transform:uppercase" maxlength="30"', hint: 'Letters and numbers, e.g. WELCOME20' })}${F.text('title', 'Title shown to customer', v.title)}</div>${F.text('description', 'Description', v.description)}
      <div class="grid3 stackm">${F.select('type', 'Discount type', [['amount', 'Fixed amount (RM)'], ['percent', 'Percentage (%)']], v.type)}${F.text('value', 'Value', v.value, { type: 'number', req: true, attrs: 'step="0.01" min="0"' })}${F.text('maxDiscount', 'Max discount RM (for %)', v.maxDiscount, { type: 'number', attrs: 'min="0" step="0.01"', hint: '0 = no cap' })}</div>
      <div class="grid3 stackm">${F.text('minSpend', 'Minimum spend (RM)', v.minSpend, { type: 'number', attrs: 'min="0" step="0.01"' })}${F.text('startDate', 'Valid from', v.startDate, { type: 'date' })}${F.text('endDate', 'Valid until', v.endDate, { type: 'date' })}</div>
      <div class="grid3 stackm">${F.select('appliesTo', 'Applies to', [['all', 'Any purchase'], ['service', 'Single services only'], ['package', 'Packages only']], v.appliesTo)}${F.text('perCustomerLimit', 'Uses per customer', v.perCustomerLimit, { type: 'number', attrs: 'min="0"', hint: '0 = unlimited' })}${F.text('totalLimit', 'Total uses allowed', v.totalLimit, { type: 'number', attrs: 'min="0"', hint: '0 = unlimited' })}</div>
      ${F.select('scope', 'Who can use it', [['all', 'All customers'], ['specific', 'Specific customers only']], v.scope)}<div id="pickbox" class="hide"><input type="search" id="psearch" placeholder="Search customers…" style="margin-bottom:6px"><div class="pick" id="plist"></div><div class="hint" id="pcount"></div></div>
      ${F.check('active', 'Voucher is switched on', v.active)}<div class="row between"><div>${v.id ? '<button type="button" class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-act="delItem" data-coll="vouchers" data-id="' + v.id + '">Delete</button>' : ''}</div><button class="btn">Save voucher</button></div></form>`, { wide: true });
    const form = m.el.querySelector('#vf'), sel = new Set(v.customerIds), list = m.el.querySelector('#plist');
    const drawP = () => { const q = m.el.querySelector('#psearch').value.toLowerCase(); list.innerHTML = custs.filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)).map((c) => `<label><input type="checkbox" data-c="${c.id}" ${sel.has(c.id) ? 'checked' : ''}> ${esc(c.name)} <span class="muted small">${esc(c.phone)}</span></label>`).join('') || '<div class="muted small">No customers found</div>'; list.querySelectorAll('[data-c]').forEach((c) => { c.onchange = () => { c.checked ? sel.add(c.dataset.c) : sel.delete(c.dataset.c); m.el.querySelector('#pcount').textContent = sel.size + ' selected'; }; }); m.el.querySelector('#pcount').textContent = sel.size + ' selected'; };
    const sc = form.querySelector('[name=scope]'); const upd = () => m.el.querySelector('#pickbox').classList.toggle('hide', sc.value !== 'specific'); sc.onchange = upd; upd(); m.el.querySelector('#psearch').oninput = drawP; drawP();
    form.onsubmit = async (e) => { e.preventDefault(); try { const b = { ...collect(e.target), customerIds: [...sel] }; await (v.id ? FB.put('/api/admin/vouchers/' + v.id, b) : FB.post('/api/admin/vouchers', b)); m.close(); FB.toast('Saved', 'ok'); refresh(); } catch (x) { FB.err(x); } };
    A._m = m;
  };

  // ------------------------------------------------------------------ customers
  async function pgCustomers() {
    const q = S.custQ || '';
    const { items } = await FB.get('/api/admin/customers?q=' + encodeURIComponent(q) + (S.custBday ? '&birthday=month' : ''));
    main().innerHTML = `<div class="pg-h"><h1>Customers</h1><button class="btn" data-act="addCustomer">＋ Add customer</button></div><div class="filters"><div class="field"><label class="f">Search</label><input type="search" id="cq" value="${esc(q)}" placeholder="Name, phone or email" style="min-width:260px"></div><span class="chip ${S.custBday ? 'on' : ''}" data-act="bdayFilter">🎂 Birthday this month</span></div>
      ${tbl(['Customer', 'Contact', 'Active packages', 'Points', 'Joined', ''], items.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.birthdayThisMonth ? ' <span class="badge warn">🎂 Birthday month</span>' : ''}${c.active ? '' : ' <span class="badge grey">Disabled</span>'}</td><td>${esc(c.phone)}<br><span class="muted small">${esc(c.email)}</span></td><td>${c.activePackages}</td><td>${pts(c.points)}</td><td class="small">${FB.date(nowDate(c.createdAt))}</td><td><button class="ibtn" data-act="openCustomer" data-id="${c.id}">Open</button></td></tr>`), 'No customers found.')}`;
    const inp = document.getElementById('cq'); let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(() => { S.custQ = inp.value; pgCustomers().then(() => { const n = document.getElementById('cq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 350); };
  }
  const nowDate = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
  A.bdayFilter = () => { S.custBday = !S.custBday; pgCustomers(); };
  A.addCustomer = () => {
    const m = FB.modal('Add customer', `<form id="cf">${F.text('name', 'Name', '', { req: true })}${F.text('phone', 'Contact number', '', { req: true, type: 'tel' })}${F.text('email', 'Email (optional)', '', { type: 'email' })}${F.text('password', 'Password for the customer', '', { req: true, attrs: 'minlength="6"', hint: 'Tell the customer; they can change it after logging in.' })}<button class="btn block">Create customer</button></form>`);
    m.el.querySelector('#cf').onsubmit = async (e) => { e.preventDefault(); try { await FB.post('/api/admin/customers', collect(e.target)); m.close(); FB.toast('Customer added', 'ok'); refresh(); } catch (x) { FB.err(x); } };
  };
  A.openCustomer = async (el) => {
    const id = el.dataset.id, d = await FB.get('/api/admin/customers/' + id), c = d.customer, allCusts = (await FB.get('/api/admin/customers')).items;
    S.cust = d;
    const groups = {};
    d.entitlements.forEach((e) => { (groups[e.unitId] = groups[e.unitId] || []).push(e); });
    const m = FB.modal(c.name, `<div class="stack"><div class="row wrap"><span class="badge">⭐ ${pts(c.points)} points</span><span class="badge info">${c.activePackages} active</span><button class="btn sm ghost" data-act="custSale" data-id="${id}">＋ Manual sale / add package</button><button class="btn sm ghost" data-act="custPoints" data-id="${id}">± Adjust points</button><button class="btn sm gold" data-act="custReward" data-id="${id}">🎁 Give reward</button>${c.birthdayThisMonth ? '<span class="badge warn">🎂 Birthday this month</span>' : ''}<button class="btn sm ghost" data-act="newBooking">＋ Book</button></div>
      <div class="card flat"><h3 style="margin-bottom:8px">Purchased packages & balances</h3>${Object.values(groups).map((g) => `<div style="margin-bottom:10px"><div class="row between"><b>${esc(g[0].title)}</b>${FB.badge(g[0].state)}</div><div class="tiny muted">${esc(g[0].orderNo)} · ${FB.date(g[0].startDate)}${g[0].expiryDate ? ' → valid until ' + FB.date(g[0].expiryDate) : ' · no expiry'}</div>${g.map((e) => `<div class="ent"><span>${esc(e.serviceName)}</span><span>${e.unlimited ? 'Unlimited · ' + e.used + ' used' : `<b>${e.remaining}</b> left of ${e.total} · ${e.used} used`}</span></div>`).join('')}</div>`).join('') || '<p class="muted">Nothing purchased yet.</p>'}</div>
      <div class="card flat"><h3 style="margin-bottom:8px">Orders</h3>${d.orders.map((o) => `<div class="ent"><span><b>${esc(o.no)}</b> · ${FB.date(nowDate(o.createdAt))}<br><span class="small muted">${esc(o.lines.map((l) => l.name).join(', '))}</span></span><span class="right">${money(o.total)}<br>${statusBadge(o.status)}</span></div>`).join('') || '<p class="muted">No orders.</p>'}</div>
      <div class="card flat"><h3 style="margin-bottom:8px">Appointments</h3>${d.bookings.map((b) => `<div class="ent"><span>${FB.date(b.date)} ${FB.time(b.start)} · ${esc(b.serviceName)}<br><span class="small muted">${b.mode === 'home' ? '🚗 Home' : '🏠 Studio'} · ${esc(b.beauticianName)}</span></span>${statusBadge(b.status)}</div>`).join('') || '<p class="muted">No appointments.</p>'}</div>
      <div class="card flat"><h3 style="margin-bottom:8px">Rewards given (birthday / referral)</h3>${c.referrals ? `<p class="small">Referred <b>${c.referrals}</b> customer(s).</p>` : ''}${c.rewards.map((r) => `<div class="ent"><span><b>${esc(r.reason)}</b> · ${esc(r.title)}</span><span class="muted small">${FB.stamp(r.at)}</span></div>`).join('') || '<p class="muted">No rewards given yet.</p>'}</div>
      <div class="card flat"><h3 style="margin-bottom:8px">Customer details</h3><form id="cf">${F.text('name', 'Name', c.name, { req: true })}<div class="grid2 stackm">${F.text('phone', 'Contact number', c.phone, { req: true })}${F.text('email', 'Email', c.email)}</div><div class="grid2 stackm">${F.text('birthday', 'Birthday', c.birthday, { type: 'date' })}${F.select('referredBy', 'Referred by', [['', '— nobody —'], ...allCusts.filter((x) => x.id !== id).map((x) => [x.id, `${x.name} · ${x.phone}`])], c.referredBy)}</div>${F.area('address', 'Address', c.address)}${F.text('area', 'Area', c.area)}${F.text('password', 'Reset password (leave blank to keep)', '', { attrs: 'minlength="6" autocomplete="new-password"' })}${F.check('active', 'Account is active', c.active)}<button class="btn">Save details</button></form></div></div>`, { wide: true });
    m.el.querySelector('#cf').onsubmit = async (e) => { e.preventDefault(); try { await FB.put('/api/admin/customers/' + id, collect(e.target)); FB.toast('Saved', 'ok'); } catch (x) { FB.err(x); } };
    A._cm = m;
  };
  A.custPoints = async (el) => {
    const v = await FB.prompt('Adjust points', 'Points to add (use a minus sign to deduct), e.g. 5 or -2', 'Next'); if (v === null) return;
    const note = await FB.prompt('Reason', 'Reason / note (shown in the customer\'s history)', 'Apply'); if (note === null) return;
    await FB.post(`/api/admin/customers/${el.dataset.id}/points`, { delta: v, note }); FB.toast('Points updated', 'ok'); A._cm.close(); A.openCustomer({ dataset: { id: el.dataset.id } });
  };
  A.custReward = async (el) => {
    await loadServices(); const pk = (await FB.get('/api/admin/packages')).items.filter((p) => p.active);
    const opts = [...S.services.filter((s) => s.active).map((s) => [`service:${s.id}`, `Service - ${s.name}`]), ...pk.map((p) => [`package:${p.id}`, `Package - ${p.name}`])];
    const m = FB.modal('Give reward', `<form id="rw"><p class="muted small">Rewards are private to this customer and show up in their app (voucher under Rewards, free session in My Wallet, points in their balance). They are also emailed if email alerts are on.</p>
      ${F.select('reason', 'Occasion', [['Birthday', 'Birthday'], ['Referral', 'Referral'], ['Other', 'Other']], 'Birthday')}${F.select('kind', 'Reward type', [['voucher', 'Voucher (RM or % off)'], ['points', 'Bonus points'], ['session', 'Free session / package']], 'voucher')}${F.text('title', 'Label shown to customer (optional)', '', { attrs: 'placeholder="e.g. Birthday free lash"' })}
      <div data-k="voucher"><div class="grid3 stackm">${F.select('type', 'Discount type', [['amount', 'Fixed RM'], ['percent', 'Percent %']], 'amount')}${F.text('value', 'Value', 30, { type: 'number', attrs: 'step="0.01" min="0"' })}${F.text('endDate', 'Valid until', FB.addDays(FB.todayMY(), 30), { type: 'date' })}</div>${F.text('minSpend', 'Minimum spend (RM, optional)', 0, { type: 'number', attrs: 'min="0"' })}</div>
      <div data-k="points" class="hide">${F.text('points', 'Points to give', 1, { type: 'number', attrs: 'step="0.01" min="0"' })}</div>
      <div data-k="session" class="hide">${F.select('item', 'Free item', opts, '')}${F.text('expiryDate', 'Use before (optional)', FB.addDays(FB.todayMY(), 30), { type: 'date', hint: 'Leave blank to use the item\'s normal validity.' })}</div>
      <button class="btn block">Give reward</button></form>`);
    const f = m.el.querySelector('#rw'), sync = () => f.querySelectorAll('[data-k]').forEach((d) => d.classList.toggle('hide', d.dataset.k !== f.kind.value)); f.kind.onchange = sync;
    f.onsubmit = async (e) => { e.preventDefault(); try { await FB.post(`/api/admin/customers/${el.dataset.id}/reward`, collect(f)); m.close(); FB.toast('Reward given', 'ok'); A._cm.close(); A.openCustomer({ dataset: { id: el.dataset.id } }); } catch (x) { FB.err(x); } };
  };
  A.custSale = async (el) => {
    await loadServices(); const pk = (await FB.get('/api/admin/packages')).items.filter((p) => p.active);
    const opts = [...pk.map((p) => [`package:${p.id}`, `Package - ${p.name} (${money(p.priceAfter)})`]), ...S.services.filter((s) => s.active).map((s) => [`service:${s.id}`, `Service - ${s.name} (${money(s.priceAfter)})`])];
    const m = FB.modal('Manual sale', `<form id="ms"><p class="muted small">Use this for walk-in purchases or to add packages a customer already bought before the app. Validity counts from the start date below.</p>${F.select('item', 'What did they buy?', opts, '')}<div class="grid2 stackm">${F.text('qty', 'Quantity', 1, { type: 'number', attrs: 'min="1" max="20"' })}${F.text('startDate', 'Purchase / start date', FB.todayMY(), { type: 'date' })}</div>${F.text('priceOverride', 'Agreed total price (RM, optional)', '', { type: 'number', attrs: 'step="0.01" min="0"', hint: 'Leave blank to use the normal price.' })}${F.check('markPaid', 'Payment already received', true)}${F.select('method', 'Payment method', [['cash', 'Cash'], ['bank_in', 'Bank transfer'], ['card', 'Card'], ['ewallet', 'E-wallet']], 'cash')}<button class="btn block">Record sale</button></form>`);
    m.el.querySelector('#ms').onsubmit = async (e) => { e.preventDefault(); const v = collect(e.target); const [type, id] = v.item.split(':'); try { await FB.post('/api/admin/orders', { customerId: el.dataset.id, lines: [{ type, id, qty: Number(v.qty) || 1 }], startDate: v.startDate, priceOverride: v.priceOverride, markPaid: v.markPaid, method: v.method }); m.close(); FB.toast('Sale recorded', 'ok'); A._cm.close(); A.openCustomer({ dataset: { id: el.dataset.id } }); } catch (x) { FB.err(x); } };
  };

  // ------------------------------------------------------------------ orders & payments
  async function pgPayments() {
    const tab = S.payTab || 'review';
    const [pend, ord] = await Promise.all([FB.get('/api/admin/payments?status=pending'), tab === 'orders' ? FB.get('/api/admin/orders') : null]);
    let body = '';
    if (tab === 'review') body = pend.items.length ? `<div class="stack">${pend.items.map((p) => `<div class="card row wrap">${p.receipt ? `<a href="${p.receipt}?t=${token()}" target="_blank" rel="noopener"><img class="rcpt" style="width:90px;height:90px" src="${p.receipt}?t=${token()}" alt="Receipt"></a>` : ''}<div class="grow"><b>${esc(p.customerName)}</b> <span class="muted small">${esc(p.customerPhone)}</span><div>${p.kind === 'order' ? 'Order' : 'Home fee for booking'} <b>${esc(p.refNo)}</b> · total ${money(p.refTotal)}</div><div class="small muted">${FB.stamp(p.createdAt)}${p.note ? ' · ' + esc(p.note) : ''}</div></div><div class="right"><div style="font-size:20px;font-weight:800;color:var(--brand-dk)">${money(p.amount)}</div><div class="row" style="margin-top:6px;justify-content:flex-end"><button class="ibtn ok" data-act="payDo" data-do="confirm" data-id="${p.id}">✔ Confirm</button><button class="ibtn bad" data-act="payDo" data-do="reject" data-id="${p.id}">Reject</button></div></div></div>`).join('')}</div>` : '<div class="card empty">🎉 No receipts waiting for verification.</div>';
    else body = tbl(['Order', 'Customer', 'Items', 'Total', 'Paid', 'Status', ''], ord.items.map((o) => `<tr><td><b>${esc(o.no)}</b><br><span class="muted tiny">${FB.date(nowDate(o.createdAt))}${o.source === 'manual' ? ' · manual' : ''}</span></td><td>${esc(o.customerName)}<br><span class="muted small">${esc(o.customerPhone)}</span></td><td class="small">${esc(o.lines.map((l) => l.name + (l.qty > 1 ? ' ×' + l.qty : '')).join(', '))}</td><td>${money(o.total)}${o.voucherCode ? `<br><span class="tiny muted">voucher ${esc(o.voucherCode)}</span>` : ''}</td><td>${money(o.confirmedPaid)}${o.pendingPaid ? `<br><span class="tiny">${money(o.pendingPaid)} to verify</span>` : ''}</td><td>${statusBadge(o.status)}</td><td>${o.status === 'pending_payment' ? `<button class="ibtn ok" data-act="orderPay" data-id="${o.id}" data-bal="${o.balance}">Record payment</button> ` : ''}${o.status !== 'cancelled' ? `<button class="ibtn bad" data-act="orderCancel" data-id="${o.id}">Cancel</button>` : ''}</td></tr>`), 'No orders yet.');
    main().innerHTML = `<div class="pg-h"><h1>Orders & payments</h1></div><div class="tabs"><span class="chip ${tab === 'review' ? 'on' : ''}" data-act="payTab" data-v="review">Receipts to verify (${pend.items.length})</span><span class="chip ${tab === 'orders' ? 'on' : ''}" data-act="payTab" data-v="orders">All orders</span></div>${body}
      <p class="hint" style="margin-top:12px">Confirming a receipt marks the order as paid once the full amount is received. The customer then earns points and can book package sessions.</p>`;
  }
  A.payTab = (el) => { S.payTab = el.dataset.v; pgPayments(); };
  A.payDo = async (el) => {
    const body = { action: el.dataset.do };
    if (body.action === 'reject') { const r = await FB.prompt('Reject receipt', 'Reason (shown to customer)', 'Reject'); if (r === null) return; body.reason = r; }
    await FB.post('/api/admin/payments/' + el.dataset.id, body); FB.toast(body.action === 'confirm' ? 'Payment confirmed' : 'Receipt rejected', 'ok'); pgPayments();
  };
  A.orderPay = async (el) => {
    const amt = await FB.prompt('Record payment received', `Amount received (RM). Balance is ${money(el.dataset.bal)}`, 'Record'); if (amt === null) return;
    await FB.post(`/api/admin/orders/${el.dataset.id}/payments`, { amount: amt, method: 'cash' }); FB.toast('Payment recorded', 'ok'); pgPayments();
  };
  A.orderCancel = async (el) => { if (!(await FB.confirm('Cancel this order? Unused sessions are voided, points are returned and upcoming bookings are cancelled.', 'Cancel order', true))) return; await FB.post(`/api/admin/orders/${el.dataset.id}/cancel`); FB.toast('Order cancelled', 'ok'); pgPayments(); };

  // ------------------------------------------------------------------ beauticians
  async function pgStaff() {
    await Promise.all([loadServices(), loadStaff()]);
    const sn = (id) => (S.services.find((s) => s.id === id) || {}).name;
    main().innerHTML = `<div class="pg-h"><div><h1>Beauticians</h1><div class="muted">Set each person's skills and working hours. Bookings are only assigned to qualified, free beauticians.</div></div><button class="btn" data-act="editStaff">＋ Add beautician</button></div>
      ${tbl(['Beautician', 'Login', 'Skills', 'Weekly hours', 'Status', ''], S.staff.map((b) => `<tr><td><b>${esc(b.name)}</b></td><td class="small">${esc(b.phone)}<br>${esc(b.email)}</td><td class="small">${b.skills.length} treatment(s)<br><span class="muted tiny">${esc(b.skills.slice(0, 3).map(sn).join(', '))}${b.skills.length > 3 ? '…' : ''}</span></td><td class="small">${[1, 2, 3, 4, 5, 6, 0].filter((d) => (b.weekly[d] || []).length).map((d) => DN[d]).join(' ') || 'No hours set'}</td><td>${b.active ? '<span class="badge ok">Active</span>' : '<span class="badge grey">Inactive</span>'}</td><td><button class="ibtn" data-act="editStaff" data-id="${b.id}">Edit</button></td></tr>`), 'No beauticians yet. Add one so customers can book.')}`;
  }
  A.editStaff = (el) => {
    const b = S.staff.find((x) => x.id === el.dataset.id) || { name: '', phone: '', email: '', skills: [], weekly: { 0: [], 1: [{ s: '10:00', e: '19:00' }], 2: [{ s: '10:00', e: '19:00' }], 3: [{ s: '10:00', e: '19:00' }], 4: [{ s: '10:00', e: '19:00' }], 5: [{ s: '10:00', e: '19:00' }], 6: [{ s: '10:00', e: '19:00' }] }, active: true };
    const cats = {}; S.services.forEach((s) => { (cats[s.category] = cats[s.category] || []).push(s); });
    const m = FB.modal(b.id ? 'Edit beautician' : 'Add beautician', `<form id="bf">${F.text('name', 'Name', b.name, { req: true })}<div class="grid2 stackm">${F.text('phone', 'Contact number (login)', b.phone, { req: true, type: 'tel' })}${F.text('email', 'Email (optional login)', b.email, { type: 'email' })}</div>${F.text('password', b.id ? 'Reset password (leave blank to keep)' : 'Password', '', { req: !b.id, attrs: 'minlength="6" autocomplete="new-password"' })}${F.check('active', 'Active (can receive bookings)', b.active)}
      <div class="field"><label class="f">Skills - treatments this beautician can do</label>${Object.entries(cats).map(([c, list]) => `<div class="skillbox"><b>${esc(c)}</b> <button type="button" class="link small" data-all="${esc(c)}">select all</button><br>${list.map((s) => `<label><input type="checkbox" class="sk" value="${s.id}" data-cat="${esc(c)}" ${b.skills.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div>`).join('')}</div>
      <div class="field"><label class="f">Regular weekly working hours</label><div id="wk">${hoursHtml(b.weekly)}</div></div><div class="row between"><div>${b.id ? '<button type="button" class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-act="delStaff" data-id="' + b.id + '">Delete</button>' : ''}</div><button class="btn">Save beautician</button></div></form>`, { wide: true });
    m.el.querySelectorAll('[data-all]').forEach((a) => { a.onclick = () => { const boxes = m.el.querySelectorAll(`.sk[data-cat="${a.dataset.all}"]`); const on = [...boxes].some((x) => !x.checked); boxes.forEach((x) => { x.checked = on; }); }; });
    m.el.querySelector('#bf').onsubmit = async (e) => { e.preventDefault(); try { const body = { ...collect(e.target), skills: [...m.el.querySelectorAll('.sk:checked')].map((x) => x.value), weekly: readHours(m.el.querySelector('#wk')) }; await (b.id ? FB.put('/api/admin/staff/' + b.id, body) : FB.post('/api/admin/staff', body)); m.close(); FB.toast('Saved', 'ok'); refresh(); } catch (x) { FB.err(x); } };
    A._m = m;
  };
  A.delStaff = async (el) => { if (!(await FB.confirm('Delete this beautician? If they have booking history they will be set inactive instead.', 'Delete', true))) return; const r = await FB.del('/api/admin/staff/' + el.dataset.id); A._m.close(); FB.toast(r.archived ? 'Set to inactive (has history)' : 'Deleted', 'ok'); refresh(); };

  // ------------------------------------------------------------------ settings
  async function pgSettings() {
    const { settings: s } = await FB.get('/api/admin/settings');
    main().innerHTML = `<div class="pg-h"><h1>Settings</h1></div><form id="sf" class="stack" style="max-width:860px">
      <div class="card"><h3>Studio details</h3><div class="grid2 stackm" style="margin-top:10px">${F.text('studioName', 'Studio name', s.studioName)}${F.text('phone', 'Phone', s.phone)}</div>${F.text('address', 'Studio address', s.address)}${F.text('whatsapp', 'WhatsApp number (with country code)', s.whatsapp, { hint: 'e.g. 60182530288' })}</div>
      <div class="card"><h3>Where customers can be served</h3><div style="margin-top:10px">${F.check('studioEnabled', 'Customers can visit the studio', s.studioEnabled)}${F.check('homeEnabled', 'Offer home service', s.homeEnabled)}<div class="grid2 stackm">${F.text('homeFee', 'Home service extra charge per visit (RM)', s.homeFee, { type: 'number', attrs: 'step="0.01" min="0"' })}${F.text('homeTravelMin', 'Travel time blocked before & after a home visit (minutes)', s.homeTravelMin, { type: 'number', attrs: 'min="0"' })}</div>${F.area('homeAreas', 'Areas covered for home service (one per line)', s.homeAreas.join('\n'), { attrs: 'rows="6"', hint: 'Customers choose their area from this list. Home service also needs to be allowed on each service.' })}</div></div>
      <div class="card"><h3>Studio opening hours (regular week)</h3><div id="wk" style="margin-top:10px">${hoursHtml(s.studioWeekly)}</div><p class="hint">For public holidays or special days, use the Calendar page.</p></div>
      <div class="card"><h3>Booking rules</h3><div class="grid3 stackm" style="margin-top:10px">${F.select('slotStepMin', 'Time slot interval', [[15, 'Every 15 min'], [30, 'Every 30 min'], [60, 'Every 60 min']], s.slotStepMin)}${F.text('minLeadHours', 'Minimum notice (hours)', s.minLeadHours, { type: 'number', attrs: 'min="0"' })}${F.text('maxAdvanceDays', 'Customers can book up to (days ahead)', s.maxAdvanceDays, { type: 'number', attrs: 'min="1"' })}</div>${F.text('cancelHours', 'Customers may cancel a confirmed booking up to (hours before)', s.cancelHours, { type: 'number', attrs: 'min="0"' })}</div>
      <div class="card"><h3>Payment & deposit</h3><div style="margin-top:10px">${F.text('depositPercent', 'Deposit required before sessions can be used (%)', s.depositPercent, { type: 'number', attrs: 'min="0" max="100"', hint: '0 = no deposit (full payment must be confirmed). Set 50 to collect a 50% deposit first.' })}<div class="grid2 stackm">${F.text('bank.bankName', 'Bank name', s.bank.bankName)}${F.text('bank.accountNo', 'Account number', s.bank.accountNo)}</div>${F.text('bank.accountName', 'Account name', s.bank.accountName)}${F.area('bank.instructions', 'Payment instructions shown to customers', s.bank.instructions)}</div></div>
      <div class="card"><h3>Email alerts & password reset</h3><p class="muted small" style="margin:6px 0 10px">Free option: use a Gmail address with an <b>App Password</b> (Google Account → Security → 2-Step Verification → App passwords). Port 465. Other free SMTP services (Brevo, Zoho) also work.</p>
        ${F.text('ownerEmail', 'Your (owner) email - receives alerts, and is your reset-password email', s.ownerEmail, { type: 'email' })}${F.check('emailEnabled', 'Send email alerts (new bookings, receipts) and emails to customers (confirmations, reset codes)', s.emailEnabled)}
        <div class="grid2 stackm">${F.text('smtp.host', 'Email server (SMTP host)', s.smtp.host)}${F.text('smtp.port', 'Port', s.smtp.port, { type: 'number' })}</div><div class="grid2 stackm">${F.text('smtp.user', 'Email account (login)', s.smtp.user)}${F.text('smtp.pass', 'App password', '', { type: 'password', attrs: 'autocomplete="new-password" placeholder="' + (s.smtp.passSet ? '•••••• saved (leave blank to keep)' : '') + '"' })}</div>
        <div class="grid2 stackm">${F.text('smtp.fromName', 'Sender name', s.smtp.fromName)}${F.text('smtp.fromEmail', 'Sender email (blank = same as login)', s.smtp.fromEmail)}</div>
        <div class="row wrap"><button type="button" class="btn ghost sm" data-act="testEmail">Send test email to me</button><button type="button" class="btn ghost sm" data-act="mailLog">View recent emails</button></div><p class="hint">Save settings first, then send the test. Passwords are stored on your server only.</p></div>
      <div class="card"><h3>Rewards</h3><div class="grid3 stackm" style="margin-top:10px">${F.text('pointsEarnPerRM', 'Spend RM … to earn 1 point', s.pointsEarnPerRM, { type: 'number', attrs: 'min="1"' })}${F.text('pointValueRM', '1 point is worth RM', s.pointValueRM, { type: 'number', attrs: 'step="0.01" min="0"' })}${F.text('gamePoints', 'Points per mini-game (once a day)', s.gamePoints, { type: 'number', attrs: 'step="0.01" min="0"' })}</div></div>
      <div><button class="btn">Save settings</button></div></form>
      <form id="pw" class="card" style="max-width:860px;margin-top:20px"><h3>Change my password</h3><div class="grid2 stackm" style="margin-top:10px">${F.text('current', 'Current password', '', { type: 'password', req: true })}${F.text('password', 'New password', '', { type: 'password', req: true, attrs: 'minlength="6"' })}</div><button class="btn ghost">Update password</button></form>`;
    document.getElementById('sf').onsubmit = async (e) => {
      e.preventDefault(); const v = collect(e.target); const body = { ...v, smtp: { host: v['smtp.host'], port: v['smtp.port'], user: v['smtp.user'], pass: v['smtp.pass'], fromName: v['smtp.fromName'], fromEmail: v['smtp.fromEmail'] }, bank: { bankName: v['bank.bankName'], accountNo: v['bank.accountNo'], accountName: v['bank.accountName'], instructions: v['bank.instructions'] }, studioWeekly: readHours(document.getElementById('wk')) };
      try { await FB.put('/api/admin/settings', body); FB.toast('Settings saved', 'ok'); } catch (x) { FB.err(x); }
    };
    document.getElementById('pw').onsubmit = async (e) => { e.preventDefault(); try { await FB.post('/api/admin/owner-password', collect(e.target)); e.target.reset(); FB.toast('Password updated', 'ok'); } catch (x) { FB.err(x); } };
  }

  A.testEmail = async () => { const r = await FB.post('/api/admin/test-email'); FB.toast('Test email sent to ' + r.to, 'ok'); };
  A.mailLog = async () => { const { items } = await FB.get('/api/admin/mail-log'); FB.modal('Recent emails', items.length ? `<div class="logbox" style="background:#fff;border:1px solid var(--line);border-radius:14px">${items.map((m) => `<div class="ent" style="padding:8px 12px"><span>${esc(m.subject)}<br><span class="tiny muted">${esc(m.to)} · ${FB.stamp(m.at)}</span></span>${m.ok ? '<span class="badge ok">Sent</span>' : `<span class="badge bad" title="${esc(m.error)}">Failed</span>`}</div>${m.ok ? '' : `<div class="tiny" style="color:var(--bad);padding:0 12px 6px">${esc(m.error)}</div>`}`).join('')}</div>` : '<p class="muted">No emails sent yet.</p>'); };

  // ------------------------------------------------------------------ beautician schedule
  async function pgSchedule() {
    const from = FB.todayMY(), to = FB.addDays(from, 30);
    const [{ bookings }, me] = await Promise.all([FB.get(`/api/staff/bookings?from=${from}&to=${to}`), FB.get('/api/staff/me')]);
    const byDate = {}; bookings.forEach((b) => { (byDate[b.date] = byDate[b.date] || []).push(b); });
    main().innerHTML = `<div class="pg-h"><div><h1>My schedule</h1><div class="muted">Hello ${esc(me.user.name)} · next 30 days</div></div></div>
      <div class="card" style="margin-bottom:16px"><h3 style="margin-bottom:6px">My working hours (next 14 days)</h3><div class="row wrap small">${me.days.map((d) => `<span class="badge ${d.ranges.length ? '' : 'grey'}">${FB.dow(d.date)} ${Number(d.date.slice(8))}: ${rangeText(d.ranges)}</span>`).join('')}</div><div class="small muted" style="margin-top:8px">My skills: ${esc(me.skills.join(', ') || '-')}</div></div>
      ${Object.keys(byDate).length ? Object.entries(byDate).map(([date, list]) => `<h2 style="margin:16px 0 8px">${FB.dateLong(date)}${date === from ? ' · Today' : ''}</h2><div class="stack">${list.map((b) => `<div class="card"><div class="row between"><div><b style="font-size:17px">${FB.time(b.start)} - ${FB.time(b.end)}</b> · ${esc(b.serviceName)}</div>${statusBadge(b.status)}</div><div style="margin-top:6px">👤 ${esc(b.contact.name)} · <a href="tel:${esc(b.contact.phone)}">${esc(b.contact.phone)}</a></div><div class="small">${b.mode === 'home' ? `🚗 <b>Home service</b>: ${esc(b.contact.address)}, ${esc(b.contact.area)} · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.contact.address + ' ' + b.contact.area)}">Open map</a>` : '🏠 At the studio'}</div><div class="tiny muted">Package: ${esc(b.title)}</div>${b.status === 'confirmed' ? `<button class="btn ok sm" style="margin-top:10px" data-act="staffDone" data-id="${b.id}">✅ Mark treatment completed</button>` : b.status === 'pending' ? '<div class="tiny muted" style="margin-top:6px">Waiting for owner approval</div>' : ''}</div>`).join('')}</div>`).join('') : '<div class="card empty">No appointments assigned to you in the next 30 days.</div>'}`;
  }
  A.staffDone = async (el) => { if (!(await FB.confirm('Mark this treatment as completed? One session will be deducted from the customer.'))) return; await FB.post(`/api/staff/bookings/${el.dataset.id}/complete`); FB.toast('Marked completed', 'ok'); pgSchedule(); };

  // ------------------------------------------------------------------ boot
  if (token()) start(); else showLogin();
})();
