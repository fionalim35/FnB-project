'use strict';
/**
 * Service Appointment Platform - zero-dependency Node.js server (multi-business).
 *   /shop/<slug>  -> customer app (one link per business)
 *   /admin        -> business administrator portal (desktop)
 *   /super        -> super administrator portal (iPad)
 */
process.env.TZ = process.env.TZ || 'Asia/Kuala_Lumpur'; // all slot / reminder maths use this zone
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3100;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CFG = {
  superPassword: process.env.SUPER_PASSWORD || 'super123',
  countryCode: process.env.DEFAULT_COUNTRY_CODE || '60',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  waToken: process.env.WHATSAPP_TOKEN || '',
  waPhoneId: process.env.WHATSAPP_PHONE_ID || '',
  waTemplate: process.env.WHATSAPP_TEMPLATE || '',
  waLang: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
  resendKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  bpKey: process.env.BILLPLZ_API_KEY || '',
  bpCollection: process.env.BILLPLZ_COLLECTION_ID || '',
  bpSignKey: process.env.BILLPLZ_XSIGNATURE_KEY || '',
  bpSandbox: process.env.BILLPLZ_SANDBOX === '1',
};
fs.mkdirSync(UP_DIR, { recursive: true });
const billplzLive = () => !!(CFG.bpKey && CFG.bpCollection && CFG.bpSignKey && CFG.publicUrl);

