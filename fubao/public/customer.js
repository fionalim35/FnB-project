(function () {
  'use strict';
  const { esc, money, pts } = FB;
  const $app = document.getElementById('app'), $top = document.getElementById('top'), $nav = document.getElementById('nav');
  const S = { pub: null, my: null, cart: [], shop: { tab: 'services', cat: 'All' }, wtab: 'packages', B: null, C: { voucherId: '', points: 0 } };
  try { S.cart = JSON.parse(localStorage.getItem('fb_cart') || '[]'); } catch { S.cart = []; }
  let cleanup = null;
  const A = {};
  const saveCart = () => { try { localStorage.setItem('fb_cart', JSON.stringify(S.cart)); } catch {} };
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
  const token = () => localStorage.getItem(FB.tokenKey);
  const loadPub = async () => { S.pub = await FB.get('/api/public'); };
  const loadMy = async () => { if (token()) S.my = await FB.get('/api/my'); };
  FB.onAuthFail = () => { localStorage.removeItem(FB.tokenKey); S.my = null; go('#/login'); };
  const item = (type, id) => (type === 'package' ? S.pub.packages : S.pub.services).find((x) => x.id === id);
  const svcName = (id) => { const s = S.pub.services.find((x) => x.id === id); return s ? s.name : ''; };
  const needLogin = () => { if (!S.my) { sessionStorage.setItem('fb_next', location.hash); go('#/login'); return true; } return false; };
  const priceHtml = (it) => (it.priceBefore && it.priceBefore > it.price ? `<span class="strike">${money(it.priceBefore)}</span>` : '') + `<span class="price">${money(it.price)}</span>`;
  const modeNote = (s) => [s.studioAllowed !== false && S.pub.studio.studioEnabled ? '🏠 Studio' : '', s.homeAllowed !== false && S.pub.studio.homeEnabled ? `🚗 Home +${money(S.pub.studio.homeFee)}` : ''].filter(Boolean).join(' · ');

  // ------------------------------------------------------------------ chrome
  function chrome(page) {
    const cartN = S.cart.reduce((a, l) => a + l.qty, 0);
    $top.innerHTML = `<a class="brand" href="#/home">Fubao<small>Beauty Centre</small></a><div class="row">${cartN ? `<a class="ptag" href="#/cart">🛒 ${cartN}</a>` : ''}${S.my ? `<a class="ptag" href="#/rewards">⭐ ${pts(S.my.points)}</a><a class="ptag" href="#/profile" aria-label="Profile">👤</a>` : '<a class="btn sm" href="#/login">Log in</a>'}</div>`;
    const nav = [['home', '🏠', 'Home'], ['shop', '💆', 'Services'], ['book', '📅', 'Book'], ['wallet', '👛', 'My Wallet'], ['rewards', '🎁', 'Rewards']];
    $nav.innerHTML = nav.map(([k, i, t]) => `<a href="#/${k}" class="${page === k ? 'on' : ''}"><span>${i}</span>${t}</a>`).join('');
  }

  // ------------------------------------------------------------------ router
  async function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const [pathRaw, qs] = (location.hash.slice(2) || 'home').split('?');
    const parts = pathRaw.split('/');
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    const page = parts[0] || 'home';
    if (!S.pub) { try { await loadPub(); } catch (e) { $app.innerHTML = `<div class="empty">${esc(e.message)}<br><br><button class="btn" onclick="location.reload()">Try again</button></div>`; return; } }
    if (token() && !S.my) { try { await loadMy(); } catch {} }
    const needs = ['wallet', 'book', 'rewards', 'game', 'profile', 'cart', 'order'];
    if (needs.includes(page) && needLogin()) return;
    if (page === 'login' && S.my) return go('#/home');
    chrome(page === 'item' ? 'shop' : page === 'cart' || page === 'order' || page === 'game' ? (page === 'game' ? 'rewards' : 'wallet') : page);
    window.scrollTo(0, 0);
    try {
      const fn = { home: pageHome, shop: pageShop, item: pageItem, cart: pageCart, order: pageOrder, wallet: pageWallet, book: pageBook, rewards: pageRewards, game: pageGame, profile: pageProfile, login: pageLogin }[page] || pageHome;
      await fn(parts.slice(1), q);
    } catch (e) { $app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    FB.tick();
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && A[el.dataset.act]) { e.preventDefault(); Promise.resolve(A[el.dataset.act](el, e)).catch(FB.err); }
  });

  // ------------------------------------------------------------------ home
  function promoCard(f) {
    const t = f.targetType !== 'none' ? item(f.targetType, f.targetId) : null;
    const link = t ? `#/item/${f.targetType}/${t.id}` : '#/shop';
    return `<div class="promo">${f.image ? `<img class="pi" src="${esc(f.image)}" alt="">` : ''}<div class="pb"><span class="tag">⚡ Flash offer</span><h3>${esc(f.title)}</h3><p>${esc(f.description)}</p>
      ${t ? `<div class="pr"><b>${money(f.flashPrice != null ? f.flashPrice : t.price)}</b>${t.priceAfter > (f.flashPrice ?? t.priceAfter) ? `<s>${money(t.priceAfter)}</s>` : ''}<span class="small" style="margin-left:8px;color:#eadbbd">${esc(t.name)}</span></div>` : ''}
      <div class="small" style="color:#cbb88f;margin-bottom:6px">Ends in</div>${FB.cdHtml(f.remainingMs)}
      <div style="margin-top:14px"><a class="btn gold sm" href="${link}">${t ? 'Grab this offer' : 'Shop now'}</a></div></div></div>`;
  }
  function maybeFlashPopup() {
    if (!S.my || !S.pub.flashes.length || sessionStorage.getItem('fb_flash_seen')) return;
    sessionStorage.setItem('fb_flash_seen', '1');
    const m = FB.modal('⚡ Special offers for you', `<div class="stack">${S.pub.flashes.map(promoCard).join('')}</div>`);
    m.el.addEventListener('click', (e) => { if (e.target.closest('a')) m.close(); });
    FB.tick();
  }
  async function pageHome() {
    const p = S.pub, m = S.my, st = p.studio;
    const next = m && m.bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && b.date >= FB.todayMY()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
    const hours = (() => { const w = st.hours || {}; const open = [1, 2, 3, 4, 5, 6, 0].filter((d) => (w[d] || []).length); if (!open.length) return ''; const r = (w[open[0]] || [])[0]; return `${FB.time(r.s)} - ${FB.time(r.e)} (${open.map((d) => FB.DAYS[d]).join(', ')})`; })();
    $app.innerHTML = `
      <div class="hero"><p class="small" style="letter-spacing:2px;text-transform:uppercase;color:#d8bf86">Welcome${m ? ', ' + esc(m.user.name.split(' ')[0]) : ''}</p><h1>Look beautiful,<br>feel beautiful</h1><p>Lash extensions · Embroidery · Skin care · Manicure</p>
        <div class="row wrap" style="margin-top:14px"><a class="btn gold" href="#/book">📅 Book appointment</a><a class="btn ghost" style="color:#f7e2b0;border-color:#b8924a" href="#/shop">View services</a></div></div>
      ${p.flashes.length ? `<div class="sec"><h2 style="margin-bottom:10px">⚡ Flash offers</h2><div class="promos ${p.flashes.length === 1 ? 'one' : ''}">${p.flashes.map(promoCard).join('')}</div></div>` : ''}
      ${m ? `<div class="sec grid3"><a class="stat" href="#/wallet"><b>${m.entitlements.filter((e) => e.state === 'active').length}</b><span>Active purchases</span></a><a class="stat" href="#/rewards"><b>${pts(m.points)}</b><span>Points (RM${pts(m.points * p.studio.pointValueRM)})</span></a><a class="stat" href="#/rewards"><b>${m.vouchers.filter((v) => v.usable).length}</b><span>Vouchers</span></a></div>
        ${next ? `<div class="sec"><h2 style="margin-bottom:10px">Your next appointment</h2><div class="card bk" data-act="bk" data-id="${next.id}"><div class="row between"><div class="t">${esc(next.serviceName)}</div>${FB.badge(next.status)}</div><div class="muted">${FB.dateLong(next.date)} · ${FB.time(next.start)}</div><div class="small muted">${next.mode === 'home' ? '🚗 Home service' : '🏠 At studio'} · ${esc(next.beauticianName)}</div></div></div>` : ''}`
        : `<div class="sec card center"><h3>Welcome to Fubao</h3><p class="muted">Log in to see your packages, book appointments and earn rewards.</p><a class="btn" href="#/login">Log in / Register</a></div>`}
      <div class="sec"><div class="row between"><h2>Popular services</h2><a href="#/shop">See all</a></div><div class="stack">${p.services.slice(0, 4).map(svcCard).join('')}</div></div>
      <div class="sec card"><h3>Visit us</h3><p style="margin-top:6px">📍 ${esc(st.address)}</p>${hours ? `<p>🕒 ${esc(hours)}</p>` : ''}<p>📞 ${esc(st.phone)}</p>
        <div class="linkrow" style="margin-top:8px"><a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(st.address)}">Open map</a>${st.whatsapp ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/${esc(st.whatsapp)}">WhatsApp us</a>` : ''}</div>
        ${st.homeEnabled ? `<p class="small muted" style="margin-top:10px">🚗 Home service available around Klang Valley (${money(st.homeFee)} per visit).</p>` : ''}</div>`;
    maybeFlashPopup();
  }

  // ------------------------------------------------------------------ shop
  function svcCard(s) {
    return `<a class="svc" href="#/item/service/${s.id}">${FB.img(s)}<div class="grow"><h3>${esc(s.name)}</h3><div class="small muted">${FB.dur(s.durationMin)}${s.validityDays ? ` · valid ${s.validityDays} days` : ''}</div><div class="small" style="margin:3px 0">${s.flashId ? '<span class="pill fl">⚡ Flash price</span>' : ''}<span class="small muted">${modeNote(s)}</span></div><div>${priceHtml(s)}</div></div></a>`;
  }
  function pkgCard(p) {
    const sessions = p.unlimited ? 'Unlimited sessions' : p.items.reduce((a, i) => a + i.qty, 0) + (p.items.length > 1 ? ' sessions in total' : ' sessions');
    return `<a class="svc" href="#/item/package/${p.id}">${FB.img({ ...p, category: p.includes[0] ? (S.pub.services.find((s) => s.id === p.includes[0].serviceId) || {}).category : '' })}<div class="grow"><h3>${esc(p.name)}</h3><div class="small muted">${sessions} · valid ${p.validityDays} days</div><div class="small" style="margin:3px 0">${p.flashId ? '<span class="pill fl">⚡ Flash price</span>' : ''}${p.priceBefore > p.price ? `<span class="pill">Save ${money(p.priceBefore - p.price)}</span>` : ''}</div><div>${priceHtml(p)}</div></div></a>`;
  }
  async function pageShop() {
    const p = S.pub, sh = S.shop;
    const cats = ['All', ...p.categories];
    const list = sh.tab === 'services' ? p.services.filter((s) => sh.cat === 'All' || s.category === sh.cat) : p.packages;
    $app.innerHTML = `<h1 style="margin-bottom:12px">Our services</h1><div class="seg"><button class="${sh.tab === 'services' ? 'on' : ''}" data-act="shopTab" data-v="services">Single services</button><button class="${sh.tab === 'packages' ? 'on' : ''}" data-act="shopTab" data-v="packages">Packages</button></div>
      ${sh.tab === 'services' ? `<div class="chips" style="margin-top:12px">${cats.map((c) => `<span class="chip ${sh.cat === c ? 'on' : ''}" data-act="shopCat" data-v="${esc(c)}">${esc(c)}</span>`).join('')}</div>` : '<p class="muted small" style="margin-top:12px">Buy a package to save more. Validity starts on the purchase date.</p>'}
      <div class="stack" style="margin-top:12px">${list.length ? list.map(sh.tab === 'services' ? svcCard : pkgCard).join('') : '<div class="empty">Nothing here yet.</div>'}</div>`;
  }
  A.shopTab = (el) => { S.shop.tab = el.dataset.v; pageShop(); };
  A.shopCat = (el) => { S.shop.cat = el.dataset.v; pageShop(); };

  async function pageItem([type, id]) {
    const it = item(type, id);
    if (!it) { $app.innerHTML = '<div class="empty">This item is no longer available.<br><br><a class="btn" href="#/shop">Back to services</a></div>'; return; }
    const imgs = it.images && it.images.length ? it.images : [];
    const flash = it.flashId ? S.pub.flashes.find((f) => f.id === it.flashId) : null;
    $app.innerHTML = `<a href="#/shop" class="small">← Back</a>
      <div style="margin-top:8px">${imgs.length > 1 ? `<div class="gal">${imgs.map((s) => `<img src="${esc(s)}" alt="">`).join('')}</div>` : FB.img({ ...it, category: type === 'service' ? it.category : '' }, 'thumb')}</div>
      <h1 style="margin-top:14px">${esc(it.name)}</h1>
      ${flash ? `<div class="promo" style="margin:10px 0"><div class="pb"><span class="tag">⚡ Flash price ends in</span><div style="margin-top:8px">${FB.cdHtml(flash.remainingMs)}</div></div></div>` : ''}
      <div style="font-size:22px;margin:6px 0 10px">${priceHtml(it)}</div>
      <p class="muted" style="white-space:pre-line">${esc(it.description)}</p>
      <div class="card flat" style="margin:14px 0">
        ${type === 'service' ? `<div class="kv"><span>Session time</span><b>${FB.dur(it.durationMin)}</b></div><div class="kv"><span>Where</span><b>${modeNote(it) || '-'}</b></div>${it.validityDays ? `<div class="kv"><span>Validity</span><b>${it.validityDays} days from purchase</b></div>` : ''}`
          : `<div class="kv"><span>Validity</span><b>${it.validityDays} days from purchase date</b></div><div class="kv"><span>Includes</span><b style="text-align:right">${it.unlimited ? 'Unlimited sessions of:' : ''}${it.includes.map((i) => `<div>${it.unlimited ? '' : i.qty + ' × '}${esc(i.name)}</div>`).join('')}</b></div>`}
      </div>
      <div class="row"><button class="btn ghost grow" data-act="addCart" data-type="${type}" data-id="${it.id}">Add to cart</button><button class="btn grow" data-act="buyNow" data-type="${type}" data-id="${it.id}">Buy now</button></div>`;
  }
  const addLine = (type, id) => { const l = S.cart.find((x) => x.type === type && x.id === id); if (l) l.qty = Math.min(20, l.qty + 1); else S.cart.push({ type, id, qty: 1 }); saveCart(); chrome('shop'); };
  A.addCart = (el) => { addLine(el.dataset.type, el.dataset.id); FB.toast('Added to cart', 'ok'); };
  A.buyNow = (el) => { addLine(el.dataset.type, el.dataset.id); go('#/cart'); };

  // ------------------------------------------------------------------ cart / checkout
  async function pageCart() {
    S.cart = S.cart.filter((l) => item(l.type, l.id));
    saveCart();
    if (!S.cart.length) { $app.innerHTML = '<div class="empty"><div style="font-size:44px">🛒</div>Your cart is empty.<br><br><a class="btn" href="#/shop">Browse services</a></div>'; return; }
    const usable = S.my.vouchers.filter((v) => v.usable);
    $app.innerHTML = `<h1 style="margin-bottom:12px">Checkout</h1>
      <div class="stack">${S.cart.map((l, i) => { const it = item(l.type, l.id); return `<div class="card row"><div class="grow"><div style="font-weight:700">${esc(it.name)}</div><div class="small">${priceHtml(it)}</div></div><div class="qty"><button data-act="qty" data-i="${i}" data-d="-1">−</button><span>${l.qty}</span><button data-act="qty" data-i="${i}" data-d="1">+</button></div></div>`; }).join('')}</div>
      <div class="card sec"><h3>Voucher</h3><div class="field" style="margin-top:8px"><select id="vsel"><option value="">No voucher</option>${usable.map((v) => `<option value="${v.id}" ${S.C.voucherId === v.id ? 'selected' : ''}>${esc(v.title)} (${esc(v.code)})</option>`).join('')}</select></div>
        <div class="row"><input type="text" id="vcode" placeholder="Or enter voucher code" style="text-transform:uppercase"><button class="btn ghost sm" data-act="applyCode">Apply</button></div><div class="tiny" id="verr" style="color:var(--bad);margin-top:6px"></div></div>
      <div class="card sec"><h3>Use points</h3><p class="small muted">You have <b>${pts(S.my.points)}</b> points · 1 point = ${money(S.pub.studio.pointValueRM)}</p><div class="row"><input type="number" id="ptsin" min="0" step="0.01" value="${S.C.points || ''}" placeholder="0"><button class="btn ghost sm" data-act="maxPts">Use max</button></div></div>
      <div class="sec" id="sum"><div class="loading"><span class="sp"></span></div></div>`;
    document.getElementById('vsel').onchange = (e) => { S.C.voucherId = e.target.value; refreshQuote(); };
    document.getElementById('ptsin').oninput = (e) => { S.C.points = Math.max(0, Number(e.target.value) || 0); clearTimeout(S.qt); S.qt = setTimeout(refreshQuote, 350); };
    refreshQuote();
  }
  async function refreshQuote(opts = {}) {
    const box = document.getElementById('sum'); if (!box) return;
    const body = { lines: S.cart, voucherId: S.C.voucherId || null, voucherCode: opts.code || '', points: S.C.points || 0 };
    let q;
    try { q = await FB.post('/api/quote', body); }
    catch (e) {
      const verr = document.getElementById('verr');
      if (/oucher/.test(e.message)) { S.C.voucherId = ''; const vs = document.getElementById('vsel'); if (vs) vs.value = ''; if (verr) verr.textContent = e.message; return refreshQuote(); }
      if (/points|payable/.test(e.message)) { S.C.points = 0; const pi = document.getElementById('ptsin'); if (pi) pi.value = ''; FB.toast(e.message, 'err'); return refreshQuote(); }
      box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return;
    }
    if (q.voucher && !S.C.voucherId) { S.C.voucherId = q.voucher.id; const vs = document.getElementById('vsel'); if (vs) vs.value = q.voucher.id; }
    S.lastQuote = q;
    document.getElementById('verr').textContent = '';
    box.innerHTML = `<div class="sum"><div class="l"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>${q.voucherDiscount ? `<div class="l" style="color:var(--ok)"><span>Voucher ${esc(q.voucher.code)}</span><span>−${money(q.voucherDiscount)}</span></div>` : ''}${q.pointsDiscount ? `<div class="l" style="color:var(--ok)"><span>Points (${pts(q.pointsUsed)})</span><span>−${money(q.pointsDiscount)}</span></div>` : ''}<div class="l tot"><span>Total</span><span>${money(q.total)}</span></div>
      ${q.depositRequired ? `<div class="l small muted"><span>Deposit to pay first (${q.depositPercent}%)</span><span>${money(q.depositRequired)}</span></div>` : ''}${q.earnPoints ? `<div class="small" style="margin-top:6px;color:var(--brand)">⭐ You will earn ${q.earnPoints} point${q.earnPoints > 1 ? 's' : ''} once payment is confirmed</div>` : ''}</div>
      <button class="btn block" style="margin-top:12px" data-act="placeOrder">Place order · ${money(q.total)}</button><p class="tiny muted center" style="margin-top:8px">Next step: bank in the amount and upload your receipt.</p>`;
  }
  A.qty = (el) => { const l = S.cart[Number(el.dataset.i)]; l.qty += Number(el.dataset.d); if (l.qty < 1) S.cart.splice(Number(el.dataset.i), 1); l && (l.qty = Math.min(20, l.qty)); saveCart(); chrome('wallet'); pageCart(); };
  A.applyCode = async () => { const c = document.getElementById('vcode').value.trim(); if (!c) return; S.C.voucherId = ''; document.getElementById('vsel').value = ''; await refreshQuote({ code: c }); };
  A.maxPts = () => { const q = S.lastQuote; const max = Math.min(S.my.points, (q.subtotal - q.voucherDiscount) / S.pub.studio.pointValueRM); S.C.points = Math.floor(max * 100) / 100; document.getElementById('ptsin').value = S.C.points; refreshQuote(); };
  A.placeOrder = async (el) => {
    el.disabled = true;
    try {
      const r = await FB.post('/api/orders', { lines: S.cart, voucherId: S.C.voucherId || null, points: S.C.points || 0 });
      S.cart = []; saveCart(); S.C = { voucherId: '', points: 0 }; await loadMy();
      FB.toast('Order placed!', 'ok'); go('#/order/' + r.order.id);
    } catch (e) { el.disabled = false; throw e; }
  };

  // ------------------------------------------------------------------ order & payment
  function receiptLink(r) { return `${r}?t=${encodeURIComponent(token())}`; }
  function payForm(kind, refId, due, label) {
    return `<div class="card sec"><h3>${label}</h3>
      ${S.my.bank.bankName || S.my.bank.accountNo ? `<div class="note" style="margin:8px 0"><b>${esc(S.my.bank.bankName)}</b><br>Account no: <b>${esc(S.my.bank.accountNo)}</b><br>Account name: ${esc(S.my.bank.accountName)}</div>` : ''}
      <p class="small muted">${esc(S.my.bank.instructions)}</p>
      <div class="field"><label class="f">Amount you transferred (RM)</label><input type="number" id="payamt" step="0.01" min="0" value="${due > 0 ? due.toFixed(2) : ''}"></div>
      <div class="field"><label class="f">Payment receipt (photo / screenshot)</label><input type="file" id="payfile" accept="image/*"></div>
      <div class="field"><label class="f">Note (optional)</label><input type="text" id="paynote" maxlength="120" placeholder="e.g. Maybank transfer"></div>
      <button class="btn block" data-act="uploadReceipt" data-kind="${kind}" data-ref="${refId}">Upload receipt</button></div>`;
  }
  A.uploadReceipt = async (el) => {
    const f = document.getElementById('payfile').files[0], amount = document.getElementById('payamt').value;
    if (!f) return FB.toast('Please choose your receipt image', 'err');
    if (!(Number(amount) > 0)) return FB.toast('Please enter the amount', 'err');
    el.disabled = true;
    try {
      const image = await FB.resizeImage(f, 1400, 0.85);
      await FB.post('/api/payments', { kind: el.dataset.kind, refId: el.dataset.ref, amount, image, note: document.getElementById('paynote').value });
      await loadMy(); FB.toast('Receipt uploaded. We will confirm shortly.', 'ok'); route();
    } catch (e) { el.disabled = false; throw e; }
  };
  const payList = (ps) => ps.length ? `<div class="logbox" style="margin-top:8px">${ps.map((p) => `<div class="lg"><span>${FB.stamp(p.createdAt)}<br><a target="_blank" rel="noopener" href="${receiptLink(p.receipt)}" class="small">View receipt</a></span><span class="right"><b>${money(p.amount)}</b><br>${p.status === 'confirmed' ? '<span class="badge ok">Confirmed</span>' : p.status === 'rejected' ? `<span class="badge bad">Rejected</span>${p.reason ? `<div class="tiny muted">${esc(p.reason)}</div>` : ''}` : '<span class="badge warn">Checking</span>'}</span></div>`).join('')}</div>` : '';
  async function pageOrder([id]) {
    await loadMy();
    const o = S.my.orders.find((x) => x.id === id);
    if (!o) { $app.innerHTML = '<div class="empty">Order not found.<br><br><a class="btn" href="#/wallet">Back</a></div>'; return; }
    const needDeposit = o.depositRequired > 0 && o.confirmedPaid < o.depositRequired - 0.005;
    const due = Math.max(0, (needDeposit ? o.depositRequired : o.balance) - o.pendingPaid);
    $app.innerHTML = `<a href="#/wallet?tab=purchases" class="small">← My purchases</a>
      <div class="row between" style="margin-top:8px"><h1>Order ${esc(o.no)}</h1>${FB.badge(o.status)}</div><p class="muted small">${FB.stamp(o.createdAt)}</p>
      <div class="card stack" style="margin-top:10px">${o.lines.map((l) => `<div class="row between"><div>${esc(l.name)} <span class="muted">× ${l.qty}</span>${l.validityDays ? `<div class="tiny muted">Valid ${l.validityDays} days from purchase</div>` : ''}</div><b>${money(l.unitPrice * l.qty)}</b></div>`).join('')}
        <div class="sum" style="border:0;padding:0">${o.voucherDiscount ? `<div class="l"><span>Voucher ${esc(o.voucherCode)}</span><span>−${money(o.voucherDiscount)}</span></div>` : ''}${o.pointsDiscount ? `<div class="l"><span>Points used (${pts(o.pointsUsed)})</span><span>−${money(o.pointsDiscount)}</span></div>` : ''}<div class="l tot"><span>Total</span><span>${money(o.total)}</span></div><div class="l small muted"><span>Paid & confirmed</span><span>${money(o.confirmedPaid)}</span></div></div></div>
      ${o.status === 'paid' ? `<div class="note sec">✅ Payment confirmed.${o.pointsEarned ? ` You earned <b>${o.pointsEarned} point${o.pointsEarned > 1 ? 's' : ''}</b>.` : ''}</div><a class="btn block" style="margin-top:12px" href="#/book">📅 Book an appointment</a>`
        : o.status === 'cancelled' ? '<div class="note warn sec">This order was cancelled.</div>'
        : `${o.usable ? '<div class="note sec">Deposit received - you can already book. Please settle the balance.</div>' : ''}${payForm('order', o.id, due, needDeposit ? `Pay deposit (${o.depositPercent}%)` : o.confirmedPaid ? 'Pay balance' : 'Make payment')}
          ${o.confirmedPaid === 0 && o.pendingPaid === 0 ? '<button class="btn ghost block" style="margin-top:12px" data-act="cancelOrder" data-id="' + o.id + '">Cancel this order</button>' : ''}`}
      ${payList(o.payments)}`;
  }
  A.cancelOrder = async (el) => { if (!(await FB.confirm('Cancel this order?', 'Yes, cancel', true))) return; await FB.post(`/api/orders/${el.dataset.id}/cancel`); await loadMy(); FB.toast('Order cancelled'); go('#/wallet?tab=purchases'); };

  // ------------------------------------------------------------------ wallet
  const GROUP_RANK = { active: 0, awaiting_payment: 1, expired: 2, used_up: 3, cancelled: 4 };
  function groups() {
    const map = new Map();
    for (const e of S.my.entitlements) { if (!map.has(e.unitId)) map.set(e.unitId, []); map.get(e.unitId).push(e); }
    return [...map.values()].map((items) => {
      const states = items.map((i) => i.state);
      const state = states.includes('active') ? 'active' : states.includes('awaiting_payment') ? 'awaiting_payment' : states.every((s) => s === 'cancelled') ? 'cancelled' : states.includes('expired') ? 'expired' : 'used_up';
      return { items, state, head: items[0] };
    }).sort((a, b) => GROUP_RANK[a.state] - GROUP_RANK[b.state] || b.head.createdAt - a.head.createdAt);
  }
  function groupCard(g) {
    const h = g.head;
    const validity = h.expiryDate ? `Valid until <b>${FB.date(h.expiryDate)}</b>${h.state === 'active' ? ` · ${h.daysLeft} day${h.daysLeft === 1 ? '' : 's'} left` : ''}` : 'No expiry';
    return `<div class="card wal"><div class="row between"><div><h3>${esc(h.title)}</h3><div class="tiny muted">Order ${esc(h.orderNo)} · purchased ${FB.date(h.startDate)}</div></div>${FB.badge(g.state)}</div>
      <div class="small" style="margin-top:8px">📅 ${validity}</div>
      <div class="items">${g.items.map((i) => `<div><div class="it"><div class="grow"><b>${esc(i.serviceName)}</b></div><div>${i.unlimited ? '<span class="badge ok">Unlimited</span>' : `<b>${i.remaining}</b> left`}</div><button class="btn sm ${i.bookable ? '' : 'ghost'}" ${i.bookable ? '' : 'disabled'} data-act="bookEnt" data-id="${i.id}">Book</button></div>
        ${i.unlimited ? `<div class="tiny muted">${i.used} used so far</div>` : `<div class="progress"><i style="width:${Math.round(i.used / i.total * 100)}%"></i></div><div class="tiny muted" style="margin-top:3px">${i.used} used of ${i.total}${i.reserved ? ` · ${i.reserved} booked, waiting` : ''}</div>`}</div>`).join('')}</div>
      ${g.state === 'awaiting_payment' ? `<a class="btn sm block" style="margin-top:10px" href="#/order/${h.orderId}">Pay now / upload receipt</a>` : ''}</div>`;
  }
  async function pageWallet(_, q) {
    await loadMy();
    if (q.tab) S.wtab = q.tab;
    const tab = S.wtab, m = S.my;
    let body = '';
    if (tab === 'packages') { const g = groups(); body = g.length ? `<div class="stack">${g.map(groupCard).join('')}</div>` : '<div class="empty"><div style="font-size:44px">👛</div>You have not purchased anything yet.<br><br><a class="btn" href="#/shop">Browse services & packages</a></div>'; }
    if (tab === 'appointments') {
      const today = FB.todayMY(), up = m.bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && b.date >= today).reverse(), past = m.bookings.filter((b) => !up.includes(b));
      const card = (b) => `<div class="card bk" data-act="bk" data-id="${b.id}"><div class="row between"><div class="t">${esc(b.serviceName)}</div>${FB.badge(b.status)}</div><div class="muted">${FB.dateLong(b.date)} · ${FB.time(b.start)} - ${FB.time(b.end)}</div><div class="small muted">${b.mode === 'home' ? '🚗 Home service' : '🏠 At studio'} · ${esc(b.beauticianName)}</div></div>`;
      body = `<a class="btn block" href="#/book" style="margin-bottom:12px">📅 Book new appointment</a>` + (m.bookings.length ? `<div class="stack">${up.length ? '<h3>Upcoming</h3>' + up.map(card).join('') : ''}${past.length ? '<h3 style="margin-top:10px">Past</h3>' + past.map(card).join('') : ''}</div>` : '<div class="empty">No appointments yet.</div>');
    }
    if (tab === 'purchases') body = m.orders.length ? `<div class="stack">${m.orders.map((o) => `<a class="card row" style="text-decoration:none;color:inherit" href="#/order/${o.id}"><div class="grow"><b>${esc(o.no)}</b><div class="small muted">${FB.stamp(o.createdAt)}</div><div class="small">${esc(o.lines.map((l) => l.name + (l.qty > 1 ? ' ×' + l.qty : '')).join(', '))}</div></div><div class="right"><b>${money(o.total)}</b><br>${FB.badge(o.status)}</div></a>`).join('')}</div>` : '<div class="empty">No purchase history yet.</div>';
    $app.innerHTML = `<h1 style="margin-bottom:12px">My wallet</h1><div class="seg" style="margin-bottom:14px">${[['packages', 'My packages'], ['appointments', 'Appointments'], ['purchases', 'Purchases']].map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-act="wtab" data-v="${k}">${t}</button>`).join('')}</div>${body}`;
  }
  A.wtab = (el) => { S.wtab = el.dataset.v; pageWallet([], {}); };
  A.bookEnt = (el) => go('#/book?ent=' + el.dataset.id);
  A.bk = (el) => bookingModal(el.dataset.id);
  function bookingModal(id) {
    const b = S.my.bookings.find((x) => x.id === id); if (!b) return;
    const canCancel = ['pending', 'confirmed'].includes(b.status);
    const m = FB.modal('Appointment ' + b.no, `<div class="stack"><div class="row between"><h3>${esc(b.serviceName)}</h3>${FB.badge(b.status)}</div>
      <div class="card flat"><div class="kv"><span>Date</span><b>${FB.dateLong(b.date)}</b></div><div class="kv"><span>Time</span><b>${FB.time(b.start)} - ${FB.time(b.end)}</b></div><div class="kv"><span>Where</span><b>${b.mode === 'home' ? 'Home service' : 'At studio'}</b></div>
        ${b.mode === 'home' ? `<div class="kv"><span>Address</span><b style="text-align:right">${esc(b.contact.address)}${b.contact.area ? ', ' + esc(b.contact.area) : ''}</b></div>` : `<div class="kv"><span>Studio</span><b style="text-align:right">${esc(S.pub.studio.address)}</b></div>`}
        <div class="kv"><span>Beautician</span><b>${esc(b.beauticianName)}</b></div><div class="kv"><span>Contact</span><b>${esc(b.contact.name)} · ${esc(b.contact.phone)}</b></div><div class="kv"><span>Package</span><b>${esc(b.title)}</b></div>
        ${b.reason ? `<div class="kv"><span>Note</span><b>${esc(b.reason)}</b></div>` : ''}</div>
      ${b.status === 'pending' ? '<div class="note">Waiting for our team to approve your booking. You will see the status here.</div>' : ''}
      ${b.homeFee ? `<div class="note ${b.feeStatus === 'paid' ? '' : 'warn'}">Home service fee ${money(b.homeFee)} · ${FB.badge(b.feeStatus)}</div>${b.feeStatus === 'unpaid' && canCancel ? payForm('booking', b.id, b.homeFee, 'Pay home service fee') : ''}${payList(b.payments)}` : ''}
      ${canCancel ? `<button class="btn ghost block" data-act="cancelBk" data-id="${b.id}">Cancel appointment</button><p class="tiny muted center">Confirmed appointments can be cancelled up to ${S.pub.studio.cancelHours} hours before the start time.</p>` : ''}</div>`);
    A._bm = m;
  }
  A.cancelBk = async (el) => { if (!(await FB.confirm('Cancel this appointment? The session stays in your package.', 'Yes, cancel', true))) return; await FB.post(`/api/bookings/${el.dataset.id}/cancel`); await loadMy(); document.querySelectorAll('.ovl').forEach((o) => o.remove()); FB.toast('Appointment cancelled'); route(); };

  // ------------------------------------------------------------------ booking wizard
  async function pageBook(_, q) {
    await loadMy();
    const bookable = S.my.entitlements.filter((e) => e.bookable);
    if (!S.B || (q.ent && S.B.entId !== q.ent)) S.B = { entId: q.ent || null, mode: null, date: null, time: null, beauticianId: 'any', month: FB.todayMY().slice(0, 7), days: [], slots: [], contact: { name: S.my.user.name, phone: S.my.user.phone, area: S.my.user.area, address: S.my.user.address } };
    if (S.B.entId && !bookable.some((e) => e.id === S.B.entId)) S.B.entId = null;
    drawBook();
  }
  function bookEnt() { return S.my.entitlements.find((e) => e.id === S.B.entId); }
  function bookSvc() { const e = bookEnt(); return e ? S.pub.services.find((s) => s.id === e.serviceId) : null; }
  function drawBook() {
    const B = S.B, bookable = S.my.entitlements.filter((e) => e.bookable), st = S.pub.studio, ent = bookEnt(), svc = bookSvc();
    if (!bookable.length) { $app.innerHTML = '<h1 style="margin-bottom:12px">Book appointment</h1><div class="empty"><div style="font-size:44px">📅</div>You need a purchased service or package to book.<br>Packages become available once payment is confirmed.<br><br><a class="btn" href="#/shop">Browse services</a> <a class="btn ghost" href="#/wallet?tab=purchases">My purchases</a></div>'; return; }
    const modes = svc ? [['studio', '🏠 At the studio', svc.studioAllowed !== false && st.studioEnabled, st.address], ['home', '🚗 Home service', svc.homeAllowed !== false && st.homeEnabled, `+${money(st.homeFee)} per visit · around Klang Valley`]] : [];
    const slot = B.slots.find((s) => s.time === B.time);
    const sel = (cond) => (cond ? 'on' : '');
    let h = `<h1>Book appointment</h1><p class="muted small">Sessions are only deducted after your treatment is completed.</p>
      <div class="step"><i>1</i><h3>What would you like?</h3></div>
      ${bookable.map((e) => `<label class="opt ${sel(B.entId === e.id)}" data-act="pickEnt" data-id="${e.id}"><div class="row between"><div><b>${esc(e.serviceName)}</b><div class="tiny muted">${esc(e.title)}</div></div><div class="small right">${e.unlimited ? 'Unlimited' : `<b>${e.available}</b> available`}${e.expiryDate ? `<div class="tiny muted">until ${FB.date(e.expiryDate)}</div>` : ''}</div></div></label>`).join('')}`;
    if (ent) {
      h += `<div class="step"><i>2</i><h3>Where?</h3></div>${modes.map(([k, t, ok, sub]) => `<label class="opt ${sel(B.mode === k)} ${ok ? '' : 'dis'}" ${ok ? `data-act="pickMode" data-v="${k}"` : ''}><b>${t}</b>${ok ? '' : ' <span class="badge grey">Not available for this treatment</span>'}<div class="small muted">${esc(sub)}</div></label>`).join('')}`;
    }
    if (ent && B.mode) {
      h += `<div class="step"><i>3</i><h3>Choose a date</h3></div>${calHtml(ent)}`;
    }
    if (B.date) {
      h += `<div class="step"><i>4</i><h3>Choose a time <span class="small muted">· ${FB.dateLong(B.date)}</span></h3></div>`;
      h += B.loadingSlots ? '<div class="loading"><span class="sp"></span></div>' : B.slots.length ? `<div class="slots">${B.slots.map((s) => `<button class="slot ${sel(B.time === s.time)}" data-act="pickTime" data-v="${s.time}">${FB.time(s.time)}</button>`).join('')}</div><p class="tiny muted" style="margin-top:6px">Session takes about ${FB.dur(svc.durationMin)}.</p>` : '<div class="note warn">No free time on this date. Please pick another day.</div>';
    }
    if (slot) {
      const names = slot.beauticianIds.map((id) => ({ id, name: (st && S.pub.staff.find((x) => x.id === id) || {}).name || 'Beautician' }));
      h += `<div class="step"><i>5</i><h3>Beautician</h3></div><label class="opt ${sel(B.beauticianId === 'any')}" data-act="pickBea" data-id="any"><b>Any available beautician</b><div class="small muted">Recommended - we will assign a qualified beautician</div></label>${names.map((n) => `<label class="opt ${sel(B.beauticianId === n.id)}" data-act="pickBea" data-id="${n.id}"><b>${esc(n.name)}</b></label>`).join('')}
        <div class="step"><i>6</i><h3>Your details</h3></div><div class="card">
        <div class="field"><label class="f">Name</label><input type="text" id="cname" value="${esc(B.contact.name)}"></div><div class="field"><label class="f">Contact number</label><input type="tel" id="cphone" value="${esc(B.contact.phone)}"></div>
        ${B.mode === 'home' ? `<div class="field"><label class="f">Area</label><select id="carea"><option value="">Choose your area</option>${st.homeAreas.map((a) => `<option ${B.contact.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div><div class="field"><label class="f">Full address for the beautician to attend</label><textarea id="caddr" placeholder="Unit / street / postcode">${esc(B.contact.address)}</textarea></div><div class="note warn">Home service fee <b>${money(st.homeFee)}</b> per visit. You can pay it by bank-in and upload the receipt after booking.</div>` : ''}</div>
        <div class="sum" style="margin-top:14px"><div class="l"><span>Treatment</span><b>${esc(ent.serviceName)}</b></div><div class="l"><span>When</span><b>${FB.dateLong(B.date)}, ${FB.time(B.time)}</b></div><div class="l"><span>Where</span><b>${B.mode === 'home' ? 'Home service' : 'Studio'}</b></div>${B.mode === 'home' ? `<div class="l"><span>Home fee</span><b>${money(st.homeFee)}</b></div>` : ''}</div>
        <button class="btn block" style="margin-top:12px" data-act="submitBooking">Request this appointment</button><p class="tiny muted center" style="margin-top:6px">Our team will review and approve your request.</p>`;
    }
    $app.innerHTML = h;
    ['cname:name', 'cphone:phone', 'carea:area', 'caddr:address'].forEach((x) => { const [id, k] = x.split(':'); const el = document.getElementById(id); if (el) el.oninput = el.onchange = () => { B.contact[k] = el.value; }; });
  }
  function calHtml(ent) {
    const B = S.B, [y, m] = B.month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)), lead = first.getUTCDay(), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const avail = new Set(B.days);
    const curMonth = FB.todayMY().slice(0, 7), last = FB.addDays(FB.todayMY(), S.pub.studio.maxAdvanceDays || 60).slice(0, 7);
    let cells = FB.DAYS.map((d) => `<div class="dn">${d[0]}</div>`).join('') + '<div></div>'.repeat(lead);
    for (let d = 1; d <= dim; d++) { const ds = `${B.month}-${String(d).padStart(2, '0')}`; const ok = avail.has(ds) && (!ent.expiryDate || ds <= ent.expiryDate); cells += ok ? `<button class="dd av ${B.date === ds ? 'sel' : ''}" data-act="pickDate" data-v="${ds}">${d}</button>` : `<div class="dd">${d}</div>`; }
    return `<div class="cal"><div class="hd"><button data-act="calMonth" data-d="-1" ${B.month <= curMonth ? 'disabled style="opacity:.3"' : ''}>‹</button><span>${FB.MON[m - 1]} ${y}</span><button data-act="calMonth" data-d="1" ${B.month >= last ? 'disabled style="opacity:.3"' : ''}>›</button></div>${B.loadingDays ? '<div class="loading"><span class="sp"></span></div>' : `<div class="g">${cells}</div>`}</div><p class="tiny muted" style="margin-top:6px">Highlighted dates have free time.${ent.expiryDate ? ` Your package is valid until ${FB.date(ent.expiryDate)}.` : ''}</p>`;
  }
  async function loadDays() {
    const B = S.B, svc = bookSvc(); if (!svc || !B.mode) return;
    B.loadingDays = true; drawBook();
    try { B.days = (await FB.get(`/api/availability/days?serviceId=${svc.id}&month=${B.month}&mode=${B.mode}`)).days; } catch (e) { FB.err(e); B.days = []; }
    B.loadingDays = false; drawBook();
  }
  async function loadSlots() {
    const B = S.B, svc = bookSvc();
    B.loadingSlots = true; B.slots = []; drawBook();
    try { B.slots = (await FB.get(`/api/availability/slots?serviceId=${svc.id}&date=${B.date}&mode=${B.mode}`)).slots; } catch (e) { FB.err(e); }
    B.loadingSlots = false; drawBook();
  }
  A.pickEnt = (el) => { const B = S.B; B.entId = el.dataset.id; const svc = bookSvc(); const st = S.pub.studio; if (B.mode && !((B.mode === 'studio' ? svc.studioAllowed !== false && st.studioEnabled : svc.homeAllowed !== false && st.homeEnabled))) B.mode = null; B.date = B.time = null; B.days = []; B.slots = []; B.beauticianId = 'any'; if (B.mode) loadDays(); else drawBook(); };
  A.pickMode = (el) => { S.B.mode = el.dataset.v; S.B.date = S.B.time = null; S.B.slots = []; loadDays(); };
  A.calMonth = (el) => { const [y, m] = S.B.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.d), 1)); S.B.month = d.toISOString().slice(0, 7); loadDays(); };
  A.pickDate = (el) => { S.B.date = el.dataset.v; S.B.time = null; S.B.beauticianId = 'any'; loadSlots(); };
  A.pickTime = (el) => { S.B.time = el.dataset.v; S.B.beauticianId = 'any'; drawBook(); setTimeout(() => window.scrollBy({ top: 260, behavior: 'smooth' }), 50); };
  A.pickBea = (el) => { S.B.beauticianId = el.dataset.id; drawBook(); };
  A.submitBooking = async (el) => {
    const B = S.B; el.disabled = true;
    try {
      const r = await FB.post('/api/bookings', { entitlementId: B.entId, mode: B.mode, date: B.date, start: B.time, beauticianId: B.beauticianId === 'any' ? null : B.beauticianId, contact: B.contact });
      S.B = null; await loadMy(); FB.toast('Booking requested!', 'ok'); S.wtab = 'appointments'; go('#/wallet?tab=appointments');
      setTimeout(() => bookingModal(r.booking.id), 300);
    } catch (e) { el.disabled = false; if (/no longer available/.test(e.message)) loadSlots(); throw e; }
  };

  // ------------------------------------------------------------------ rewards
  async function pageRewards() {
    await loadMy();
    const m = S.my, st = S.pub.studio;
    const vs = m.vouchers;
    $app.innerHTML = `<h1 style="margin-bottom:12px">Rewards</h1>
      <div class="pbig"><span>Your points</span><b>${pts(m.points)}</b><span>= ${money(m.points * st.pointValueRM)} off your next purchase</span></div>
      <p class="small muted" style="margin:8px 4px">Spend ${money(st.pointsEarnPerRM)} = 1 point · 1 point = ${money(st.pointValueRM)}. Points from purchases are added after we confirm your payment. Use points at checkout.</p>
      <a class="card row sec" style="text-decoration:none;color:inherit" href="#/game"><div style="font-size:38px">🎮</div><div class="grow"><h3>Daily lucky game</h3><div class="small muted">Play once a day and earn ${st.gamePoints} point</div></div>${m.game.playedToday ? '<span class="badge grey">Played today</span>' : '<span class="badge ok">Play now</span>'}</a>
      <div class="sec"><h2 style="margin-bottom:10px">My vouchers</h2>${vs.length ? `<div class="stack">${vs.map((v) => `<div class="vc ${v.usable ? '' : 'off'}"><div class="vv">${v.type === 'percent' ? v.value + '%' : money(v.value)}<div style="font-family:sans-serif;font-size:10px;letter-spacing:1px;color:var(--gold)">OFF</div></div><div class="grow"><b>${esc(v.title)}</b><div class="small muted">${esc(v.description)}</div><div class="tiny muted">${v.minSpend ? 'Min spend ' + money(v.minSpend) + ' · ' : ''}${v.appliesTo === 'package' ? 'Packages only · ' : v.appliesTo === 'service' ? 'Single services only · ' : ''}${v.endDate ? 'Until ' + FB.date(v.endDate) : 'No expiry'}</div><div style="margin-top:6px"><span class="code">${esc(v.code)}</span> ${v.usable ? `<button class="link small" data-act="copy" data-v="${esc(v.code)}">Copy</button>` : `<span class="badge grey">${esc(v.reason)}</span>`}</div></div></div>`).join('')}</div><p class="small muted" style="margin-top:8px">Choose a voucher at checkout.</p>` : '<div class="card empty">No vouchers right now. Watch this space!</div>'}</div>
      <div class="sec card"><h3>Member benefits</h3><div class="small" style="margin-top:6px;line-height:1.7">${m.isMember ? '<span class="badge ok">You are a member ✓</span><br>' : 'Purchase any package to join our membership.<br>'}• Collect points and exchange for services or products<br>• Referral: gain RM30 cash voucher for each friend you introduce<br>• Birthday month: free lash extension, lash keratin or facial massage<br>• VIP: first to know about promotions & events<br>• Lifetime membership, no renewal</div><p class="tiny muted" style="margin-top:6px">Ask our team to claim referral and birthday rewards.</p></div>
      <div class="sec"><h2 style="margin-bottom:10px">Points history</h2>${m.ledger.length ? `<div class="logbox">${m.ledger.map((l) => `<div class="lg"><span>${esc(l.note)}<div class="tiny muted">${FB.date(l.date)}</div></span><span class="${l.delta >= 0 ? 'plus' : 'minus'}">${l.delta >= 0 ? '+' : ''}${pts(l.delta)}</span></div>`).join('')}</div>` : '<div class="card empty">No points activity yet.</div>'}</div>`;
  }
  A.copy = async (el) => { try { await navigator.clipboard.writeText(el.dataset.v); FB.toast('Code copied', 'ok'); } catch { FB.toast('Code: ' + el.dataset.v); } };

  // ------------------------------------------------------------------ mini game
  async function pageGame() {
    await loadMy();
    const g = S.my.game;
    if (g.playedToday) {
      const my = Date.now() + 8 * 3600e3, next = Math.ceil((my + 1) / 864e5) * 864e5;
      $app.innerHTML = `<a href="#/rewards" class="small">← Rewards</a><div class="card center" style="margin-top:10px;padding:30px 16px"><div style="font-size:56px">🌙</div><h2>See you tomorrow!</h2><p class="muted">You have already played today and earned your ${g.points} point.</p><p class="small muted">Next game in</p>${FB.cdHtml(next - my)}</div>`;
      return;
    }
    $app.innerHTML = `<a href="#/rewards" class="small">← Rewards</a><h1 style="margin:8px 0">Sparkle catch</h1><p class="muted">Tap as many sparkles as you can in 10 seconds. Everyone earns <b>${g.points} point</b>, once per day.</p>
      <div class="row between" style="margin:10px 2px"><b>Score: <span id="sc">0</span></b><b>⏱ <span id="tm">10</span>s</b></div><div class="arena" id="arena"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><button class="btn gold" id="go" style="font-size:18px;padding:14px 30px">Start</button></div></div><div id="res"></div>`;
    document.getElementById('go').onclick = () => {
      const arena = document.getElementById('arena'); arena.innerHTML = '';
      let score = 0, t = 10; const sc = document.getElementById('sc'), tm = document.getElementById('tm');
      const em = ['✨', '💎', '🌸', '💖', '⭐', '🦋'];
      const spawn = () => { const b = document.createElement('button'); b.className = 'spark'; b.textContent = em[Math.floor(Math.random() * em.length)]; b.style.left = 4 + Math.random() * 78 + '%'; b.style.top = 4 + Math.random() * 78 + '%'; b.onclick = () => { score++; sc.textContent = score; b.remove(); }; arena.appendChild(b); setTimeout(() => b.remove(), 1200); };
      const sp = setInterval(spawn, 520), tk = setInterval(async () => {
        t--; tm.textContent = t;
        if (t > 0) return;
        clearInterval(sp); clearInterval(tk); arena.innerHTML = '';
        const res = document.getElementById('res');
        try { const r = await FB.post('/api/game/play', { score }); await loadMy(); chrome('rewards'); res.innerHTML = `<div class="card center sec"><div style="font-size:50px">🎉</div><h2>You caught ${score}!</h2><p>You earned <b>+${r.earned} point</b>. Balance: <b>${pts(r.points)}</b></p><a class="btn" href="#/rewards">Back to rewards</a></div>`; }
        catch (e) { res.innerHTML = `<div class="card center sec">${esc(e.message)}</div>`; }
      }, 1000);
      cleanup = () => { clearInterval(sp); clearInterval(tk); };
      spawn();
    };
  }

  // ------------------------------------------------------------------ profile
  async function pageProfile() {
    const u = S.my.user, st = S.pub.studio;
    $app.innerHTML = `<h1 style="margin-bottom:12px">My profile</h1>
      <form class="card" id="pf"><div class="field"><label class="f">Name</label><input type="text" name="name" value="${esc(u.name)}" required></div><div class="field"><label class="f">Contact number</label><input type="tel" name="phone" value="${esc(u.phone)}" required></div><div class="field"><label class="f">Email (optional)</label><input type="email" name="email" value="${esc(u.email)}"></div>
        <div class="field"><label class="f">Default home address (optional)</label><textarea name="address">${esc(u.address)}</textarea></div><div class="field"><label class="f">Area</label><select name="area"><option value="">-</option>${st.homeAreas.map((a) => `<option ${u.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div><button class="btn block">Save changes</button></form>
      <form class="card sec" id="pw"><h3>Change password</h3><div class="field" style="margin-top:8px"><label class="f">Current password</label><input type="password" name="current" required></div><div class="field"><label class="f">New password (min 6 characters)</label><input type="password" name="password" minlength="6" required></div><button class="btn ghost block">Update password</button></form>
      <button class="btn danger block sec" data-act="logout">Log out</button><p class="tiny muted center" style="margin-top:14px">${esc(st.name)} · ${esc(st.phone)}</p>`;
    document.getElementById('pf').onsubmit = async (e) => { e.preventDefault(); try { await FB.put('/api/me', Object.fromEntries(new FormData(e.target))); await loadMy(); chrome('profile'); FB.toast('Profile saved', 'ok'); } catch (x) { FB.err(x); } };
    document.getElementById('pw').onsubmit = async (e) => { e.preventDefault(); try { await FB.post('/api/me/password', Object.fromEntries(new FormData(e.target))); e.target.reset(); FB.toast('Password updated', 'ok'); } catch (x) { FB.err(x); } };
  }
  A.logout = async () => { try { await FB.post('/api/auth/logout'); } catch {} localStorage.removeItem(FB.tokenKey); sessionStorage.removeItem('fb_flash_seen'); S.my = null; S.B = null; go('#/home'); };

  // ------------------------------------------------------------------ login
  let authTab = 'login';
  async function pageLogin() {
    $app.innerHTML = `<div class="auth"><div class="center" style="margin:10px 0 18px"><h1>Welcome</h1><p class="muted">Log in to view your packages, book and earn rewards</p></div>
      <div class="seg"><button class="${authTab === 'login' ? 'on' : ''}" data-act="authTab" data-v="login">Log in</button><button class="${authTab === 'register' ? 'on' : ''}" data-act="authTab" data-v="register">Register</button></div>
      <form class="card" id="af" style="margin-top:14px">${authTab === 'register' ? '<div class="field"><label class="f">Full name</label><input type="text" name="name" required autocomplete="name"></div><div class="field"><label class="f">Contact number</label><input type="tel" name="phone" required autocomplete="tel" placeholder="e.g. 012-345 6789"></div><div class="field"><label class="f">Email (optional)</label><input type="email" name="email" autocomplete="email"></div>'
        : '<div class="field"><label class="f">Contact number or email</label><input type="text" name="identifier" required autocomplete="username"></div>'}
        <div class="field"><label class="f">Password</label><input type="password" name="password" required minlength="6" autocomplete="${authTab === 'login' ? 'current-password' : 'new-password'}"></div>
        <button class="btn block">${authTab === 'login' ? 'Log in' : 'Create my account'}</button>${authTab === 'login' ? '<p class="tiny muted center" style="margin-top:10px">Forgot your password? Please contact us and we will reset it.</p>' : ''}</form></div>`;
    document.getElementById('af').onsubmit = async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await FB.post(authTab === 'login' ? '/api/auth/login' : '/api/auth/register', Object.fromEntries(new FormData(e.target)));
        if (r.user.role !== 'customer') { FB.toast('Staff accounts sign in at the portal.'); setTimeout(() => (location.href = '/admin'), 800); return; }
        localStorage.setItem(FB.tokenKey, r.token); S.my = null; await loadMy(); sessionStorage.removeItem('fb_flash_seen');
        const next = sessionStorage.getItem('fb_next'); sessionStorage.removeItem('fb_next'); go(next && next !== '#/login' ? next : '#/home');
      } catch (x) { btn.disabled = false; FB.err(x); }
    };
  }
  A.authTab = (el) => { authTab = el.dataset.v; pageLogin(); };

  route();
})();
