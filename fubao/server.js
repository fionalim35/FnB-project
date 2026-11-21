'use strict';
/**
 * Fubao Beauty Centre - zero-dependency Node.js server.
 *   /        customer web app
 *   /admin   owner & beautician portal
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./lib/store');
S.load();
const U = require('./lib/util');
const L = require('./lib/logic');
const { uid, round2, bad, str, num, nowMY, addDays, toMin, isDate, isTime, isDateTime, HttpError } = U;
const d = () => S.d();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ------------------------------------------------------------------ http helpers
function readBody(req, limit = 9e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'File too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Invalid request')); }
    });
    req.on('error', reject);
  });
}
const sendJson = (res, status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
function saveDataUrl(dataUrl, dir) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Please upload an image (JPG, PNG or WebP)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw bad('Image is too large (max 6MB)');
  const magic = buf.subarray(0, 4).toString('hex');
  const okMagic = magic.startsWith('ffd8') || magic === '89504e47' || magic === '52494646' || magic === '47494638';
  if (!okMagic) throw bad('That file is not a valid image');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = uid() + uid() + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

// ------------------------------------------------------------------ auth
const attempts = new Map();
function throttle(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 10 * 60e3);
  if (a.length >= 10) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  a.push(now); attempts.set(key, a);
}
function newSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  d().sessions[token] = { userId: user.id, exp: Date.now() + 30 * 864e5 };
  return token;
}
function userFromToken(token) {
  const s = d().sessions[token];
  if (!s || s.exp < Date.now()) return null;
  const u = d().users.find((x) => x.id === s.userId);
  return u && u.active !== false ? u : null;
}

// ------------------------------------------------------------------ router
const routes = [];
const route = (method, pattern, roles, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), roles, fn });
const OWNER = ['owner'], CUST = ['customer'], STAFF = ['beautician'], ANY = ['owner', 'customer', 'beautician'];
const mutates = (fn) => async (ctx) => { const r = await fn(ctx); S.save(); return r; };

// ================= public & auth =================
route('GET', '/api/public', null, () => {
  const st = d().settings, cat = L.catalog();
  return {
    studio: { name: st.studioName, phone: st.phone, whatsapp: st.whatsapp, address: st.address, studioEnabled: st.studioEnabled, homeEnabled: st.homeEnabled, homeFee: st.homeFee, homeAreas: st.homeAreas, hours: st.studioWeekly, cancelHours: st.cancelHours, pointsEarnPerRM: st.pointsEarnPerRM, pointValueRM: st.pointValueRM, gamePoints: st.gamePoints, depositPercent: st.depositPercent, maxAdvanceDays: st.maxAdvanceDays },
    ...cat,
    staff: d().users.filter((u) => u.role === 'beautician' && u.active !== false).map((u) => ({ id: u.id, name: u.name, skills: u.skills || [] })),
    categories: [...new Set(cat.services.map((s) => s.category).filter(Boolean))],
  };
});

route('POST', '/api/auth/register', null, mutates(({ body, ip }) => {
  throttle('reg:' + ip);
  const name = str(body.name, 80), phone = U.normPhone(body.phone), email = U.normEmail(body.email), pw = String(body.password || '');
  if (!name) throw bad('Please enter your name');
  if (phone.length < 9 || phone.length > 12) throw bad('Please enter a valid contact number');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Please enter a valid email');
  if (pw.length < 6) throw bad('Password must be at least 6 characters');
  if (d().users.some((u) => u.phone === phone)) throw bad('This contact number is already registered. Please log in.');
  if (email && d().users.some((u) => u.email === email)) throw bad('This email is already registered. Please log in.');
  const u = { id: uid(), role: 'customer', name, phone, email, passHash: U.hashPassword(pw), active: true, createdAt: Date.now(), address: '', area: '' };
  d().users.push(u);
  return { token: newSession(u), user: L.pubUser(u) };
}));
route('POST', '/api/auth/login', null, mutates(({ body, ip }) => {
  const id = str(body.identifier, 120);
  throttle('login:' + ip + ':' + id.toLowerCase());
  const phone = U.normPhone(id), email = U.normEmail(id);
  const u = d().users.find((x) => (phone.length >= 9 && x.phone === phone) || (email && x.email && x.email === email));
  if (!u || u.active === false || !U.checkPassword(body.password, u.passHash)) throw new HttpError(401, 'Incorrect contact number / email or password');
  return { token: newSession(u), user: L.pubUser(u) };
}));
route('POST', '/api/auth/logout', ANY, mutates(({ token }) => { delete d().sessions[token]; return { ok: true }; }));
route('GET', '/api/me', ANY, ({ user }) => ({ user: L.pubUser(user) }));
route('PUT', '/api/me', ANY, mutates(({ user, body }) => {
  const name = str(body.name, 80), phone = U.normPhone(body.phone), email = U.normEmail(body.email);
  if (!name) throw bad('Please enter your name');
  if (phone.length < 9 || phone.length > 12) throw bad('Please enter a valid contact number');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Please enter a valid email');
  if (d().users.some((u) => u.id !== user.id && u.phone === phone)) throw bad('That contact number is used by another account');
  if (email && d().users.some((u) => u.id !== user.id && u.email === email)) throw bad('That email is used by another account');
  Object.assign(user, { name, phone, email });
  if (user.role === 'customer') { user.address = str(body.address, 300); user.area = str(body.area, 80); }
  return { user: L.pubUser(user) };
}));
route('POST', '/api/me/password', ANY, mutates(({ user, body }) => {
  if (!U.checkPassword(body.current, user.passHash)) throw bad('Your current password is incorrect');
  if (String(body.password || '').length < 6) throw bad('New password must be at least 6 characters');
  user.passHash = U.hashPassword(String(body.password));
  return { ok: true };
}));

// ================= availability =================
function svcFromQuery(q) {
  const s = d().services.find((x) => x.id === q.serviceId && x.active !== false);
  if (!s) throw bad('Service not found');
  return s;
}
route('GET', '/api/availability/days', ANY, ({ query }) => {
  const service = svcFromQuery(query);
  const month = /^\d{4}-\d{2}$/.test(query.month) ? query.month : nowMY().date.slice(0, 7);
  L.modeCheck(service, query.mode);
  return { days: L.availableDays({ service, month, mode: query.mode, beauticianId: query.beauticianId || null }) };
});
route('GET', '/api/availability/slots', ANY, ({ query }) => {
  const service = svcFromQuery(query);
  if (!isDate(query.date)) throw bad('Invalid date');
  L.modeCheck(service, query.mode);
  return { slots: L.slots({ service, date: query.date, mode: query.mode, beauticianId: query.beauticianId || null }) };
});

// ================= customer =================
route('GET', '/api/my', CUST, ({ user }) => {
  const s = d(), me = user.id;
  const ents = s.entitlements.filter((e) => e.customerId === me).map(L.entView).sort((a, b) => b.createdAt - a.createdAt);
  const today = nowMY().date;
  return {
    user: L.pubUser(user),
    points: L.pointsBalance(me),
    entitlements: ents,
    orders: s.orders.filter((o) => o.customerId === me).sort((a, b) => b.createdAt - a.createdAt).map(L.orderView),
    bookings: s.bookings.filter((b) => b.customerId === me).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).map(L.bookingView),
    vouchers: L.entitledVouchers(user),
    ledger: s.points.filter((p) => p.customerId === me).sort((a, b) => b.at - a.at).slice(0, 60),
    game: { playedToday: s.games.some((g) => g.customerId === me && g.date === today), points: s.settings.gamePoints, totalPlays: s.games.filter((g) => g.customerId === me).length },
    bank: s.settings.bank,
    isMember: s.orders.some((o) => o.customerId === me && o.status !== 'cancelled' && o.lines.some((l) => l.type === 'package')),
  };
});
const orderOpts = (b) => ({ voucherId: b.voucherId || null, code: b.voucherCode || '', points: b.points });
route('POST', '/api/quote', CUST, ({ user, body }) => {
  const p = L.priceOrder(user, body.lines, orderOpts(body));
  return { lines: p.lines, subtotal: p.subtotal, voucherDiscount: p.voucherDiscount, voucher: p.voucher ? { id: p.voucher.id, code: p.voucher.code, title: p.voucher.title } : null, pointsUsed: p.pointsUsed, pointsDiscount: p.pointsDiscount, total: p.total, depositRequired: p.depositRequired, depositPercent: p.depositPercent, earnPoints: Math.floor(p.total / (d().settings.pointsEarnPerRM || 100)) };
});
route('POST', '/api/orders', CUST, mutates(({ user, body }) => {
  const p = L.priceOrder(user, body.lines, orderOpts(body));
  return { order: L.orderView(L.createOrder(user, p)) };
}));
route('POST', '/api/orders/:id/cancel', CUST, mutates(({ user, params }) => {
  const o = d().orders.find((x) => x.id === params.id && x.customerId === user.id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status !== 'pending_payment' || L.confirmedPaid(o) > 0 || L.pendingPaid(o) > 0) throw bad('Only unpaid orders can be cancelled here. Please contact us.');
  L.cancelOrder(o, user.name);
  return { ok: true };
}));
route('POST', '/api/payments', CUST, mutates(({ user, body }) => {
  const s = d();
  const kind = body.kind === 'booking' ? 'booking' : 'order';
  const amount = round2(num(body.amount, 0));
  if (!(amount > 0) || amount > 100000) throw bad('Please enter the amount you transferred');
  if (kind === 'order') {
    const o = s.orders.find((x) => x.id === body.refId && x.customerId === user.id);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.status !== 'pending_payment') throw bad('This order does not need any more payment');
  } else {
    const b = s.bookings.find((x) => x.id === body.refId && x.customerId === user.id);
    if (!b) throw new HttpError(404, 'Booking not found');
    if (!b.homeFee) throw bad('This booking has no fee to pay');
  }
  const file = saveDataUrl(body.image, S.RECEIPTS);
  const p = { id: uid(), customerId: user.id, kind, refId: body.refId, amount, file, method: 'bank_in', note: str(body.note, 200), status: 'pending', createdAt: Date.now() };
  s.payments.push(p);
  return { payment: L.paymentView(p) };
}));
route('POST', '/api/bookings', CUST, mutates(({ user, body }) => {
  const b = L.makeBooking({ customer: user, entitlementId: body.entitlementId, mode: body.mode, date: body.date, start: body.start, beauticianId: body.beauticianId || null, contact: body.contact });
  return { booking: L.bookingView(b) };
}));
route('POST', '/api/bookings/:id/cancel', CUST, mutates(({ user, params }) => {
  const b = d().bookings.find((x) => x.id === params.id && x.customerId === user.id);
  if (!b) throw new HttpError(404, 'Booking not found');
  if (!['pending', 'confirmed'].includes(b.status)) throw bad('This appointment can no longer be cancelled');
  if (b.status === 'confirmed') {
    const hrs = (Date.parse(b.date + 'T' + b.start + ':00Z') - (Date.now() + U.MY_OFFSET)) / 3600e3;
    if (hrs < d().settings.cancelHours) throw bad(`Confirmed appointments can only be cancelled ${d().settings.cancelHours} hours or more before the start time. Please contact us.`);
  }
  b.status = 'cancelled'; b.log.push({ at: Date.now(), by: user.name, text: 'Cancelled by customer' });
  return { ok: true };
}));
route('POST', '/api/game/play', CUST, mutates(({ user }) => {
  const s = d(), today = nowMY().date;
  if (s.games.some((g) => g.customerId === user.id && g.date === today)) throw new HttpError(409, 'You have already played today. Come back tomorrow!');
  s.games.push({ customerId: user.id, date: today, at: Date.now() });
  L.addPoints(user.id, s.settings.gamePoints, 'game', 'Daily mini-game');
  return { earned: s.settings.gamePoints, points: L.pointsBalance(user.id) };
}));

// receipts (authorised by owner or by the customer who uploaded)
route('GET', '/api/receipt/:file', ANY, ({ user, params, res }) => {
  const p = d().payments.find((x) => x.file === params.file);
  if (!p || (user.role !== 'owner' && p.customerId !== user.id)) throw new HttpError(404, 'Not found');
  const ext = path.extname(p.file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
  fs.createReadStream(path.join(S.RECEIPTS, path.basename(p.file))).pipe(res);
  return undefined;
});

// ================= beautician =================
route('GET', '/api/staff/bookings', STAFF, ({ user, query }) => {
  const from = isDate(query.from) ? query.from : nowMY().date;
  const to = isDate(query.to) ? query.to : addDays(from, 30);
  return { bookings: d().bookings.filter((b) => b.beauticianId === user.id && b.date >= from && b.date <= to && b.status !== 'rejected').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).map(L.bookingView) };
});
route('POST', '/api/staff/bookings/:id/complete', STAFF, mutates(({ user, params }) => {
  const b = d().bookings.find((x) => x.id === params.id && x.beauticianId === user.id);
  if (!b) throw new HttpError(404, 'Appointment not found');
  if (b.status !== 'confirmed') throw bad('Only confirmed appointments can be marked as completed');
  L.completeBooking(b, user.name);
  return { booking: L.bookingView(b) };
}));
route('GET', '/api/staff/me', STAFF, ({ user }) => {
  const today = nowMY().date, days = [];
  for (let i = 0; i < 14; i++) { const date = addDays(today, i); days.push({ date, ranges: (L.staffRanges(user, date)).map((r) => ({ s: U.fromMin(r.s), e: U.fromMin(r.e) })) }); }
  return { user: L.pubUser(user), skills: d().services.filter((s) => (user.skills || []).includes(s.id)).map((s) => s.name), days };
});

// ================= admin: validators =================
const imgs = (v) => (Array.isArray(v) ? v : []).map((x) => String(x)).filter((x) => /^\/uploads\/[\w.-]+$/.test(x)).slice(0, 8);
const nullableMoney = (v) => { if (v === '' || v == null) return null; const n = num(v, NaN); if (!(n >= 0) || n > 100000) throw bad('Invalid price'); return round2(n); };
const money = (v, label = 'Price') => { const n = num(v, NaN); if (!(n >= 0) || n > 100000) throw bad(`Invalid ${label.toLowerCase()}`); return round2(n); };
const int = (v, min, max, label) => { const n = Math.round(num(v, NaN)); if (!(n >= min && n <= max)) throw bad(`${label} must be between ${min} and ${max}`); return n; };
const bool = (v, def = true) => (v == null ? def : v === true || v === 'true' || v === 1 || v === '1' || v === 'on');

const COLL = {
  services: {
    list: () => d().services, label: 'Service',
    validate(b) {
      const name = str(b.name, 120); if (!name) throw bad('Please enter a service name');
      const priceAfter = money(b.priceAfter, 'Price after'), priceBefore = nullableMoney(b.priceBefore);
      return { name, category: str(b.category, 80) || 'Other', description: str(b.description, 2000), images: imgs(b.images), priceBefore: priceBefore && priceBefore > priceAfter ? priceBefore : null, priceAfter, durationMin: int(b.durationMin, 5, 720, 'Session duration (minutes)'), gapMin: int(b.gapMin || 0, 0, 240, 'Gap after session (minutes)'), studioAllowed: bool(b.studioAllowed), homeAllowed: bool(b.homeAllowed), validityDays: int(b.validityDays || 0, 0, 3650, 'Validity days'), active: bool(b.active) };
    },
    inUse: (id) => d().packages.some((p) => p.items.some((i) => i.serviceId === id)) || d().entitlements.some((e) => e.serviceId === id) || d().bookings.some((x) => x.serviceId === id),
    after: (id) => { d().users.forEach((u) => { if (u.skills) u.skills = u.skills.filter((x) => x !== id); }); },
  },
  packages: {
    list: () => d().packages, label: 'Package',
    validate(b) {
      const name = str(b.name, 120); if (!name) throw bad('Please enter a package name');
      const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({ serviceId: String(i.serviceId), qty: int(i.qty || 1, 1, 999, 'Number of sessions') }));
      if (!items.length) throw bad('Add at least one service to the package');
      if (items.some((i) => !d().services.some((s) => s.id === i.serviceId))) throw bad('A selected service no longer exists');
      const priceAfter = money(b.priceAfter, 'Price after'), priceBefore = nullableMoney(b.priceBefore);
      return { name, description: str(b.description, 2000), images: imgs(b.images), priceBefore: priceBefore && priceBefore > priceAfter ? priceBefore : null, priceAfter, validityDays: int(b.validityDays, 0, 3650, 'Validity days'), items, unlimited: bool(b.unlimited, false), active: bool(b.active) };
    },
    inUse: (id) => d().orders.some((o) => o.lines.some((l) => l.type === 'package' && l.itemId === id)),
    after: (id) => { d().flashes.forEach((f) => { if (f.targetType === 'package' && f.targetId === id) f.active = false; }); },
  },
  flashes: {
    list: () => d().flashes, label: 'Promotion',
    validate(b) {
      const title = str(b.title, 120); if (!title) throw bad('Please enter a promotion title');
      if (!isDateTime(b.startAt) || !isDateTime(b.endAt)) throw bad('Please set the start and end date & time');
      if (b.endAt <= b.startAt) throw bad('The end time must be after the start time');
      const targetType = ['service', 'package'].includes(b.targetType) ? b.targetType : 'none';
      const targetId = targetType === 'none' ? null : String(b.targetId || '');
      if (targetType !== 'none' && !(targetType === 'service' ? d().services : d().packages).some((x) => x.id === targetId)) throw bad('Please choose the service or package for this offer');
      return { title, description: str(b.description, 600), image: imgs([b.image])[0] || '', startAt: b.startAt, endAt: b.endAt, targetType, targetId, flashPrice: targetType === 'none' ? null : nullableMoney(b.flashPrice), active: bool(b.active) };
    },
    inUse: () => false,
  },
  vouchers: {
    list: () => d().vouchers, label: 'Voucher',
    validate(b, id) {
      const code = str(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (code.length < 3) throw bad('Voucher code needs at least 3 letters or numbers');
      if (d().vouchers.some((v) => v.code === code && v.id !== id)) throw bad('This voucher code already exists');
      const type = b.type === 'percent' ? 'percent' : 'amount';
      const value = money(b.value, 'Value'); if (!(value > 0)) throw bad('Voucher value must be more than 0');
      if (type === 'percent' && value > 100) throw bad('Percentage cannot exceed 100');
      const scope = b.scope === 'specific' ? 'specific' : 'all';
      const customerIds = scope === 'specific' ? (Array.isArray(b.customerIds) ? b.customerIds : []).filter((c) => d().users.some((u) => u.id === c && u.role === 'customer')) : [];
      if (scope === 'specific' && !customerIds.length) throw bad('Choose at least one customer for this voucher');
      const startDate = b.startDate ? (isDate(b.startDate) ? b.startDate : (() => { throw bad('Invalid start date'); })()) : '';
      const endDate = b.endDate ? (isDate(b.endDate) ? b.endDate : (() => { throw bad('Invalid end date'); })()) : '';
      if (startDate && endDate && endDate < startDate) throw bad('End date must be after the start date');
      return { code, title: str(b.title, 100) || code, description: str(b.description, 300), type, value, minSpend: money(b.minSpend || 0, 'Minimum spend'), maxDiscount: money(b.maxDiscount || 0, 'Maximum discount'), startDate, endDate, scope, customerIds, appliesTo: ['service', 'package'].includes(b.appliesTo) ? b.appliesTo : 'all', perCustomerLimit: int(b.perCustomerLimit == null || b.perCustomerLimit === '' ? 1 : b.perCustomerLimit, 0, 999, 'Uses per customer'), totalLimit: int(b.totalLimit || 0, 0, 100000, 'Total uses'), active: bool(b.active) };
    },
    inUse: (id) => d().orders.some((o) => o.voucherId === id),
  },
};
for (const [name, c] of Object.entries(COLL)) {
  route('GET', `/api/admin/${name}`, OWNER, () => {
    const rows = c.list().slice();
    if (name === 'vouchers') return { items: rows.map((v) => ({ ...v, used: L.voucherUsage(v, '').total })) };
    if (name === 'flashes') return { items: rows.map(L.flashView) };
    return { items: rows.sort((a, b) => (a.sort || 0) - (b.sort || 0)) };
  });
  route('POST', `/api/admin/${name}`, OWNER, mutates(({ body }) => {
    const item = { id: uid(), createdAt: Date.now(), ...c.validate(body, null) };
    if (name === 'services' || name === 'packages') item.sort = Math.max(0, ...c.list().map((x) => x.sort || 0)) + 10;
    c.list().push(item);
    return { item };
  }));
  route('PUT', `/api/admin/${name}/:id`, OWNER, mutates(({ params, body }) => {
    const it = c.list().find((x) => x.id === params.id);
    if (!it) throw new HttpError(404, c.label + ' not found');
    Object.assign(it, c.validate(body, it.id));
    return { item: it };
  }));
  route('DELETE', `/api/admin/${name}/:id`, OWNER, mutates(({ params }) => {
    const list = c.list(), i = list.findIndex((x) => x.id === params.id);
    if (i < 0) throw new HttpError(404, c.label + ' not found');
    if (c.inUse(params.id)) { list[i].active = false; return { archived: true }; }
    list.splice(i, 1);
    if (c.after) c.after(params.id);
    return { deleted: true };
  }));
}

// ================= admin: staff =================
function validWeekly(w) {
  const out = {};
  for (let i = 0; i < 7; i++) {
    const arr = ((w || {})[i] || []).slice(0, 3);
    out[i] = arr.filter((r) => r && r.s && r.e).map((r) => {
      if (!isTime(r.s) || !isTime(r.e) || toMin(r.e) <= toMin(r.s)) throw bad('Working hours: end time must be after start time');
      return { s: r.s, e: r.e };
    });
  }
  return out;
}
const staffOut = (u) => ({ ...L.pubUser(u), active: u.active !== false, skills: u.skills || [], weekly: u.weekly || {}, overrides: u.overrides || {} });
route('GET', '/api/admin/staff', OWNER, () => ({ items: d().users.filter((u) => u.role === 'beautician').map(staffOut) }));
function staffFields(b, id) {
  const name = str(b.name, 80), phone = U.normPhone(b.phone), email = U.normEmail(b.email);
  if (!name) throw bad('Please enter the beautician name');
  if (phone.length < 9) throw bad('Please enter a valid contact number');
  if (d().users.some((u) => u.id !== id && u.phone === phone)) throw bad('That contact number is already used by another account');
  if (email && d().users.some((u) => u.id !== id && u.email === email)) throw bad('That email is already used by another account');
  const skills = (Array.isArray(b.skills) ? b.skills : []).filter((sid) => d().services.some((s) => s.id === sid));
  return { name, phone, email, skills, weekly: validWeekly(b.weekly), active: bool(b.active) };
}
route('POST', '/api/admin/staff', OWNER, mutates(({ body }) => {
  const f = staffFields(body, null);
  if (String(body.password || '').length < 6) throw bad('Please set a password of at least 6 characters');
  const u = { id: uid(), role: 'beautician', createdAt: Date.now(), overrides: {}, passHash: U.hashPassword(String(body.password)), ...f };
  d().users.push(u);
  return { item: staffOut(u) };
}));
route('PUT', '/api/admin/staff/:id', OWNER, mutates(({ params, body }) => {
  const u = d().users.find((x) => x.id === params.id && x.role === 'beautician');
  if (!u) throw new HttpError(404, 'Beautician not found');
  Object.assign(u, staffFields(body, u.id));
  if (body.password) { if (String(body.password).length < 6) throw bad('Password must be at least 6 characters'); u.passHash = U.hashPassword(String(body.password)); }
  return { item: staffOut(u) };
}));
route('DELETE', '/api/admin/staff/:id', OWNER, mutates(({ params }) => {
  const i = d().users.findIndex((x) => x.id === params.id && x.role === 'beautician');
  if (i < 0) throw new HttpError(404, 'Beautician not found');
  if (d().bookings.some((b) => b.beauticianId === params.id)) { d().users[i].active = false; return { archived: true }; }
  d().users.splice(i, 1);
  return { deleted: true };
}));
route('PUT', '/api/admin/staff/:id/day', OWNER, mutates(({ params, body }) => {
  const u = d().users.find((x) => x.id === params.id && x.role === 'beautician');
  if (!u) throw new HttpError(404, 'Beautician not found');
  if (!isDate(body.date)) throw bad('Invalid date');
  u.overrides = u.overrides || {};
  if (body.mode === 'default') delete u.overrides[body.date];
  else if (body.mode === 'off') u.overrides[body.date] = { off: true };
  else if (body.mode === 'custom') { const w = validWeekly({ 0: body.ranges }); if (!w[0].length) throw bad('Enter the working hours'); u.overrides[body.date] = { ranges: w[0] }; }
  else throw bad('Invalid option');
  return { ok: true };
}));

// ================= admin: studio calendar =================
route('PUT', '/api/admin/studio-day', OWNER, mutates(({ body }) => {
  if (!isDate(body.date)) throw bad('Invalid date');
  const st = d().settings; st.studioOverrides = st.studioOverrides || {};
  if (body.mode === 'default') delete st.studioOverrides[body.date];
  else if (body.mode === 'closed') st.studioOverrides[body.date] = { closed: true };
  else if (body.mode === 'custom') { const w = validWeekly({ 0: body.ranges }); if (!w[0].length) throw bad('Enter the opening hours'); st.studioOverrides[body.date] = { ranges: w[0] }; }
  else throw bad('Invalid option');
  return { ok: true };
}));
route('GET', '/api/admin/calendar', OWNER, ({ query }) => {
  const month = /^\d{4}-\d{2}$/.test(query.month) ? query.month : nowMY().date.slice(0, 7);
  const days = [], first = month + '-01';
  for (let i = 0; i < 31; i++) {
    const date = addDays(first, i); if (date.slice(0, 7) !== month) break;
    const bks = d().bookings.filter((b) => b.date === date && L.BOOKED.includes(b.status));
    days.push({ date, open: L.studioRanges(date).length > 0, override: !!(d().settings.studioOverrides || {})[date], bookings: bks.length, pending: bks.filter((b) => b.status === 'pending').length });
  }
  return { month, days };
});
route('GET', '/api/admin/day', OWNER, ({ query }) => {
  if (!isDate(query.date)) throw bad('Invalid date');
  const date = query.date, st = d().settings;
  const fmt = (rs) => rs.map((r) => ({ s: U.fromMin(r.s), e: U.fromMin(r.e) }));
  return {
    date, studio: { ranges: fmt(L.studioRanges(date)), override: (st.studioOverrides || {})[date] || null },
    staff: d().users.filter((u) => u.role === 'beautician' && u.active !== false).map((u) => ({ id: u.id, name: u.name, ranges: fmt(L.staffRanges(u, date)), override: (u.overrides || {})[date] || null })),
    bookings: d().bookings.filter((b) => b.date === date && b.status !== 'rejected' && b.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start)).map(L.bookingView),
  };
});

// ================= admin: bookings =================
route('GET', '/api/admin/bookings', OWNER, ({ query }) => {
  let rows = d().bookings.slice();
  if (isDate(query.from)) rows = rows.filter((b) => b.date >= query.from);
  if (isDate(query.to)) rows = rows.filter((b) => b.date <= query.to);
  if (query.status) rows = rows.filter((b) => b.status === query.status);
  if (query.beauticianId) rows = rows.filter((b) => b.beauticianId === query.beauticianId);
  rows.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { bookings: rows.map(L.bookingView) };
});
route('POST', '/api/admin/bookings', OWNER, mutates(({ user, body }) => {
  const cust = d().users.find((u) => u.id === body.customerId && u.role === 'customer');
  if (!cust) throw bad('Please choose a customer');
  const b = L.makeBooking({ customer: cust, entitlementId: body.entitlementId, mode: body.mode, date: body.date, start: body.start, beauticianId: body.beauticianId || null, contact: body.contact || { name: cust.name, phone: cust.phone, address: cust.address, area: cust.area }, byOwner: true, byName: user.name });
  b.status = 'confirmed'; b.log.push({ at: Date.now(), by: user.name, text: 'Booked by owner and confirmed' });
  return { booking: L.bookingView(b) };
}));
route('POST', '/api/admin/bookings/:id/action', OWNER, mutates(({ user, params, body }) => {
  const b = d().bookings.find((x) => x.id === params.id);
  if (!b) throw new HttpError(404, 'Booking not found');
  const log = (t) => b.log.push({ at: Date.now(), by: user.name, text: t });
  switch (body.action) {
    case 'approve':
      if (b.status !== 'pending') throw bad('Only pending bookings can be approved');
      if (body.beauticianId || body.date || body.start) L.moveBooking(b, body, user.name);
      b.status = 'confirmed'; log('Approved'); break;
    case 'reschedule':
      if (!['pending', 'confirmed'].includes(b.status)) throw bad('This booking can no longer be changed');
      L.moveBooking(b, body, user.name); break;
    case 'reject':
      if (b.status !== 'pending') throw bad('Only pending bookings can be rejected');
      b.status = 'rejected'; b.reason = str(body.reason, 200); log('Rejected' + (b.reason ? ': ' + b.reason : '')); break;
    case 'cancel':
      if (!['pending', 'confirmed'].includes(b.status)) throw bad('This booking can no longer be cancelled');
      b.status = 'cancelled'; b.reason = str(body.reason, 200); log('Cancelled by owner' + (b.reason ? ': ' + b.reason : '')); break;
    case 'complete': L.completeBooking(b, user.name); break;
    case 'noshow':
      if (b.status !== 'confirmed') throw bad('Only confirmed bookings can be marked as no-show');
      b.status = 'no_show'; log('Marked as no-show (session not deducted)'); break;
    default: throw bad('Unknown action');
  }
  return { booking: L.bookingView(b) };
}));

// ================= admin: customers =================
function customerRow(u) {
  const ents = d().entitlements.filter((e) => e.customerId === u.id).map(L.entView);
  return { ...L.pubUser(u), active: u.active !== false, createdAt: u.createdAt, points: L.pointsBalance(u.id), activePackages: ents.filter((e) => e.state === 'active').length, orders: d().orders.filter((o) => o.customerId === u.id && o.status !== 'cancelled').length };
}
route('GET', '/api/admin/customers', OWNER, ({ query }) => {
  const q = str(query.q, 60).toLowerCase();
  let rows = d().users.filter((u) => u.role === 'customer');
  if (q) rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.phone.includes(q.replace(/\D/g, '') || '@@') || (u.email || '').toLowerCase().includes(q));
  return { items: rows.sort((a, b) => b.createdAt - a.createdAt).map(customerRow) };
});
route('POST', '/api/admin/customers', OWNER, mutates(({ body }) => {
  const name = str(body.name, 80), phone = U.normPhone(body.phone), email = U.normEmail(body.email);
  if (!name) throw bad('Please enter the customer name');
  if (phone.length < 9) throw bad('Please enter a valid contact number');
  if (d().users.some((u) => u.phone === phone)) throw bad('This contact number is already registered');
  if (email && d().users.some((u) => u.email === email)) throw bad('This email is already registered');
  const pw = String(body.password || '');
  if (pw.length < 6) throw bad('Please set a password of at least 6 characters (tell the customer)');
  const u = { id: uid(), role: 'customer', name, phone, email, passHash: U.hashPassword(pw), active: true, createdAt: Date.now(), address: str(body.address, 300), area: str(body.area, 80) };
  d().users.push(u);
  return { item: customerRow(u) };
}));
route('GET', '/api/admin/customers/:id', OWNER, ({ params }) => {
  const u = d().users.find((x) => x.id === params.id && x.role === 'customer');
  if (!u) throw new HttpError(404, 'Customer not found');
  const s = d();
  return {
    customer: customerRow(u),
    entitlements: s.entitlements.filter((e) => e.customerId === u.id).map(L.entView).sort((a, b) => b.createdAt - a.createdAt),
    orders: s.orders.filter((o) => o.customerId === u.id).sort((a, b) => b.createdAt - a.createdAt).map(L.orderView),
    bookings: s.bookings.filter((b) => b.customerId === u.id).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).map(L.bookingView),
    ledger: s.points.filter((p) => p.customerId === u.id).sort((a, b) => b.at - a.at).slice(0, 50),
    vouchers: L.entitledVouchers(u),
  };
});
route('PUT', '/api/admin/customers/:id', OWNER, mutates(({ params, body }) => {
  const u = d().users.find((x) => x.id === params.id && x.role === 'customer');
  if (!u) throw new HttpError(404, 'Customer not found');
  const name = str(body.name, 80), phone = U.normPhone(body.phone), email = U.normEmail(body.email);
  if (!name) throw bad('Please enter the customer name');
  if (phone.length < 9) throw bad('Please enter a valid contact number');
  if (d().users.some((x) => x.id !== u.id && x.phone === phone)) throw bad('That contact number is used by another account');
  if (email && d().users.some((x) => x.id !== u.id && x.email === email)) throw bad('That email is used by another account');
  Object.assign(u, { name, phone, email, address: str(body.address, 300), area: str(body.area, 80), active: bool(body.active) });
  if (body.password) { if (String(body.password).length < 6) throw bad('Password must be at least 6 characters'); u.passHash = U.hashPassword(String(body.password)); }
  return { item: customerRow(u) };
}));
route('POST', '/api/admin/customers/:id/points', OWNER, mutates(({ user, params, body }) => {
  const u = d().users.find((x) => x.id === params.id && x.role === 'customer');
  if (!u) throw new HttpError(404, 'Customer not found');
  const delta = round2(num(body.delta, 0));
  if (!delta) throw bad('Enter the points to add (or a negative number to deduct)');
  if (L.pointsBalance(u.id) + delta < -0.0001) throw bad('That would make the balance negative');
  L.addPoints(u.id, delta, 'adjust', str(body.note, 120) || `Adjusted by ${user.name}`);
  return { points: L.pointsBalance(u.id) };
}));

// ================= admin: orders & payments =================
route('GET', '/api/admin/orders', OWNER, ({ query }) => {
  let rows = d().orders.slice();
  if (query.status) rows = rows.filter((o) => o.status === query.status);
  return { items: rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map((o) => { const u = d().users.find((x) => x.id === o.customerId); return { ...L.orderView(o), customerName: u ? u.name : '?', customerPhone: u ? u.phone : '' }; }) };
});
route('POST', '/api/admin/orders', OWNER, mutates(({ user, body }) => {
  const cust = d().users.find((u) => u.id === body.customerId && u.role === 'customer');
  if (!cust) throw bad('Please choose a customer');
  const p = L.priceOrder(cust, body.lines, { points: 0 });
  if (body.priceOverride !== '' && body.priceOverride != null) { // owner can agree a special total
    const t = money(body.priceOverride, 'Price');
    p.total = t; p.subtotal = Math.max(p.subtotal, t); p.voucher = null; p.voucherDiscount = 0; p.depositRequired = 0; p.depositPercent = 0;
  }
  const start = body.startDate && isDate(body.startDate) ? body.startDate : nowMY().date;
  const o = L.createOrder(cust, p, { source: 'manual', startDate: start, createdBy: user.id });
  if (bool(body.markPaid, false) && o.status !== 'paid') {
    d().payments.push({ id: uid(), customerId: cust.id, kind: 'order', refId: o.id, amount: o.total, file: null, method: str(body.method, 30) || 'cash', note: 'Recorded by owner', status: 'confirmed', createdAt: Date.now(), confirmedAt: Date.now(), confirmedBy: user.name });
    L.refreshOrder(o);
  }
  return { order: L.orderView(o) };
}));
route('POST', '/api/admin/orders/:id/payments', OWNER, mutates(({ user, params, body }) => {
  const o = d().orders.find((x) => x.id === params.id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status === 'cancelled') throw bad('Order is cancelled');
  const amount = round2(num(body.amount, 0));
  if (!(amount > 0)) throw bad('Enter the amount received');
  d().payments.push({ id: uid(), customerId: o.customerId, kind: 'order', refId: o.id, amount, file: null, method: str(body.method, 30) || 'cash', note: str(body.note, 200) || 'Recorded by owner', status: 'confirmed', createdAt: Date.now(), confirmedAt: Date.now(), confirmedBy: user.name });
  L.refreshOrder(o);
  return { order: L.orderView(o) };
}));
route('POST', '/api/admin/orders/:id/cancel', OWNER, mutates(({ user, params }) => {
  const o = d().orders.find((x) => x.id === params.id);
  if (!o) throw new HttpError(404, 'Order not found');
  L.cancelOrder(o, user.name);
  return { order: L.orderView(o) };
}));
route('GET', '/api/admin/payments', OWNER, ({ query }) => {
  let rows = d().payments.slice();
  if (query.status) rows = rows.filter((p) => p.status === query.status);
  return {
    items: rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map((p) => {
      const u = d().users.find((x) => x.id === p.customerId);
      const ref = p.kind === 'order' ? d().orders.find((o) => o.id === p.refId) : d().bookings.find((b) => b.id === p.refId);
      return { ...L.paymentView(p), customerName: u ? u.name : '?', customerPhone: u ? u.phone : '', refNo: ref ? ref.no : '?', refTotal: ref ? (p.kind === 'order' ? ref.total : ref.homeFee) : 0 };
    }),
  };
});
route('POST', '/api/admin/payments/:id', OWNER, mutates(({ user, params, body }) => {
  const p = d().payments.find((x) => x.id === params.id);
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.status !== 'pending') throw bad('This payment was already reviewed');
  if (body.action === 'confirm') { p.status = 'confirmed'; p.confirmedAt = Date.now(); p.confirmedBy = user.name; }
  else if (body.action === 'reject') { p.status = 'rejected'; p.reason = str(body.reason, 200); }
  else throw bad('Unknown action');
  if (p.kind === 'order') { const o = d().orders.find((x) => x.id === p.refId); if (o) L.refreshOrder(o); }
  return { ok: true };
}));

// ================= admin: settings, stats, upload =================
route('GET', '/api/admin/settings', OWNER, () => ({ settings: d().settings }));
route('PUT', '/api/admin/settings', OWNER, mutates(({ body }) => {
  const st = d().settings, b = body;
  const areas = (Array.isArray(b.homeAreas) ? b.homeAreas : String(b.homeAreas || '').split(/[\n,]/)).map((x) => str(x, 60)).filter(Boolean).slice(0, 60);
  const bank = b.bank || {};
  Object.assign(st, {
    studioName: str(b.studioName, 80) || st.studioName, phone: str(b.phone, 30), whatsapp: str(b.whatsapp, 20).replace(/\D/g, ''), address: str(b.address, 300),
    studioEnabled: bool(b.studioEnabled), homeEnabled: bool(b.homeEnabled), homeFee: money(b.homeFee, 'Home service fee'), homeAreas: areas,
    homeTravelMin: int(b.homeTravelMin, 0, 240, 'Travel time (minutes)'), studioWeekly: validWeekly(b.studioWeekly),
    slotStepMin: [15, 30, 60].includes(Number(b.slotStepMin)) ? Number(b.slotStepMin) : 30, minLeadHours: int(b.minLeadHours, 0, 168, 'Minimum notice (hours)'),
    maxAdvanceDays: int(b.maxAdvanceDays, 1, 365, 'Booking window (days)'), cancelHours: int(b.cancelHours, 0, 168, 'Cancellation notice (hours)'),
    depositPercent: int(b.depositPercent, 0, 100, 'Deposit %'), pointsEarnPerRM: int(b.pointsEarnPerRM, 1, 100000, 'Spend per point'), pointValueRM: money(b.pointValueRM, 'Point value'),
    gamePoints: round2(Math.max(0, num(b.gamePoints, 0.01))), bank: { bankName: str(bank.bankName, 80), accountNo: str(bank.accountNo, 40), accountName: str(bank.accountName, 80), instructions: str(bank.instructions, 500) },
  });
  return { settings: st };
}));
route('POST', '/api/admin/owner-password', OWNER, mutates(({ user, body }) => {
  if (!U.checkPassword(body.current, user.passHash)) throw bad('Your current password is incorrect');
  if (String(body.password || '').length < 6) throw bad('New password must be at least 6 characters');
  user.passHash = U.hashPassword(String(body.password));
  return { ok: true };
}));
route('GET', '/api/admin/stats', OWNER, () => {
  const s = d(), now = nowMY(), month = now.date.slice(0, 7);
  const revenueMonth = round2(s.payments.filter((p) => p.status === 'confirmed' && nowMY(p.confirmedAt || p.createdAt).date.startsWith(month)).reduce((a, p) => a + p.amount, 0));
  return {
    today: now.date,
    todayBookings: s.bookings.filter((b) => b.date === now.date && ['pending', 'confirmed', 'completed'].includes(b.status)).length,
    pendingApprovals: s.bookings.filter((b) => b.status === 'pending').length,
    pendingPayments: s.payments.filter((p) => p.status === 'pending').length,
    customers: s.users.filter((u) => u.role === 'customer').length,
    activeEntitlements: s.entitlements.map(L.entView).filter((e) => e.state === 'active').length,
    revenueMonth,
    upcoming: s.bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && (b.date + b.start) >= (now.date + now.time)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 8).map(L.bookingView),
  };
});
route('POST', '/api/admin/upload', OWNER, mutates(({ body }) => ({ url: '/uploads/' + saveDataUrl(body.image, S.UPLOADS) })));

// ------------------------------------------------------------------ server
function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  let file;
  if (rel.startsWith('/uploads/')) file = path.join(S.UPLOADS, path.basename(rel));
  else { file = path.normalize(path.join(PUBLIC_DIR, rel)); if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); } }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/uploads/') ? 'public, max-age=86400' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, pathname);
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : (pathname.startsWith('/api/receipt/') ? url.searchParams.get('t') || '' : '');
      const user = token ? userFromToken(token) : null;
      if (r.roles && !user) throw new HttpError(401, 'Please log in');
      if (r.roles && !r.roles.includes(user.role)) throw new HttpError(403, 'You do not have access to this');
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const out = await r.fn({ req, res, user, token, params: { ...m.groups }, query: Object.fromEntries(url.searchParams), body, ip: req.socket.remoteAddress || '' });
      if (out === undefined) return undefined;
      return sendJson(res, 200, out);
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    return sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Fubao Beauty portal running:\n  Customer app  http://localhost:${PORT}/\n  Owner portal  http://localhost:${PORT}/admin   (owner login: 0182530288 / fubao1234 - change it in Settings)`);
  });
}
module.exports = server;