// ---------------------------------------------------------------- helpers
const uid = () => crypto.randomBytes(6).toString('hex');
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseDate(s)) === s;
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m || +m[1] > 23 || +m[2] > 59) throw bad('Invalid time');
  return +m[1] * 60 + +m[2];
};
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const need = (v, msg) => { if (!v) throw bad(msg); return v; };
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const money = (v) => { const n = num(v, NaN); if (!(n >= 0) || n > 100000) throw bad('Invalid price'); return round2(n); };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function hashPw(pw) {
  const salt = crypto.randomBytes(12).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pw), salt, 32).toString('hex')}`;
}
function checkPw(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(String(pw), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- database
let db;
function defaultSettings() {
  const on = { on: true, start: '10:00', end: '19:00' };
  return {
    slotMinutes: 30, leadMinutes: 60, holdMinutes: 10, maxDaysAhead: 30, pointsPerRM: 1,
    reminderHour: 9, reminderWhatsapp: true, reminderEmail: true, closedDates: [],
    week: [{ on: false, start: '10:00', end: '19:00' }, on, on, on, on, on, on], // Sun..Sat
    charges: [],
  };
}
function seedBusiness(d) {
  const biz = {
    id: uid(), slug: d.slug, name: d.name, industry: d.industry, about: d.about, photo: '', phone: d.phone, address: d.address,
    adminUser: d.adminUser, adminPass: hashPw(d.adminPass), active: true, createdAt: Date.now(), settings: defaultSettings(),
  };
  biz.settings.charges = [
    { id: uid(), name: 'Service charge', type: 'percent', value: 10, active: true },
    { id: uid(), name: 'SST', type: 'percent', value: 8, active: true },
  ];
  db.businesses.push(biz);
  const cats = {};
  d.cats.forEach(([name, icon], i) => { const c = { id: uid(), bizId: biz.id, name, icon, active: true, sort: (i + 1) * 10 }; cats[name] = c; db.categories.push(c); });
  const items = {};
  let sort = 0;
  const promoTo = addDays(today(), 30);
  for (const [name, cat, price, dur, desc, flags = {}] of d.items) {
    const it = {
      id: uid(), bizId: biz.id, categoryId: cat ? cats[cat].id : null, name, description: desc, price, durationMin: dur,
      promoPrice: flags.promo || null, promoFrom: flags.promo ? today() : '', promoTo: flags.promo ? promoTo : '',
      images: [], recommended: !!flags.rec, topPick: !!flags.top, active: true, areaIds: [], groups: [], sort: (sort += 10),
    };
    items[name] = it; db.items.push(it);
  }
  for (const [name, groups] of Object.entries(d.groups)) {
    items[name].groups = groups.map(([gname, required, max, opts]) => ({
      id: uid(), name: gname, required, max,
      options: opts.map(([iname, price]) => ({ id: uid(), itemId: items[iname].id, name: iname, price })),
    }));
  }
  const shop = { id: uid(), bizId: biz.id, type: 'shop', name: d.shop[0], address: d.shop[1], fee: 0, active: true };
  const home = { id: uid(), bizId: biz.id, type: 'home', name: d.home[0], address: '', fee: d.home[1], active: true };
  db.areas.push(shop, home);
  for (const [name, phone, skills] of d.staff) {
    db.staff.push({
      id: uid(), bizId: biz.id, name, phone, email: '', serviceIds: skills.map((s) => items[s].id), workDays: [1, 2, 3, 4, 5, 6],
      start: '', end: '', offDates: [], active: true,
    });
  }
  return biz;
}
function seed() {
  db = {
    secret: crypto.randomBytes(32).toString('hex'), superPass: hashPw(CFG.superPassword),
    businesses: [], categories: [], items: [], staff: [], areas: [], customers: [], orders: [], appts: [], vouchers: [], reviews: [], outbox: [],
  };
  seedBusiness({
    slug: 'glow', name: 'Glow Beauty Studio', industry: 'Beauty & Wellness', adminUser: 'glow', adminPass: 'admin123',
    about: 'Facials, hair, nails and massage by certified therapists - in our studio or at your home.', phone: '+60123456789', address: '12 Jalan Maarof, Bangsar, Kuala Lumpur',
    cats: [['Facial', '✨'], ['Hair', '✂️'], ['Nails', '💅'], ['Massage', '💆']],
    items: [
      ['Hydrating Facial', 'Facial', 120, 60, 'Deep hydration facial with cleansing, exfoliation, mask and moisturising massage.', { rec: true, top: true }],
      ['Deep Cleansing Facial', 'Facial', 150, 75, 'Extraction-focused facial for congested skin, finished with a soothing mask.', { promo: 129 }],
      ['Haircut & Styling', 'Hair', 60, 45, 'Consultation, wash, precision cut and blow-dry styling.'],
      ['Hair Colouring', 'Hair', 220, 120, 'Full head colour with premium ammonia-free products.', { rec: true }],
      ['Gel Manicure', 'Nails', 80, 60, 'Nail shaping, cuticle care and long-lasting gel polish.', { top: true }],
      ['Pedicure Spa', 'Nails', 90, 60, 'Foot soak, scrub, callus care and polish.'],
      ['Full Body Massage', 'Massage', 160, 90, 'Relaxing aromatherapy massage to release tension from head to toe.', { rec: true }],
      ['Eye Treatment', null, 35, 15, 'Cooling eye mask and lymphatic massage.'],
      ['Shoulder Massage', null, 30, 15, 'Extra 15-minute shoulder & neck massage.'],
      ['Hair Treatment', null, 45, 20, 'Deep conditioning scalp and hair treatment.'],
      ['Nail Art', null, 25, 15, 'Hand-painted nail design (per hand).'],
    ],
    groups: {
      'Hydrating Facial': [['Extra ADD ON', false, 0, [['Eye Treatment', 28], ['Shoulder Massage', 25]]]],
      'Haircut & Styling': [['Treatment', false, 1, [['Hair Treatment', 39]]]],
      'Hair Colouring': [['Hair Treatment (compulsory)', true, 1, [['Hair Treatment', 30]]]],
      'Gel Manicure': [['Design', false, 1, [['Nail Art', 20]]]],
    },
    shop: ['Glow Studio - Bangsar', '12 Jalan Maarof, Bangsar, Kuala Lumpur'], home: ['Klang Valley home visit', 20],
    staff: [
      ['Amy', '0111111111', ['Hydrating Facial', 'Deep Cleansing Facial', 'Full Body Massage']],
      ['Bella', '0122222222', ['Haircut & Styling', 'Hair Colouring']],
      ['Chloe', '0133333333', ['Gel Manicure', 'Pedicure Spa']],
      ['Dina', '0144444444', ['Hydrating Facial', 'Gel Manicure', 'Full Body Massage']],
    ],
  });
  seedBusiness({
    slug: 'paws', name: 'Paws & Claws Grooming', industry: 'Pet Grooming', adminUser: 'paws', adminPass: 'admin123',
    about: 'Gentle grooming for dogs and cats. Visit our shop or let our groomer come to your home.', phone: '+60198765432', address: '8 Jalan SS 2/24, Petaling Jaya',
    cats: [['Dog Grooming', '🐶'], ['Cat Grooming', '🐱'], ['Health & Spa', '🛁']],
    items: [
      ['Basic Bath (Small Dog)', 'Dog Grooming', 55, 60, 'Bath, blow-dry, ear cleaning and brushing for dogs under 8kg.', { rec: true }],
      ['Full Grooming (Medium Dog)', 'Dog Grooming', 110, 120, 'Bath, haircut, nail trim, ear cleaning and finishing spray.', { top: true }],
      ['Cat Grooming', 'Cat Grooming', 90, 90, 'Calm, low-stress bath and brush for cats.'],
      ['Bath + Nail Trim Combo', 'Health & Spa', 80, 75, 'Bundle: bath, blow-dry and nail trim.', { promo: 69, top: true }],
      ['Flea & Tick Treatment', 'Health & Spa', 70, 45, 'Medicated bath that removes fleas and ticks.'],
      ['Teeth Cleaning', null, 30, 15, 'Gentle teeth brushing and breath freshener.'],
      ['Nail Trimming', null, 15, 10, 'Safe nail trim and file.'],
    ],
    groups: {
      'Basic Bath (Small Dog)': [['Extras', false, 0, [['Teeth Cleaning', 25], ['Nail Trimming', 10]]]],
      'Full Grooming (Medium Dog)': [['Extras', false, 0, [['Teeth Cleaning', 25]]]],
    },
    shop: ['Paws Shop - Petaling Jaya', '8 Jalan SS 2/24, Petaling Jaya'], home: ['Home grooming (PJ & KL)', 25],
    staff: [
      ['Ken', '0155555555', ['Basic Bath (Small Dog)', 'Full Grooming (Medium Dog)', 'Bath + Nail Trim Combo', 'Flea & Tick Treatment']],
      ['Lily', '0166666666', ['Basic Bath (Small Dog)', 'Cat Grooming', 'Bath + Nail Trim Combo']],
    ],
  });
  return db;
}
function loadDb() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { seed(); saveNow(); }
}
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function save() { if (!saveTimer) saveTimer = setTimeout(saveNow, 150); }
process.on('SIGINT', () => { if (saveTimer) saveNow(); process.exit(0); });
process.on('SIGTERM', () => { if (saveTimer) saveNow(); process.exit(0); });

// ---------------------------------------------------------------- auth (signed tokens survive restarts)
function sign(payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', db.secret).update(body).digest('base64url')}`;
}
function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const exp = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  if (mac.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function authOf(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return m ? verify(m[1]) : null;
}
const loginFails = new Map();
function throttle(key) {
  const f = loginFails.get(key);
  if (f && f.n >= 8 && Date.now() - f.t < 10 * 60 * 1000) throw new HttpError(429, 'Too many attempts. Please try again in a few minutes.');
}
function failed(key) { const f = loginFails.get(key) || { n: 0 }; loginFails.set(key, { n: f.n + 1, t: Date.now() }); }

// ---------------------------------------------------------------- lookups & pricing
const bizById = (id) => db.businesses.find((b) => b.id === id);
const itemById = (id) => db.items.find((i) => i.id === id);
const catById = (id) => db.categories.find((c) => c.id === id);
const staffById = (id) => db.staff.find((s) => s.id === id);
const custById = (id) => db.customers.find((c) => c.id === id);
const orderById = (id) => db.orders.find((o) => o.id === id);
const promoActive = (it, d = today()) => it.promoPrice != null && it.promoPrice < it.price && (!it.promoFrom || d >= it.promoFrom) && (!it.promoTo || d <= it.promoTo);
const effPrice = (it, d) => (promoActive(it, d) ? it.promoPrice : it.price);
const mine = (arr, biz) => arr.filter((x) => x.bizId === biz.id);
const itemRating = (id) => {
  const rs = db.reviews.filter((r) => r.itemId === id);
  return { rating: rs.length ? round2(rs.reduce((s, r) => s + r.rating, 0) / rs.length) : 0, reviews: rs.length };
};
const optionOk = (o) => { const it = itemById(o.itemId); return !!it && it.active; };
function allowedAreas(biz, it) {
  return db.areas.filter((a) => a.bizId === biz.id && a.active && (!it.areaIds.length || it.areaIds.includes(a.id)));
}
function isListed(biz, it) {
  const c = it.categoryId && catById(it.categoryId);
  return it.bizId === biz.id && it.active && !!c && c.active;
}
function publicItem(biz, it, withNext) {
  const c = catById(it.categoryId);
  const areas = allowedAreas(biz, it);
  return {
    id: it.id, name: it.name, description: it.description, price: it.price, effPrice: effPrice(it), promo: promoActive(it), promoTo: it.promoTo,
    images: it.images, recommended: it.recommended, topPick: it.topPick, durationMin: it.durationMin, categoryId: it.categoryId,
    categoryName: c ? c.name : '', icon: c ? c.icon : '', areaTypes: [...new Set(areas.map((a) => a.type))], ...itemRating(it.id),
    nextAvailable: withNext ? nextAvailable(biz, it) : undefined,
  };
}

// ---------------------------------------------------------------- availability engine
const FINAL = new Set(['cancelled']);
const holdsLive = (a) => a.status !== 'hold' || a.holdUntil > Date.now();
const apptActive = (a) => !FINAL.has(a.status) && holdsLive(a);

function dayInfo(biz, date) {
  const w = biz.settings.week[parseDate(date).getDay()];
  if (!w || !w.on || biz.settings.closedDates.includes(date)) return null;
  return { start: toMin(w.start), end: toMin(w.end) };
}
function busyMap(bizId, date, exceptId) {
  const m = new Map();
  for (const a of db.appts) {
    if (a.bizId !== bizId || a.date !== date || a.id === exceptId || !apptActive(a)) continue;
    if (!m.has(a.staffId)) m.set(a.staffId, []);
    m.get(a.staffId).push({ s: a.startMin, e: a.endMin });
  }
  return m;
}
const isFree = (list, s, e) => !(list || []).some((x) => s < x.e && x.s < e);
function qualified(st, biz, it, date, s, e, info) {
  if (st.bizId !== biz.id || !st.active || !st.serviceIds.includes(it.id)) return false;
  if (st.workDays && !st.workDays.includes(parseDate(date).getDay())) return false;
  if ((st.offDates || []).includes(date)) return false;
  const a = st.start ? toMin(st.start) : info.start, b = st.end ? toMin(st.end) : info.end;
  return s >= Math.max(a, info.start) && e <= Math.min(b, info.end);
}
function pickStaff(biz, it, date, s, e, busy, info) {
  let best = null, load = Infinity;
  for (const st of db.staff) {
    if (!qualified(st, biz, it, date, s, e, info)) continue;
    const list = busy.get(st.id);
    if (!isFree(list, s, e)) continue;
    const l = (list || []).reduce((t, x) => t + x.e - x.s, 0);
    if (l < load) { best = st; load = l; }
  }
  return best;
}
function book(busy, staffId, s, e) { if (!busy.has(staffId)) busy.set(staffId, []); busy.get(staffId).push({ s, e }); }
function durationOf(it, optionIds) {
  let d = it.durationMin;
  for (const g of it.groups) for (const o of g.options) if ((optionIds || []).includes(o.id)) { const x = itemById(o.itemId); if (x) d += x.durationMin; }
  return d;
}
function dayState(biz, it, dur, date, pending) {
  const info = dayInfo(biz, date);
  const lastDay = addDays(today(), biz.settings.maxDaysAhead - 1);
  if (!info || date < today() || date > lastDay) return { closed: true, slots: [] };
  const busy = busyMap(biz.id, date);
  for (const p of pending || []) {
    if (p.date !== date) continue;
    const pi = itemById(p.itemId);
    if (!pi || pi.bizId !== biz.id || !p.time) continue;
    const ps = toMin(p.time), pe = ps + durationOf(pi, p.addons);
    const st = pickStaff(biz, pi, date, ps, pe, busy, info);
    if (st) book(busy, st.id, ps, pe);
  }
  const earliest = date === today() ? nowMin() + biz.settings.leadMinutes : 0;
  const slots = [];
  for (let t = info.start; t + dur <= info.end; t += biz.settings.slotMinutes) {
    slots.push({ time: fromMin(t), available: t >= earliest && !!pickStaff(biz, it, date, t, t + dur, busy, info) });
  }
  return { closed: false, slots };
}
function nextAvailable(biz, it) {
  for (let i = 0; i < biz.settings.maxDaysAhead; i++) {
    const d = addDays(today(), i);
    if (dayState(biz, it, it.durationMin, d).slots.some((s) => s.available)) return d;
  }
  return null;
}
function sweep() {
  const now = Date.now();
  let changed = false;
  for (const o of db.orders) {
    if (o.status === 'pending_payment' && o.holdUntil < now) {
      o.status = 'expired'; changed = true;
      for (const a of db.appts) if (a.orderId === o.id && a.status === 'hold') a.status = 'cancelled';
    }
  }
  if (changed) save();
}

// ---------------------------------------------------------------- quoting & orders
function validateLine(biz, raw) {
  const it = itemById(str(raw.itemId, 40));
  if (!it || !isListed(biz, it)) throw bad('This service is no longer available');
  const chosen = [...new Set(Array.isArray(raw.addons) ? raw.addons.map((x) => str(x, 40)) : [])];
  const addons = [];
  for (const g of it.groups) {
    const picks = g.options.filter((o) => chosen.includes(o.id));
    if (g.required && !picks.length) throw bad(`Please choose an option for "${g.name}" (${it.name})`);
    if (g.max > 0 && picks.length > g.max) throw bad(`Please choose at most ${g.max} for "${g.name}"`);
    for (const o of picks) {
      if (!optionOk(o)) throw bad(`"${o.name}" is no longer available`);
      addons.push({ optionId: o.id, itemId: o.itemId, name: itemById(o.itemId).name, group: g.name, price: o.price });
    }
  }
  if (chosen.length !== addons.length) throw bad('Invalid add-on selection');
  const area = db.areas.find((a) => a.id === raw.areaId);
  if (!area || area.bizId !== biz.id || !area.active || (it.areaIds.length && !it.areaIds.includes(area.id))) throw bad(`Please choose where to have "${it.name}"`);
  const address = str(raw.address, 300);
  if (area.type === 'home' && address.length < 8) throw bad('Please enter your full home address for home service');
  if (!isDate(raw.date)) throw bad(`Please choose a date for "${it.name}"`);
  if (raw.date < today() || raw.date > addDays(today(), biz.settings.maxDaysAhead - 1)) throw bad(`"${it.name}": date is outside the booking window`);
  if (!raw.time) throw bad(`Please choose a time slot for "${it.name}"`);
  const startMin = toMin(raw.time);
  const dur = durationOf(it, chosen);
  const price = round2(effPrice(it) + addons.reduce((s, a) => s + a.price, 0) + (area.type === 'home' ? area.fee : 0));
  return {
    itemId: it.id, name: it.name, image: it.images[0] || '', category: catById(it.categoryId).name, icon: catById(it.categoryId).icon,
    base: effPrice(it), addons, areaFee: area.type === 'home' ? area.fee : 0, price, durationMin: dur,
    areaId: area.id, areaName: area.name, areaType: area.type, address: area.type === 'home' ? address : area.address || '',
    date: raw.date, time: fromMin(startMin), startMin, endMin: startMin + dur, remark: str(raw.remark, 500),
  };
}
function voucherUsable(v, cust, orderId) {
  if (v.customerId !== cust.id || v.usedAt) return false;
  if (v.expiry && v.expiry < today()) return false;
  if (v.holdOrderId && v.holdOrderId !== orderId) { const o = orderById(v.holdOrderId); if (o && o.status === 'pending_payment') return false; }
  return true;
}
function voucherDiscount(v, subtotal) {
  return round2(Math.min(subtotal, v.type === 'percent' ? (subtotal * v.value) / 100 : v.value));
}
function quote(biz, cust, rawLines, orderId) {
  sweep();
  if (!Array.isArray(rawLines) || !rawLines.length) throw bad('Your cart is empty');
  if (rawLines.length > 20) throw bad('Too many items in one order');
  const lines = rawLines.map((r) => validateLine(biz, r));
  // simulate staff allocation so two cart items cannot depend on the same person at the same time
  const busyByDate = new Map();
  const order = lines.map((l, i) => i).sort((a, b) => (lines[a].date + lines[a].time).localeCompare(lines[b].date + lines[b].time));
  for (const i of order) {
    const l = lines[i], it = itemById(l.itemId);
    const info = dayInfo(biz, l.date);
    l.problem = '';
    if (!info) { l.problem = `We are closed on ${l.date}`; continue; }
    if (l.startMin < info.start || l.endMin > info.end || (l.startMin - info.start) % biz.settings.slotMinutes) { l.problem = 'This time is outside opening hours'; continue; }
    if (l.date === today() && l.startMin < nowMin() + biz.settings.leadMinutes) { l.problem = 'This time is too soon - please pick a later slot'; continue; }
    if (!busyByDate.has(l.date)) busyByDate.set(l.date, busyMap(biz.id, l.date));
    const busy = busyByDate.get(l.date);
    const st = pickStaff(biz, it, l.date, l.startMin, l.endMin, busy, info);
    if (!st) { l.problem = 'This slot has just been taken - please choose another time'; continue; }
    book(busy, st.id, l.startMin, l.endMin);
    l.staffId = st.id;
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.price, 0));
  let voucher = null, discount = 0;
  for (const v of db.vouchers) {
    if (!voucherUsable(v, cust, orderId)) continue;
    const d = voucherDiscount(v, subtotal);
    if (d > discount) { discount = d; voucher = v; }
  }
  const taxable = round2(subtotal - discount);
  const charges = biz.settings.charges.filter((c) => c.active).map((c) => ({
    id: c.id, name: c.name, type: c.type, value: c.value, amount: round2(c.type === 'percent' ? (taxable * c.value) / 100 : c.value),
  }));
  const total = round2(taxable + charges.reduce((s, c) => s + c.amount, 0));
  return {
    lines, subtotal, discount, voucher: voucher ? { id: voucher.id, code: voucher.code, type: voucher.type, value: voucher.value } : null,
    charges, total, points: Math.floor(total * biz.settings.pointsPerRM), ok: lines.every((l) => !l.problem),
  };
}
function nextOrderNo(biz) {
  const d = new Date();
  const day = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const n = db.orders.filter((o) => o.bizId === biz.id && o.no.startsWith(`A${day}`)).length + 1;
  return `A${day}-${String(n).padStart(3, '0')}`;
}
function createOrder(biz, cust, rawLines) {
  const q = quote(biz, cust, rawLines);
  const bad1 = q.lines.find((l) => l.problem);
  if (bad1) throw new HttpError(409, `${bad1.name} (${bad1.date} ${bad1.time}): ${bad1.problem}`);
  const o = {
    id: uid(), no: nextOrderNo(biz), bizId: biz.id, customerId: cust.id, apptIds: [], subtotal: q.subtotal, discount: q.discount,
    voucherId: q.voucher && q.voucher.id, voucherCode: q.voucher && q.voucher.code, charges: q.charges, total: q.total, points: q.points,
    status: 'pending_payment', createdAt: Date.now(), holdUntil: Date.now() + biz.settings.holdMinutes * 60000, payment: null,
  };
  for (const l of q.lines) {
    const a = { id: uid(), bizId: biz.id, orderId: o.id, customerId: cust.id, ...l, status: 'hold', holdUntil: o.holdUntil, createdAt: Date.now() };
    delete a.problem; delete a.icon;
    db.appts.push(a); o.apptIds.push(a.id);
  }
  if (q.voucher) db.vouchers.find((v) => v.id === q.voucher.id).holdOrderId = o.id;
  db.orders.push(o); save();
  return o;
}
// A customer can pay on the gateway after our slot hold lapsed. Try to put the slots back; if somebody else took them, keep the
// money flagged for refund instead of double-booking.
function reinstate(o) {
  const biz = bizById(o.bizId);
  const appts = db.appts.filter((a) => a.orderId === o.id);
  const busyByDate = new Map(), plan = [];
  for (const a of appts) {
    const info = dayInfo(biz, a.date), it = itemById(a.itemId);
    if (!info || !it) return false;
    if (!busyByDate.has(a.date)) busyByDate.set(a.date, busyMap(biz.id, a.date));
    const busy = busyByDate.get(a.date);
    const st = pickStaff(biz, it, a.date, a.startMin, a.endMin, busy, info);
    if (!st) return false;
    book(busy, st.id, a.startMin, a.endMin); plan.push([a, st.id]);
  }
  for (const [a, staffId] of plan) { a.staffId = staffId; a.status = 'hold'; a.holdUntil = Date.now() + 60000; }
  return true;
}
function confirmPayment(o, method, ref) {
  if (o.status === 'paid') return;
  const biz = bizById(o.bizId), cust = custById(o.customerId);
  const late = o.status !== 'pending_payment';
  if (late && !reinstate(o)) {
    o.status = 'paid'; o.needsRefund = true; o.payment = { method, ref, paidAt: Date.now() };
    save(); return; // appointments stay cancelled; the administrator sees a refund warning on the dashboard
  }
  o.status = 'paid';
  o.payment = { method, ref, paidAt: Date.now() };
  cust.points = (cust.points || 0) + o.points;
  for (const a of db.appts) if (a.orderId === o.id) { a.status = 'scheduled'; delete a.holdUntil; }
  if (o.voucherId) { const v = db.vouchers.find((x) => x.id === o.voucherId); if (v) { v.usedAt = Date.now(); v.usedOrderId = o.id; delete v.holdOrderId; } }
  save();
  for (const a of db.appts.filter((x) => x.orderId === o.id)) {
    notify(biz, cust, a, 'confirm').catch((e) => console.error('notify failed', e.message));
  }
}

// ---------------------------------------------------------------- Billplz (FPX / cards) gateway
const bpBase = () => (CFG.bpSandbox ? 'https://www.billplz-sandbox.com' : 'https://www.billplz.com');
function bpSignature(params) {
  const src = Object.keys(params).filter((k) => k !== 'x_signature').sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((k) => k + params[k]).join('|');
  return crypto.createHmac('sha256', CFG.bpSignKey).update(src).digest('hex');
}
async function createBill(biz, cust, o) {
  const form = new URLSearchParams({
    collection_id: CFG.bpCollection, email: cust.email, mobile: phoneIntl(cust.phone), name: cust.name, amount: String(Math.round(o.total * 100)),
    description: `${biz.name} booking ${o.no}`.slice(0, 200), callback_url: `${CFG.publicUrl}/api/payments/billplz/callback`,
    redirect_url: `${CFG.publicUrl}/shop/${biz.slug}/return?order=${o.id}`, reference_1_label: 'Order', reference_1: o.no,
  });
  const r = await fetch(`${bpBase()}/api/v3/bills`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(CFG.bpKey + ':').toString('base64') }, body: form });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id || !d.url) throw new HttpError(502, 'Payment gateway is unavailable right now. Please try again in a moment.');
  return { provider: 'billplz', billId: d.id, url: d.url };
}
function billplzCallback(params) {
  if (!billplzLive()) throw new HttpError(503, 'Billplz is not configured');
  const given = Buffer.from(String(params.x_signature || '')), want = Buffer.from(bpSignature(params));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(401, 'Bad signature');
  const o = db.orders.find((x) => x.gateway && x.gateway.billId === params.id);
  if (!o) throw new HttpError(404, 'Unknown bill');
  if (o.status === 'paid' || params.paid !== 'true') return { ok: true };
  if (Number(params.paid_amount) !== Math.round(o.total * 100)) throw bad('Amount mismatch');
  confirmPayment(o, 'billplz', params.id);
  return { ok: true };
}

// ---------------------------------------------------------------- notifications (WhatsApp + email)
function phoneIntl(p) {
  let d = String(p).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = CFG.countryCode + d.slice(1);
  return d;
}
const fmtDay = (s) => parseDate(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function fmt12(t) { const m = toMin(t); const h = Math.floor(m / 60); return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`; }
function messageFor(biz, cust, a, kind) {
  const where = a.areaType === 'home' ? `Home service at ${a.address}` : `In shop: ${a.areaName}${a.address ? ' (' + a.address + ')' : ''}`;
  const head = kind === 'confirm' ? `Hi ${cust.name}, your appointment is confirmed.` : `Hi ${cust.name}, a friendly reminder of your appointment tomorrow.`;
  const text = `${head}\n${a.name}${a.addons.length ? ' + ' + a.addons.map((x) => x.name).join(', ') : ''}\n${fmtDay(a.date)}, ${fmt12(a.time)}\n${where}\n${biz.name}${biz.phone ? ' - ' + biz.phone : ''}`;
  return { subject: kind === 'confirm' ? `Appointment confirmed - ${biz.name}` : `Reminder: your appointment tomorrow - ${biz.name}`, text };
}
async function sendWhatsApp(to, text, params) {
  const body = CFG.waTemplate
    ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: CFG.waTemplate, language: { code: CFG.waLang }, components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: t })) }] } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  const r = await fetch(`https://graph.facebook.com/v20.0/${CFG.waPhoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${CFG.waToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
async function sendEmail(to, subject, text) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${CFG.resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: CFG.emailFrom, to: [to], subject, text }),
  });
  if (!r.ok) throw new Error(`Email API ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
async function notify(biz, cust, a, kind) {
  const m = messageFor(biz, cust, a, kind);
  const channels = [];
  if (kind === 'confirm' || biz.settings.reminderWhatsapp) channels.push('whatsapp');
  if (kind === 'confirm' || biz.settings.reminderEmail) channels.push('email');
  for (const ch of channels) {
    const to = ch === 'whatsapp' ? phoneIntl(cust.phone) : cust.email;
    const row = { id: uid(), bizId: biz.id, apptId: a.id, kind, channel: ch, to, subject: m.subject, text: m.text, at: Date.now(), status: 'simulated', error: '' };
    try {
      if (ch === 'whatsapp' && CFG.waToken && CFG.waPhoneId) { await sendWhatsApp(to, m.text, [cust.name, a.name, fmtDay(a.date), fmt12(a.time), biz.name]); row.status = 'sent'; }
      else if (ch === 'email' && CFG.resendKey && CFG.emailFrom) { await sendEmail(to, m.subject, m.text); row.status = 'sent'; }
    } catch (e) { row.status = 'failed'; row.error = e.message; }
    db.outbox.push(row);
  }
  if (db.outbox.length > 5000) db.outbox.splice(0, db.outbox.length - 5000);
  if (kind === 'reminder') a.reminderAt = Date.now();
  save();
}
async function reminderTick() {
  sweep();
  const tomorrow = addDays(today(), 1), hour = new Date().getHours();
  for (const a of db.appts) {
    if (a.status !== 'scheduled' || a.date !== tomorrow || a.reminderAt) continue;
    const biz = bizById(a.bizId), cust = custById(a.customerId);
    if (!biz || !biz.active || !cust || hour < biz.settings.reminderHour) continue;
    a.reminderAt = Date.now(); // mark first so a slow provider cannot cause duplicates
    try { await notify(biz, cust, a, 'reminder'); } catch (e) { console.error('reminder failed', e.message); }
  }
}

// ---------------------------------------------------------------- statistics
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function bucketKey(period, d) {
  if (period === 'daily') return ymd(d);
  if (period === 'weekly') return ymd(weekStart(d));
  if (period === 'monthly') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return String(d.getFullYear());
}
function buckets(period, now) {
  const out = [];
  const y = now.getFullYear(), m = now.getMonth(), dd = now.getDate();
  if (period === 'daily') for (let i = 29; i >= 0; i--) { const d = new Date(y, m, dd - i); out.push({ d, label: `${d.getDate()}/${d.getMonth() + 1}` }); }
  else if (period === 'weekly') { const w = weekStart(now); for (let i = 11; i >= 0; i--) { const d = new Date(w.getFullYear(), w.getMonth(), w.getDate() - 7 * i); out.push({ d, label: `${d.getDate()}/${d.getMonth() + 1}` }); } }
  else if (period === 'monthly') for (let i = 11; i >= 0; i--) { const d = new Date(y, m - i, 1); out.push({ d, label: d.toLocaleString('en', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2) }); }
  else for (let i = 4; i >= 0; i--) { const d = new Date(y - i, 0, 1); out.push({ d, label: String(d.getFullYear()) }); }
  return out.map((b) => ({ key: bucketKey(period, b.d), label: b.label, start: b.d, revenue: 0, orders: 0, appts: 0 }));
}
function stats(bizIds, period) {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) period = 'daily';
  const set = new Set(bizIds);
  const bs = buckets(period, new Date());
  const idx = new Map(bs.map((b) => [b.key, b]));
  const from = bs[0].start.getTime();
  const apptsByOrder = new Map();
  for (const a of db.appts) { if (!set.has(a.bizId)) continue; if (!apptsByOrder.has(a.orderId)) apptsByOrder.set(a.orderId, []); apptsByOrder.get(a.orderId).push(a); }
  const top = new Map(), cat = new Map();
  let revenue = 0, orders = 0, appts = 0, points = 0;
  for (const o of db.orders) {
    if (o.status !== 'paid' || !set.has(o.bizId)) continue;
    const at = new Date(o.payment.paidAt);
    if (at.getTime() < from) continue;
    const bk = idx.get(bucketKey(period, at));
    if (!bk) continue;
    const list = (apptsByOrder.get(o.id) || []).filter((a) => a.status !== 'cancelled');
    bk.revenue += o.total; bk.orders++; bk.appts += list.length;
    revenue += o.total; orders++; appts += list.length; points += o.points;
    for (const a of list) {
      const t = top.get(a.itemId) || { itemId: a.itemId, name: a.name, count: 0, revenue: 0 };
      t.count++; t.revenue += a.price; top.set(a.itemId, t);
      const c = cat.get(a.category) || { name: a.category, count: 0, revenue: 0 };
      c.count++; c.revenue += a.price; cat.set(a.category, c);
    }
  }
  const fix = (o) => Object.assign(o, { revenue: round2(o.revenue) });
  const items = db.items.filter((i) => set.has(i.bizId));
  const t0 = today();
  const upcoming = db.appts.filter((a) => set.has(a.bizId) && a.status === 'scheduled' && a.date >= t0);
  return {
    period,
    summary: { revenue: round2(revenue), orders, appointments: appts, avgOrder: orders ? round2(revenue / orders) : 0, points },
    series: bs.map((b) => ({ key: b.key, label: b.label, revenue: round2(b.revenue), orders: b.orders, appts: b.appts })),
    topItems: [...top.values()].map(fix).sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, 10),
    categories: [...cat.values()].map(fix).sort((a, b) => b.revenue - a.revenue),
    catalog: {
      totalItems: items.length, listedItems: items.filter((i) => i.categoryId).length,
      activeItems: items.filter((i) => i.categoryId && i.active).length, topPicks: items.filter((i) => i.topPick || i.recommended).length,
      categories: db.categories.filter((c) => set.has(c.bizId)).map((c) => ({ name: c.name, active: c.active, items: items.filter((i) => i.categoryId === c.id).length })),
    },
    live: { refunds: db.orders.filter((o) => o.needsRefund && set.has(o.bizId)).map((o) => ({ no: o.no, total: o.total, ref: o.payment.ref })), upcoming: upcoming.length, today: upcoming.filter((a) => a.date === t0).length, customers: db.customers.filter((c) => set.has(c.bizId)).length },
  };
}
function demoSales(biz) {
  db.orders = db.orders.filter((o) => !(o.bizId === biz.id && o.demo));
  db.appts = db.appts.filter((a) => !(a.bizId === biz.id && a.demo));
  db.customers = db.customers.filter((c) => !(c.bizId === biz.id && c.demo));
  const items = db.items.filter((i) => isListed(biz, i));
  if (!items.length) throw bad('Add some listed services first');
  const names = ['Aisha', 'Ben', 'Chen', 'Dewi', 'Farid', 'Grace', 'Hana', 'Ivan', 'Jia Wen', 'Kumar', 'Lena', 'Mei'];
  const custs = names.map((n, i) => ({ id: uid(), bizId: biz.id, name: n, phone: `01999000${pad(i)}`, email: `${n.toLowerCase().replace(/\W/g, '')}@example.com`, points: 0, createdAt: Date.now(), demo: true }));
  db.customers.push(...custs);
  const staff = db.staff.filter((s) => s.bizId === biz.id);
  const area = db.areas.find((a) => a.bizId === biz.id && a.type === 'shop');
  const now = Date.now();
  for (let i = 0; i < 260; i++) {
    const age = Math.pow(Math.random(), 1.6) * 365 * 86400000; // more recent history is denser
    const when = new Date(now - age - 3600000);
    const cust = custs[Math.floor(Math.random() * custs.length)];
    const o = { id: uid(), no: `D${i}`, bizId: biz.id, customerId: cust.id, apptIds: [], status: 'paid', createdAt: when.getTime(), charges: [], discount: 0, demo: true, payment: { method: 'card', ref: `DEMO-${i}`, paidAt: when.getTime() } };
    let sub = 0;
    for (let k = 0, n = 1 + Math.floor(Math.random() * 2); k < n; k++) {
      const weights = items.map((it) => (it.topPick ? 4 : it.recommended ? 2.5 : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0), it = items[0];
      for (let j = 0; j < items.length; j++) { r -= weights[j]; if (r <= 0) { it = items[j]; break; } }
      const start = 600 + 30 * Math.floor(Math.random() * 14);
      const a = {
        id: uid(), bizId: biz.id, orderId: o.id, customerId: cust.id, itemId: it.id, name: it.name, image: '', category: catById(it.categoryId).name, base: it.price, addons: [],
        areaFee: 0, price: it.price, durationMin: it.durationMin, areaId: area && area.id, areaName: area ? area.name : '', areaType: 'shop', address: '',
        date: ymd(when), time: fromMin(start), startMin: start, endMin: start + it.durationMin, staffId: staff.length ? staff[Math.floor(Math.random() * staff.length)].id : '',
        remark: '', status: 'completed', createdAt: when.getTime(), demo: true, reminderAt: when.getTime(),
      };
      db.appts.push(a); o.apptIds.push(a.id); sub += a.price;
    }
    o.subtotal = round2(sub);
    o.charges = biz.settings.charges.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, amount: round2(c.type === 'percent' ? (sub * c.value) / 100 : c.value) }));
    o.total = round2(sub + o.charges.reduce((s, c) => s + c.amount, 0));
    o.points = Math.floor(o.total * biz.settings.pointsPerRM);
    cust.points += o.points;
    db.orders.push(o);
  }
  save();
  return { orders: 260 };
}

// ---------------------------------------------------------------- admin input handling
function applyCategory(biz, c, b) {
  if ('name' in b) {
    c.name = need(str(b.name, 60), 'Category name is required');
    if (db.categories.some((x) => x.bizId === biz.id && x.id !== c.id && x.name.toLowerCase() === c.name.toLowerCase())) throw bad('Category already exists');
  }
  if ('icon' in b) c.icon = str(b.icon, 8);
  if ('active' in b) c.active = !!b.active;
  if ('sort' in b) c.sort = num(b.sort, 0);
}
function cleanGroups(biz, it, groups) {
  if (!Array.isArray(groups)) throw bad('Invalid add-ons');
  return groups.slice(0, 10).map((g) => {
    const name = need(str(g.name, 60), 'Add-on group name is required');
    const options = (Array.isArray(g.options) ? g.options : []).slice(0, 30).map((o) => {
      const x = itemById(o.itemId);
      if (!x || x.bizId !== biz.id || x.id === it.id) throw bad('Add-on items must be existing services of your business');
      return { id: str(o.id, 20) || uid(), itemId: x.id, name: x.name, price: money(o.price == null || o.price === '' ? x.price : o.price) };
    });
    if (!options.length) throw bad(`Add-on group "${name}" needs at least one item`);
    return { id: str(g.id, 20) || uid(), name, required: !!g.required, max: Math.max(0, Math.floor(num(g.max, 0))), options };
  });
}
function applyItem(biz, it, b) {
  if ('name' in b) it.name = need(str(b.name, 100), 'Service name is required');
  if ('description' in b) it.description = str(b.description, 1500);
  if ('price' in b) it.price = money(b.price);
  if ('durationMin' in b) { const d = Math.floor(num(b.durationMin, 0)); if (d < 5 || d > 600) throw bad('Duration must be 5-600 minutes'); it.durationMin = d; }
  if ('categoryId' in b) {
    if (b.categoryId) { const c = catById(b.categoryId); if (!c || c.bizId !== biz.id) throw bad('Unknown category'); it.categoryId = c.id; } else it.categoryId = null;
  }
  if ('images' in b) {
    if (!Array.isArray(b.images)) throw bad('Invalid images');
    it.images = b.images.filter((u) => typeof u === 'string' && /^\/uploads\/[\w.-]+$/.test(u)).slice(0, 8);
  }
  for (const k of ['recommended', 'topPick', 'active']) if (k in b) it[k] = !!b[k];
  if ('promoPrice' in b) it.promoPrice = b.promoPrice === null || b.promoPrice === '' ? null : money(b.promoPrice);
  if ('promoFrom' in b) { if (b.promoFrom && !isDate(b.promoFrom)) throw bad('Invalid promo start date'); it.promoFrom = b.promoFrom || ''; }
  if ('promoTo' in b) { if (b.promoTo && !isDate(b.promoTo)) throw bad('Invalid promo end date'); it.promoTo = b.promoTo || ''; }
  if (it.promoPrice != null && it.promoPrice >= it.price) throw bad('Promo price must be lower than the normal price');
  if (it.promoFrom && it.promoTo && it.promoTo < it.promoFrom) throw bad('Promo end date must be after the start date');
  if ('areaIds' in b) it.areaIds = (Array.isArray(b.areaIds) ? b.areaIds : []).filter((id) => db.areas.some((a) => a.id === id && a.bizId === biz.id));
  if ('groups' in b) it.groups = cleanGroups(biz, it, b.groups);
}
function applyStaff(biz, s, b) {
  if ('name' in b) s.name = need(str(b.name, 60), 'Name is required');
  if ('phone' in b) s.phone = str(b.phone, 30);
  if ('email' in b) s.email = str(b.email, 100);
  if ('serviceIds' in b) s.serviceIds = (Array.isArray(b.serviceIds) ? b.serviceIds : []).filter((id) => db.items.some((i) => i.id === id && i.bizId === biz.id));
  if ('workDays' in b) s.workDays = (Array.isArray(b.workDays) ? b.workDays : []).map(Number).filter((d) => d >= 0 && d <= 6);
  for (const k of ['start', 'end']) if (k in b) { if (b[k]) toMin(b[k]); s[k] = b[k] || ''; }
  if (s.start && s.end && toMin(s.start) >= toMin(s.end)) throw bad('Working end time must be after start time');
  if ('offDates' in b) s.offDates = (Array.isArray(b.offDates) ? b.offDates : []).filter(isDate);
  if ('active' in b) s.active = !!b.active;
}
function applyArea(biz, a, b) {
  if ('type' in b) { if (!['shop', 'home'].includes(b.type)) throw bad('Type must be shop or home'); a.type = b.type; }
  if ('name' in b) a.name = need(str(b.name, 80), 'Area name is required');
  if ('address' in b) a.address = str(b.address, 300);
  if ('fee' in b) a.fee = money(b.fee);
  if ('active' in b) a.active = !!b.active;
}
function applySettings(biz, b) {
  const s = biz.settings;
  const int = (v, lo, hi, msg) => { const n = Math.floor(num(v, NaN)); if (!(n >= lo && n <= hi)) throw bad(msg); return n; };
  if ('slotMinutes' in b) s.slotMinutes = int(b.slotMinutes, 5, 240, 'Slot length must be 5-240 minutes');
  if ('leadMinutes' in b) s.leadMinutes = int(b.leadMinutes, 0, 10080, 'Minimum notice must be 0-10080 minutes');
  if ('holdMinutes' in b) s.holdMinutes = int(b.holdMinutes, 3, 60, 'Payment hold must be 3-60 minutes');
  if ('maxDaysAhead' in b) s.maxDaysAhead = int(b.maxDaysAhead, 1, 180, 'Booking window must be 1-180 days');
  if ('pointsPerRM' in b) { const n = num(b.pointsPerRM, NaN); if (!(n >= 0 && n <= 100)) throw bad('Points per RM must be 0-100'); s.pointsPerRM = n; }
  if ('reminderHour' in b) s.reminderHour = int(b.reminderHour, 0, 23, 'Reminder hour must be 0-23');
  if ('reminderWhatsapp' in b) s.reminderWhatsapp = !!b.reminderWhatsapp;
  if ('reminderEmail' in b) s.reminderEmail = !!b.reminderEmail;
  if ('closedDates' in b) s.closedDates = [...new Set((Array.isArray(b.closedDates) ? b.closedDates : []).filter(isDate))].sort();
  if ('week' in b) {
    if (!Array.isArray(b.week) || b.week.length !== 7) throw bad('Invalid weekly schedule');
    s.week = b.week.map((w) => {
      const on = !!w.on;
      if (toMin(w.start) >= toMin(w.end)) throw bad('Closing time must be after opening time');
      return { on, start: fromMin(toMin(w.start)), end: fromMin(toMin(w.end)) };
    });
  }
  if ('charges' in b) {
    if (!Array.isArray(b.charges)) throw bad('Invalid charges');
    s.charges = b.charges.slice(0, 10).map((c) => {
      if (!['percent', 'fixed'].includes(c.type)) throw bad('Charge type must be percent or fixed');
      const value = money(c.value);
      if (c.type === 'percent' && value > 100) throw bad('Percentage cannot exceed 100');
      return { id: str(c.id, 20) || uid(), name: need(str(c.name, 40), 'Charge name is required'), type: c.type, value, active: !!c.active };
    });
  }
}
function applyProfile(biz, b) {
  if ('name' in b) biz.name = need(str(b.name, 80), 'Business name is required');
  if ('industry' in b) biz.industry = str(b.industry, 60);
  if ('about' in b) biz.about = str(b.about, 600);
  if ('phone' in b) biz.phone = str(b.phone, 30);
  if ('address' in b) biz.address = str(b.address, 300);
  if ('photo' in b) biz.photo = /^\/uploads\/[\w.-]+$/.test(b.photo) ? b.photo : '';
}
const shopUrl = (biz) => `${CFG.publicUrl}/shop/${biz.slug}`;

// ---------------------------------------------------------------- views
function apptView(a, forCustomer) {
  const o = orderById(a.orderId), rv = db.reviews.find((r) => r.apptId === a.id);
  const v = {
    id: a.id, name: a.name, image: a.image, category: a.category, addons: a.addons, price: a.price, durationMin: a.durationMin, areaName: a.areaName, areaType: a.areaType,
    address: a.address, date: a.date, time: a.time, endTime: fromMin(a.endMin), remark: a.remark, status: a.status, orderNo: o && o.no, orderId: a.orderId,
    review: rv ? { rating: rv.rating, comment: rv.comment, at: rv.createdAt } : null, canReview: a.status === 'completed' && !rv, reminderAt: a.reminderAt || null,
  };
  if (!forCustomer) {
    const c = custById(a.customerId), s = staffById(a.staffId);
    v.customer = c ? { id: c.id, name: c.name, phone: c.phone, email: c.email } : null;
    v.staffId = a.staffId; v.staffName = s ? s.name : '';
    v.order = o ? { id: o.id, no: o.no, status: o.status, total: o.total, subtotal: o.subtotal, discount: o.discount, voucherCode: o.voucherCode, charges: o.charges, payment: o.payment, points: o.points } : null;
  }
  return v;
}
function orderView(o) {
  return {
    id: o.id, no: o.no, status: o.status, refundNeeded: !!o.needsRefund, subtotal: o.subtotal, discount: o.discount, voucherCode: o.voucherCode, charges: o.charges, total: o.total, points: o.points,
    holdUntil: o.holdUntil, payment: o.payment, createdAt: o.createdAt, appts: db.appts.filter((a) => a.orderId === o.id).map((a) => apptView(a, true)),
  };
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, role, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), role, fn });
const adminBiz = (ctx) => { const b = bizById(ctx.auth.bizId); if (!b || !b.active) throw new HttpError(401, 'Account unavailable'); return b; };
const own = (arr, biz, id, what) => { const x = arr.find((r) => r.id === id && r.bizId === biz.id); if (!x) throw new HttpError(404, `${what} not found`); return x; };

// ---- admin: auth, profile, settings
route('POST', '/api/admin/login', null, ({ body }) => {
  const u = str(body.username, 40).toLowerCase();
  throttle(`a:${u}`);
  const biz = db.businesses.find((b) => b.adminUser.toLowerCase() === u);
  if (!biz || !checkPw(body.password, biz.adminPass)) { failed(`a:${u}`); throw new HttpError(401, 'Wrong username or password'); }
  if (!biz.active) throw new HttpError(403, 'This business account has been deactivated. Please contact the platform owner.');
  return { token: sign({ role: 'admin', bizId: biz.id }, 12 * 3600 * 1000), business: { name: biz.name, slug: biz.slug } };
});
route('GET', '/api/admin/profile', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  return { id: b.id, slug: b.slug, name: b.name, industry: b.industry, about: b.about, phone: b.phone, address: b.address, photo: b.photo, link: shopUrl(b), adminUser: b.adminUser };
});
route('PUT', '/api/admin/profile', 'admin', (ctx) => { applyProfile(adminBiz(ctx), ctx.body); save(); return { ok: true }; });
route('GET', '/api/admin/settings', 'admin', (ctx) => adminBiz(ctx).settings);
route('PUT', '/api/admin/settings', 'admin', (ctx) => { const b = adminBiz(ctx); applySettings(b, ctx.body); save(); return b.settings; });
route('PUT', '/api/admin/password', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  if (!checkPw(ctx.body.current, b.adminPass)) throw bad('Current password is wrong');
  if (str(ctx.body.next, 100).length < 6) throw bad('New password must be at least 6 characters');
  b.adminPass = hashPw(ctx.body.next); save(); return { ok: true };
});

// ---- admin: categories
route('GET', '/api/admin/categories', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  return mine(db.categories, b).sort((x, y) => x.sort - y.sort).map((c) => ({ ...c, items: db.items.filter((i) => i.categoryId === c.id).length }));
});
route('POST', '/api/admin/categories', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  const c = { id: uid(), bizId: b.id, name: '', icon: '', active: true, sort: (mine(db.categories, b).length + 1) * 10 };
  applyCategory(b, c, ctx.body); db.categories.push(c); save(); return c;
});
route('PUT', '/api/admin/categories/:id', 'admin', (ctx) => { const b = adminBiz(ctx); const c = own(db.categories, b, ctx.params.id, 'Category'); applyCategory(b, c, ctx.body); save(); return c; });
route('DELETE', '/api/admin/categories/:id', 'admin', (ctx) => {
  const b = adminBiz(ctx); const c = own(db.categories, b, ctx.params.id, 'Category');
  if (db.items.some((i) => i.categoryId === c.id)) throw new HttpError(409, 'This category still has services. Move them out or deactivate the category instead.');
  db.categories.splice(db.categories.indexOf(c), 1); save(); return { ok: true };
});

// ---- admin: services (items)
route('GET', '/api/admin/items', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  return mine(db.items, b).sort((x, y) => x.sort - y.sort).map((i) => ({ ...i, effPrice: effPrice(i), promoOn: promoActive(i), ...itemRating(i.id) }));
});
route('POST', '/api/admin/items', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  const it = { id: uid(), bizId: b.id, categoryId: null, name: '', description: '', price: 0, durationMin: 60, promoPrice: null, promoFrom: '', promoTo: '', images: [], recommended: false, topPick: false, active: true, areaIds: [], groups: [], sort: (mine(db.items, b).length + 1) * 10 };
  const body = { ...ctx.body }; const groups = body.groups; delete body.groups;
  applyItem(b, it, body); db.items.push(it);
  if (groups) { try { applyItem(b, it, { groups }); } catch (e) { db.items.pop(); throw e; } }
  save(); return it;
});
route('PUT', '/api/admin/items/:id', 'admin', (ctx) => { const b = adminBiz(ctx); const it = own(db.items, b, ctx.params.id, 'Service'); applyItem(b, it, ctx.body); save(); return it; });
route('DELETE', '/api/admin/items/:id', 'admin', (ctx) => {
  const b = adminBiz(ctx); const it = own(db.items, b, ctx.params.id, 'Service');
  if (db.appts.some((a) => a.itemId === it.id)) throw new HttpError(409, 'This service already has bookings. Deactivate it instead of deleting.');
  db.items.splice(db.items.indexOf(it), 1);
  for (const o of db.items) o.groups = o.groups.map((g) => ({ ...g, options: g.options.filter((x) => x.itemId !== it.id) })).filter((g) => g.options.length);
  for (const s of db.staff) s.serviceIds = s.serviceIds.filter((id) => id !== it.id);
  save(); return { ok: true };
});

// ---- admin: service persons
route('GET', '/api/admin/staff', 'admin', (ctx) => mine(db.staff, adminBiz(ctx)));
route('POST', '/api/admin/staff', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  const s = { id: uid(), bizId: b.id, name: '', phone: '', email: '', serviceIds: [], workDays: [1, 2, 3, 4, 5, 6], start: '', end: '', offDates: [], active: true };
  applyStaff(b, s, ctx.body); db.staff.push(s); save(); return s;
});
route('PUT', '/api/admin/staff/:id', 'admin', (ctx) => { const b = adminBiz(ctx); const s = own(db.staff, b, ctx.params.id, 'Service person'); applyStaff(b, s, ctx.body); save(); return s; });
route('DELETE', '/api/admin/staff/:id', 'admin', (ctx) => {
  const b = adminBiz(ctx); const s = own(db.staff, b, ctx.params.id, 'Service person');
  if (db.appts.some((a) => a.staffId === s.id && a.status === 'scheduled' && a.date >= today())) throw new HttpError(409, 'This person has upcoming appointments. Reassign them first, or deactivate instead.');
  s.active = false; if (!db.appts.some((a) => a.staffId === s.id)) db.staff.splice(db.staff.indexOf(s), 1);
  save(); return { ok: true };
});

// ---- admin: areas
route('GET', '/api/admin/areas', 'admin', (ctx) => mine(db.areas, adminBiz(ctx)));
route('POST', '/api/admin/areas', 'admin', (ctx) => {
  const b = adminBiz(ctx); const a = { id: uid(), bizId: b.id, type: 'shop', name: '', address: '', fee: 0, active: true };
  applyArea(b, a, ctx.body); db.areas.push(a); save(); return a;
});
route('PUT', '/api/admin/areas/:id', 'admin', (ctx) => { const b = adminBiz(ctx); const a = own(db.areas, b, ctx.params.id, 'Area'); applyArea(b, a, ctx.body); save(); return a; });
route('DELETE', '/api/admin/areas/:id', 'admin', (ctx) => {
  const b = adminBiz(ctx); const a = own(db.areas, b, ctx.params.id, 'Area');
  if (db.appts.some((x) => x.areaId === a.id)) throw new HttpError(409, 'This area has bookings. Deactivate it instead.');
  db.areas.splice(db.areas.indexOf(a), 1);
  for (const it of db.items) it.areaIds = it.areaIds.filter((id) => id !== a.id);
  save(); return { ok: true };
});

// ---- admin: appointments, customers, vouchers, reviews, outbox, dashboard
route('GET', '/api/admin/appointments', 'admin', (ctx) => {
  sweep();
  const b = adminBiz(ctx), { from, to, status, q } = ctx.query;
  const term = str(q, 60).toLowerCase();
  return mine(db.appts, b).filter((a) => a.status !== 'hold' && (orderById(a.orderId) || {}).status === 'paid')
    .filter((a) => (!isDate(from) || a.date >= from) && (!isDate(to) || a.date <= to) && (!status || a.status === status))
    .map((a) => apptView(a, false))
    .filter((v) => !term || [v.name, v.customer && v.customer.name, v.customer && v.customer.phone, v.orderNo, v.staffName].some((x) => String(x || '').toLowerCase().includes(term)))
    .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
});
route('PUT', '/api/admin/appointments/:id', 'admin', (ctx) => {
  const b = adminBiz(ctx); const a = own(db.appts, b, ctx.params.id, 'Appointment');
  if ('status' in ctx.body) {
    if (!['scheduled', 'in_progress', 'completed', 'no_show', 'cancelled'].includes(ctx.body.status)) throw bad('Invalid status');
    a.status = ctx.body.status;
    if (a.status === 'completed') a.completedAt = Date.now();
  }
  if ('staffId' in ctx.body) {
    const s = own(db.staff, b, ctx.body.staffId, 'Service person'), it = itemById(a.itemId), info = dayInfo(b, a.date);
    const busy = busyMap(b.id, a.date, a.id);
    if (!info || !qualified(s, b, it, a.date, a.startMin, a.endMin, info) || !isFree(busy.get(s.id), a.startMin, a.endMin)) throw new HttpError(409, `${s.name} is not available for this service at that time`);
    a.staffId = s.id;
  }
  save(); return apptView(a, false);
});
route('GET', '/api/admin/appointments/:id/staff', 'admin', (ctx) => {
  const b = adminBiz(ctx); const a = own(db.appts, b, ctx.params.id, 'Appointment');
  const it = itemById(a.itemId), info = dayInfo(b, a.date), busy = busyMap(b.id, a.date, a.id);
  return info ? mine(db.staff, b).filter((s) => qualified(s, b, it, a.date, a.startMin, a.endMin, info) && isFree(busy.get(s.id), a.startMin, a.endMin)).map((s) => ({ id: s.id, name: s.name })) : [];
});
route('POST', '/api/admin/appointments/:id/remind', 'admin', async (ctx) => {
  const b = adminBiz(ctx); const a = own(db.appts, b, ctx.params.id, 'Appointment');
  await notify(b, custById(a.customerId), a, 'reminder'); return { ok: true };
});
route('GET', '/api/admin/customers', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  return mine(db.customers, b).map((c) => {
    const os = db.orders.filter((o) => o.customerId === c.id && o.status === 'paid');
    return { id: c.id, name: c.name, phone: c.phone, email: c.email, points: c.points || 0, orders: os.length, spent: round2(os.reduce((s, o) => s + o.total, 0)), joined: c.createdAt };
  }).sort((x, y) => y.spent - x.spent);
});
route('GET', '/api/admin/vouchers', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  return mine(db.vouchers, b).sort((x, y) => y.createdAt - x.createdAt).map((v) => ({ ...v, customerName: (custById(v.customerId) || {}).name, state: v.usedAt ? 'used' : v.expiry && v.expiry < today() ? 'expired' : 'active' }));
});
route('POST', '/api/admin/vouchers', 'admin', (ctx) => {
  const b = adminBiz(ctx), x = ctx.body;
  if (!['amount', 'percent'].includes(x.type)) throw bad('Voucher type must be amount or percent');
  const value = money(x.value);
  if (!(value > 0) || (x.type === 'percent' && value > 100)) throw bad('Invalid voucher value');
  if (x.expiry && !isDate(x.expiry)) throw bad('Invalid expiry date');
  const ids = (Array.isArray(x.customerIds) ? x.customerIds : []).filter((id) => db.customers.some((c) => c.id === id && c.bizId === b.id));
  if (!ids.length) throw bad('Select at least one customer');
  const made = ids.map((customerId) => {
    const v = { id: uid(), bizId: b.id, customerId, code: `V${uid().slice(0, 6).toUpperCase()}`, type: x.type, value, expiry: x.expiry || '', note: str(x.note, 100), createdAt: Date.now() };
    db.vouchers.push(v); return v;
  });
  save(); return { created: made.length };
});
route('DELETE', '/api/admin/vouchers/:id', 'admin', (ctx) => {
  const b = adminBiz(ctx); const v = own(db.vouchers, b, ctx.params.id, 'Voucher');
  if (v.usedAt) throw new HttpError(409, 'This voucher was already used');
  db.vouchers.splice(db.vouchers.indexOf(v), 1); save(); return { ok: true };
});
route('GET', '/api/admin/reviews', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  return mine(db.reviews, b).sort((x, y) => y.createdAt - x.createdAt).map((r) => ({ ...r, customerName: (custById(r.customerId) || {}).name, itemName: (itemById(r.itemId) || {}).name }));
});
route('GET', '/api/admin/outbox', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  return { live: { whatsapp: !!(CFG.waToken && CFG.waPhoneId), email: !!(CFG.resendKey && CFG.emailFrom) }, rows: mine(db.outbox, b).slice(-200).reverse() };
});
route('GET', '/api/admin/stats', 'admin', (ctx) => stats([adminBiz(ctx).id], ctx.query.period));
route('POST', '/api/admin/demo-sales', 'admin', (ctx) => demoSales(adminBiz(ctx)));
route('DELETE', '/api/admin/demo-sales', 'admin', (ctx) => {
  const b = adminBiz(ctx);
  db.orders = db.orders.filter((o) => !(o.bizId === b.id && o.demo)); db.appts = db.appts.filter((a) => !(a.bizId === b.id && a.demo));
  db.customers = db.customers.filter((c) => !(c.bizId === b.id && c.demo)); save(); return { ok: true };
});

// ---- super admin
route('POST', '/api/super/login', null, ({ body }) => {
  throttle('super');
  if (!checkPw(body.password, db.superPass)) { failed('super'); throw new HttpError(401, 'Wrong password'); }
  return { token: sign({ role: 'super' }, 12 * 3600 * 1000) };
});
function bizSummary(b, period) {
  const all = stats([b.id], period || 'yearly');
  return {
    id: b.id, slug: b.slug, name: b.name, industry: b.industry, active: b.active, adminUser: b.adminUser, createdAt: b.createdAt, link: shopUrl(b), photo: b.photo,
    items: all.catalog.listedItems, activeItems: all.catalog.activeItems, customers: all.live.customers, upcoming: all.live.upcoming,
    sales: all.summary.revenue, orders: all.summary.orders, appointments: all.summary.appointments,
  };
}
route('GET', '/api/super/stats', 'super', (ctx) => {
  const period = ctx.query.period;
  const s = stats(db.businesses.map((b) => b.id), period);
  const list = db.businesses.map((b) => bizSummary(b, s.period)).sort((a, b) => b.sales - a.sales);
  const active = db.businesses.filter((b) => b.active);
  return {
    ...s, businesses: list,
    platform: { total: db.businesses.length, active: active.length, inactive: db.businesses.length - active.length, listedItems: list.filter((b) => b.active).reduce((t, b) => t + b.items, 0), activeSales: round2(list.filter((b) => b.active).reduce((t, b) => t + b.sales, 0)) },
  };
});
route('POST', '/api/super/businesses', 'super', ({ body }) => {
  const name = need(str(body.name, 80), 'Business name is required');
  const slug = slugify(body.slug || name);
  need(slug, 'Invalid link name');
  if (['admin', 'super', 'api', 'shop', 'uploads'].includes(slug) || db.businesses.some((b) => b.slug === slug)) throw bad('This link name is already used. Choose another one.');
  const user = str(body.adminUser, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(user)) throw bad('Admin username must be 3-40 letters, numbers, dot, dash or underscore');
  if (db.businesses.some((b) => b.adminUser.toLowerCase() === user)) throw bad('Admin username is already taken');
  if (str(body.adminPass, 100).length < 6) throw bad('Password must be at least 6 characters');
  const biz = {
    id: uid(), slug, name, industry: str(body.industry, 60), about: '', photo: '', phone: str(body.phone, 30), address: '', adminUser: user, adminPass: hashPw(body.adminPass),
    active: true, createdAt: Date.now(), settings: defaultSettings(),
  };
  db.businesses.push(biz); save(); return bizSummary(biz);
});
route('PUT', '/api/super/businesses/:id', 'super', ({ params, body }) => {
  const b = bizById(params.id); if (!b) throw new HttpError(404, 'Business not found');
  if ('active' in body) b.active = !!body.active;
  if ('name' in body) b.name = need(str(body.name, 80), 'Business name is required');
  if ('industry' in body) b.industry = str(body.industry, 60);
  if (body.adminPass) { if (str(body.adminPass, 100).length < 6) throw bad('Password must be at least 6 characters'); b.adminPass = hashPw(body.adminPass); }
  save(); return bizSummary(b);
});
route('PUT', '/api/super/password', 'super', ({ body }) => {
  if (!checkPw(body.current, db.superPass)) throw bad('Current password is wrong');
  if (str(body.next, 100).length < 8) throw bad('New password must be at least 8 characters');
  db.superPass = hashPw(body.next); save(); return { ok: true };
});

route('GET', '/api/public/businesses', null, () => {
  if (process.env.SHOW_BUSINESS_LIST === '0') return [];
  return db.businesses.filter((b) => b.active).map((b) => ({ slug: b.slug, name: b.name, industry: b.industry }));
});

// ---- customer app (one link per business: /shop/<slug>)
function shopBiz(params) {
  const b = db.businesses.find((x) => x.slug === params.slug);
  if (!b) throw new HttpError(404, 'Business not found');
  if (!b.active) throw new HttpError(403, 'This business is currently unavailable');
  return b;
}
function shopCust(ctx) {
  const b = shopBiz(ctx.params);
  if (ctx.auth.bizId !== b.id) throw new HttpError(401, 'Please log in');
  const c = custById(ctx.auth.customerId);
  if (!c || c.bizId !== b.id) throw new HttpError(401, 'Please log in');
  return { biz: b, cust: c };
}
route('GET', '/api/shop/:slug', null, ({ params }) => {
  const b = shopBiz(params);
  const cats = mine(db.categories, b).filter((c) => c.active && db.items.some((i) => i.categoryId === c.id && i.active)).sort((x, y) => x.sort - y.sort).map((c) => ({ id: c.id, name: c.name, icon: c.icon }));
  return {
    name: b.name, industry: b.industry, about: b.about, photo: b.photo, phone: b.phone, address: b.address, categories: cats,
    areas: db.areas.filter((a) => a.bizId === b.id && a.active).map((a) => ({ id: a.id, type: a.type, name: a.name, address: a.address, fee: a.fee })),
    reminderNote: b.settings.reminderWhatsapp || b.settings.reminderEmail, holdMinutes: b.settings.holdMinutes, payMode: billplzLive() ? 'billplz' : 'demo',
  };
});
route('POST', '/api/shop/:slug/login', null, ({ params, body }) => {
  const b = shopBiz(params);
  const name = str(body.name, 60), email = str(body.email, 100).toLowerCase(), phone = str(body.phone, 30);
  const digits = phone.replace(/\D/g, '');
  if (name.length < 2) throw bad('Please enter your name');
  if (digits.length < 8 || digits.length > 15) throw bad('Please enter a valid contact number');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Please enter a valid email address');
  throttle(`c:${b.id}:${digits}`);
  let c = db.customers.find((x) => x.bizId === b.id && phoneIntl(x.phone) === phoneIntl(phone));
  if (c) {
    if (c.email.toLowerCase() !== email) { failed(`c:${b.id}:${digits}`); throw new HttpError(401, 'This contact number is registered with a different email address'); }
    c.name = name;
  } else { c = { id: uid(), bizId: b.id, name, phone, email, points: 0, createdAt: Date.now() }; db.customers.push(c); }
  save();
  return { token: sign({ role: 'customer', bizId: b.id, customerId: c.id }, 30 * 86400000), customer: { id: c.id, name: c.name, phone: c.phone, email: c.email } };
});
route('GET', '/api/shop/:slug/me', 'customer', (ctx) => {
  const { biz, cust } = shopCust(ctx);
  return {
    customer: { id: cust.id, name: cust.name, phone: cust.phone, email: cust.email, points: cust.points || 0 },
    vouchers: db.vouchers.filter((v) => voucherUsable(v, cust)).map((v) => ({ id: v.id, code: v.code, type: v.type, value: v.value, expiry: v.expiry, note: v.note })),
    pointsPerRM: biz.settings.pointsPerRM,
  };
});
route('GET', '/api/shop/:slug/services', 'customer', (ctx) => {
  const { biz } = shopCust(ctx);
  sweep();
  const q = str(ctx.query.q, 60).toLowerCase();
  let list = mine(db.items, biz).filter((i) => isListed(biz, i));
  if (ctx.query.cat) list = list.filter((i) => i.categoryId === ctx.query.cat);
  if (q) list = list.filter((i) => `${i.name} ${i.description} ${catById(i.categoryId).name}`.toLowerCase().includes(q));
  if (ctx.query.areaId) list = list.filter((i) => allowedAreas(biz, i).some((a) => a.id === ctx.query.areaId));
  else if (ctx.query.areaType) list = list.filter((i) => allowedAreas(biz, i).some((a) => a.type === ctx.query.areaType));
  list.sort((a, b) => (b.topPick - a.topPick) || (b.recommended - a.recommended) || a.sort - b.sort);
  return list.map((i) => publicItem(biz, i, true));
});
route('GET', '/api/shop/:slug/suggest', 'customer', (ctx) => {
  const { biz } = shopCust(ctx);
  const q = str(ctx.query.q, 60).toLowerCase();
  if (!q) return [];
  return mine(db.items, biz).filter((i) => isListed(biz, i) && (i.name.toLowerCase().includes(q) || catById(i.categoryId).name.toLowerCase().includes(q)))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 6)
    .map((i) => ({ id: i.id, name: i.name, category: catById(i.categoryId).name, price: effPrice(i) }));
});
route('GET', '/api/shop/:slug/services/:id', 'customer', (ctx) => {
  const { biz } = shopCust(ctx);
  const it = itemById(ctx.params.id);
  if (!it || !isListed(biz, it)) throw new HttpError(404, 'Service not found');
  const pub = publicItem(biz, it, false);
  pub.groups = it.groups.map((g) => ({
    id: g.id, name: g.name, required: g.required, max: g.max,
    options: g.options.filter(optionOk).map((o) => { const x = itemById(o.itemId); return { id: o.id, name: x.name, price: o.price, normalPrice: x.price, durationMin: x.durationMin, description: x.description }; }),
  })).filter((g) => g.options.length);
  pub.areas = allowedAreas(biz, it).map((a) => ({ id: a.id, type: a.type, name: a.name, address: a.address, fee: a.fee }));
  pub.recentReviews = db.reviews.filter((r) => r.itemId === it.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)
    .map((r) => ({ rating: r.rating, comment: r.comment, name: (custById(r.customerId) || { name: 'Customer' }).name.split(' ')[0], at: r.createdAt }));
  pub.maxDaysAhead = biz.settings.maxDaysAhead;
  return pub;
});
function availabilityInput(biz, body) {
  const it = itemById(str(body.itemId, 40));
  if (!it || !isListed(biz, it)) throw new HttpError(404, 'Service not found');
  const pending = (Array.isArray(body.pending) ? body.pending : []).slice(0, 20).filter((p) => p && isDate(p.date) && /^\d{1,2}:\d{2}$/.test(p.time || ''));
  return { it, dur: durationOf(it, Array.isArray(body.addons) ? body.addons : []), pending };
}
route('POST', '/api/shop/:slug/days', 'customer', (ctx) => {
  const { biz } = shopCust(ctx); sweep();
  const { it, dur, pending } = availabilityInput(biz, ctx.body);
  const out = [];
  for (let i = 0; i < biz.settings.maxDaysAhead; i++) {
    const date = addDays(today(), i), st = dayState(biz, it, dur, date, pending);
    const free = st.slots.filter((s) => s.available).length;
    out.push({ date, state: st.closed ? 'closed' : free ? 'open' : 'full', free });
  }
  return { durationMin: dur, days: out };
});
route('POST', '/api/shop/:slug/availability', 'customer', (ctx) => {
  const { biz } = shopCust(ctx); sweep();
  const { it, dur, pending } = availabilityInput(biz, ctx.body);
  if (!isDate(ctx.body.date)) throw bad('Invalid date');
  return { durationMin: dur, ...dayState(biz, it, dur, ctx.body.date, pending) };
});
route('POST', '/api/shop/:slug/quote', 'customer', (ctx) => {
  const { biz, cust } = shopCust(ctx);
  const q = quote(biz, cust, ctx.body.lines);
  for (const l of q.lines) delete l.staffId; // customers never see internal allocation
  return q;
});
route('POST', '/api/shop/:slug/orders', 'customer', (ctx) => {
  const { biz, cust } = shopCust(ctx);
  const open = db.orders.filter((o) => o.customerId === cust.id && o.status === 'pending_payment').length;
  if (open >= 3) throw new HttpError(429, 'You have unpaid orders. Please pay or wait for them to expire before placing another.');
  return orderView(createOrder(biz, cust, ctx.body.lines));
});
route('GET', '/api/shop/:slug/orders', 'customer', (ctx) => {
  const { cust } = shopCust(ctx); sweep();
  return db.orders.filter((o) => o.customerId === cust.id && o.status !== 'expired').sort((a, b) => b.createdAt - a.createdAt).map(orderView);
});
route('GET', '/api/shop/:slug/orders/:id', 'customer', (ctx) => {
  const { cust } = shopCust(ctx); sweep();
  const o = orderById(ctx.params.id);
  if (!o || o.customerId !== cust.id) throw new HttpError(404, 'Order not found');
  return orderView(o);
});
route('POST', '/api/shop/:slug/orders/:id/pay', 'customer', async (ctx) => {
  const { biz, cust } = shopCust(ctx); sweep();
  const o = orderById(ctx.params.id);
  if (!o || o.customerId !== cust.id) throw new HttpError(404, 'Order not found');
  if (o.status === 'paid') return orderView(o);
  if (o.status !== 'pending_payment') throw new HttpError(409, 'Your reservation has expired. Please place the order again.');
  if (billplzLive()) {
    if (!o.gateway) { o.gateway = await createBill(biz, cust, o); }
    o.holdUntil = Math.max(o.holdUntil, Date.now() + 30 * 60000); // keep the slot while the customer is on the bank page
    for (const a of db.appts) if (a.orderId === o.id && a.status === 'hold') a.holdUntil = o.holdUntil;
    save();
    return { ...orderView(o), redirectUrl: `${o.gateway.url}` };
  }
  const method = str(ctx.body.method, 20);
  if (!['card', 'fpx', 'ewallet'].includes(method)) throw bad('Please choose a payment method');
  // DEMO GATEWAY (no BILLPLZ_* settings): confirms immediately, no real money moves.
  confirmPayment(o, method, `PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`);
  return orderView(o);
});
route('GET', '/api/shop/:slug/appointments', 'customer', (ctx) => {
  const { cust } = shopCust(ctx); sweep();
  return db.appts.filter((a) => a.customerId === cust.id && a.status !== 'hold' && (orderById(a.orderId) || {}).status === 'paid')
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).map((a) => apptView(a, true));
});
route('POST', '/api/shop/:slug/reviews', 'customer', (ctx) => {
  const { biz, cust } = shopCust(ctx);
  const a = db.appts.find((x) => x.id === ctx.body.apptId && x.customerId === cust.id);
  if (!a) throw new HttpError(404, 'Appointment not found');
  if (a.status !== 'completed') throw bad('You can review a service after your appointment is completed');
  if (db.reviews.some((r) => r.apptId === a.id)) throw bad('You have already reviewed this appointment');
  const rating = Math.floor(num(ctx.body.rating, 0));
  if (rating < 1 || rating > 5) throw bad('Please choose a rating from 1 to 5');
  db.reviews.push({ id: uid(), bizId: biz.id, apptId: a.id, itemId: a.itemId, customerId: cust.id, rating, comment: str(ctx.body.comment, 500), createdAt: Date.now() });
  save(); return { ok: true };
});

// ---------------------------------------------------------------- http plumbing
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json', '.ico': 'image/x-icon' };
const PAGES = { '/': 'index.html', '/admin': 'admin.html', '/super': 'super.html' };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function sendFile(res, file, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}
const decodeParams = (g) => { const o = {}; for (const k in g || {}) o[k] = decodeURIComponent(g[k]); return o; };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/(.)\/+$/, '$1');

  if (p === '/api/admin/upload' && req.method === 'POST') {
    const auth = authOf(req);
    if (!auth || auth.role !== 'admin') throw new HttpError(401, 'Please log in');
    const ext = EXT[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) throw bad('Only JPG, PNG, WEBP or GIF images are allowed');
    const buf = await readBody(req, 6 * 1024 * 1024);
    if (!buf.length) throw bad('Empty file');
    const name = `${uid()}${uid()}.${ext}`;
    fs.writeFileSync(path.join(UP_DIR, name), buf);
    return sendJson(res, 200, { url: `/uploads/${name}` });
  }
  if (p === '/api/payments/billplz/callback' && req.method === 'POST') {
    const raw = (await readBody(req, 64 * 1024)).toString('utf8');
    return sendJson(res, 200, billplzCallback(Object.fromEntries(new URLSearchParams(raw))));
  }
  if (p.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(p);
      if (!m) continue;
      let auth = null;
      if (r.role) {
        auth = authOf(req);
        if (!auth || auth.role !== r.role) throw new HttpError(401, 'Please log in');
      }
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        const raw = await readBody(req, 1024 * 1024);
        if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { throw bad('Invalid JSON'); } }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Invalid request');
      }
      return sendJson(res, 200, await r.fn({ params: decodeParams(m.groups), query: Object.fromEntries(url.searchParams), body, auth }));
    }
    throw new HttpError(404, 'Unknown API');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  if (PAGES[p]) return sendFile(res, path.join(PUBLIC_DIR, PAGES[p]));
  if (/^\/shop\/[\w-]+(\/return)?$/.test(p)) return sendFile(res, path.join(PUBLIC_DIR, 'customer.html'));
  if (p.startsWith('/uploads/')) return sendFile(res, path.join(UP_DIR, path.basename(p)), 'public, max-age=31536000, immutable');
  const f = path.normalize(path.join(PUBLIC_DIR, p));
  if (!f.startsWith(PUBLIC_DIR + path.sep) || path.extname(f) === '.html') { res.writeHead(404); return res.end('Not found'); }
  return sendFile(res, f);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Server error' });
  });
});

loadDb();
let ticker = null;
if (require.main === module) {
  ticker = setInterval(() => reminderTick().catch((e) => console.error(e)), 60000);
  reminderTick().catch(() => {});
  server.listen(PORT, () => {
    const base = CFG.publicUrl || `http://localhost:${PORT}`;
    console.log(`Service Appointment Platform running on ${base}   (time zone ${process.env.TZ})`);
    console.log(`  Super admin : ${base}/super   (password from SUPER_PASSWORD, default super123)`);
    console.log(`  Administrator: ${base}/admin  (demo: glow / admin123, paws / admin123)`);
    for (const b of db.businesses) console.log(`  Customer link: ${base}/shop/${b.slug}   (${b.name})`);
    console.log(`  Payment: ${billplzLive() ? 'Billplz LIVE' : 'DEMO gateway (set BILLPLZ_* + PUBLIC_URL to go live)'}`);
    console.log(`  Reminders: WhatsApp ${CFG.waToken ? 'LIVE' : 'simulated'}, Email ${CFG.resendKey ? 'LIVE' : 'simulated'}`);
  });
}
module.exports = { server, reminderTick, getDb: () => db, bpSignature };
