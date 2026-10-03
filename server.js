'use strict';
/**
 * FnB Digital Ordering Platform - zero-dependency Node.js server.
 *   /customer?table=A10  -> customer app (scan table QR)
 *   /admin               -> administrator portal (desktop)
 *   /kitchen             -> kitchen display (iPad)
 *   /cashier             -> cashier / checkout (iPad)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(UP_DIR, { recursive: true });

// ---------------------------------------------------------------- helpers
const uid = () => crypto.randomBytes(6).toString('hex');
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const money = (v) => { const n = num(v, NaN); if (!(n >= 0) || n > 100000) throw bad('Invalid price'); return round2(n); };

// ---------------------------------------------------------------- database
let db;
function seed() {
  const items = [];
  const cats = [
    { id: uid(), name: 'Noodles & Soups', type: 'food', active: true, sort: 10 },
    { id: uid(), name: 'Rice', type: 'food', active: true, sort: 20 },
    { id: uid(), name: 'Snacks', type: 'side', active: true, sort: 30 },
    { id: uid(), name: 'Beverages', type: 'drink', active: true, sort: 40 },
  ];
  const [noodles, rice, snacks, bev] = cats.map((c) => c.id);
  let sort = 0;
  const add = (o) => {
    const it = Object.assign({
      id: uid(), categoryId: null, name: '', description: '', price: 0, promoPrice: null,
      images: [], recommended: false, topPick: false, soldOut: false, active: true,
      groups: [], excludes: [], sort: (sort += 10),
    }, o);
    items.push(it);
    return it;
  };
  // add-on only items (not assigned to a category => hidden from menu, usable as add-ons)
  const blanched = add({ name: 'Blanched Beef', description: 'Extra portion of blanched sliced beef', price: 9.9 });
  const meatball = add({ name: 'Beef Meatball (1pcs)', description: 'Handmade beef meatball', price: 3 });
  const addRice = add({ name: 'ADD RICE NOODLES', description: 'Extra rice noodles', price: 2 });
  const addMee = add({ name: 'ADD MEE', description: 'Extra yellow noodles', price: 2 });

  add({
    categoryId: noodles, name: 'Braised Beef Noodles', price: 19, recommended: true, topPick: true,
    description: 'Slow-braised beef shank in rich house broth, served with hand-pulled noodles.',
    excludes: ['Spring Onions', 'Coriander'],
    groups: [{
      id: uid(), name: 'Extra ADD ON', required: false, max: 0,
      options: [
        { id: uid(), itemId: blanched.id, name: blanched.name, price: 9.9 },
        { id: uid(), itemId: meatball.id, name: meatball.name, price: 3 },
      ],
    }],
  });
  add({
    categoryId: noodles, name: 'Beef Vermicelli Soup', price: 15,
    description: 'Clear beef broth with tender beef slices and rice vermicelli.',
    excludes: ['Spring Onions', 'Coriander'],
    groups: [
      {
        id: uid(), name: 'Soup Base', required: true, max: 1,
        options: [
          { id: uid(), itemId: null, name: 'Clear Soup', price: 0 },
          { id: uid(), itemId: null, name: 'Spicy Soup', price: 1 },
        ],
      },
      {
        id: uid(), name: 'ADD ON', required: false, max: 0,
        options: [
          { id: uid(), itemId: addRice.id, name: addRice.name, price: 1.5 },
          { id: uid(), itemId: addMee.id, name: addMee.name, price: 1.5 },
        ],
      },
    ],
  });
  add({ categoryId: noodles, name: 'Blanched Beef Balls', price: 18, description: 'Blanched beef balls with vermicelli in clear soup.' });
  add({ categoryId: rice, name: 'Braised Beef Rice', price: 17, recommended: true, description: 'Braised beef over steamed rice with pickled greens.', excludes: ['Spring Onions'] });
  add({ categoryId: rice, name: 'Fried Beef Rice', price: 16, description: 'Wok-fried rice with tender beef and egg.' });
  add({ categoryId: snacks, name: 'Haikee Fried Beef Bun', price: 8.9, promoPrice: 6.9, topPick: true, description: 'Our signature crispy fried bun with juicy beef filling.' });
  add({ categoryId: snacks, name: 'Crispy Beef Skewer', price: 12, description: 'Grilled beef skewers (3 sticks) with house sauce.' });
  add({ categoryId: snacks, name: 'Blueberry Crème Élégante', price: 8.9, soldOut: true, description: 'Soft pancake topped with blueberry compote.' });
  add({ categoryId: bev, name: 'Healthy Carrot Milk Juice', price: 9.9, description: 'Fresh carrot blended with milk.' });
  add({ categoryId: bev, name: 'Green apple juice', price: 9.9, description: 'Freshly pressed green apple juice.' });
  add({ categoryId: bev, name: 'Refreshing watermelon juice', price: 9.9, topPick: true, description: 'Cold-pressed watermelon, no added sugar.' });
  add({ categoryId: bev, name: 'TEH O', price: 3.5, description: 'Classic local black tea.' });

  const tables = [];
  for (let i = 1; i <= 10; i++) tables.push({ id: `A${i}`, name: `A${i}`, active: true });
  return {
    settings: {
      name: 'Haikee Fried Beef Bun',
      currency: 'RM',
      publicUrl: '',
      charges: [
        { id: 'sst', name: 'SST', type: 'percent', value: 6, active: true },
        { id: 'svc', name: 'Service Fee', type: 'percent', value: 10, active: true },
      ],
      pins: { admin: '1111', kitchen: '2222', cashier: '3333' },
    },
    tables, categories: cats, items, bills: [], seq: {},
  };
}
function loadDb() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { db = seed(); saveNow(); }
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

// ---------------------------------------------------------------- realtime (SSE)
const clients = new Set();
function broadcast(scope) {
  for (const res of clients) res.write(`data: ${JSON.stringify({ scope, t: Date.now() })}\n\n`);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// ---------------------------------------------------------------- auth
const sessions = new Map();
const ROLES = ['admin', 'kitchen', 'cashier'];
function login(role, pin) {
  if (!ROLES.includes(role)) throw bad('Unknown role');
  const expected = db.settings.pins[role];
  const a = Buffer.from(String(pin)), b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Wrong PIN');
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role, exp: Date.now() + 12 * 3600 * 1000 });
  return token;
}
function authRole(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const s = m && sessions.get(m[1]);
  if (!s || s.exp < Date.now()) return null;
  return s.role;
}

// ---------------------------------------------------------------- domain logic
const itemById = (id) => db.items.find((i) => i.id === id);
const catById = (id) => db.categories.find((c) => c.id === id);
const effPrice = (it) => (it.promoPrice != null && it.promoPrice >= 0 && it.promoPrice < it.price ? it.promoPrice : it.price);
const optionAvailable = (o) => { if (!o.itemId) return true; const it = itemById(o.itemId); return !!it && it.active && !it.soldOut; };

function publicItem(it) {
  return {
    id: it.id, name: it.name, description: it.description, price: it.price, promoPrice: it.promoPrice,
    effPrice: effPrice(it), images: it.images, recommended: it.recommended, topPick: it.topPick,
    soldOut: it.soldOut, excludes: it.excludes,
    groups: it.groups.map((g) => ({
      id: g.id, name: g.name, required: g.required, max: g.max,
      options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price, available: optionAvailable(o) })),
    })),
  };
}
function publicMenu() {
  const s = db.settings;
  return {
    settings: { name: s.name, currency: s.currency, charges: s.charges.filter((c) => c.active) },
    categories: db.categories.filter((c) => c.active).sort((a, b) => a.sort - b.sort).map((c) => ({
      id: c.id, name: c.name, type: c.type,
      items: db.items.filter((i) => i.categoryId === c.id && i.active).sort((a, b) => a.sort - b.sort).map(publicItem),
    })).filter((c) => c.items.length),
  };
}

function buildLine(raw) {
  const it = itemById(raw && raw.itemId);
  const cat = it && it.categoryId && catById(it.categoryId);
  if (!it || !it.active || !cat || !cat.active) throw bad('An item in your cart is no longer available');
  if (it.soldOut) throw bad(`${it.name} is sold out`);
  const qty = Math.floor(num(raw.qty, 1));
  if (qty < 1 || qty > 99) throw bad('Invalid quantity');
  const picked = Array.isArray(raw.selections) ? raw.selections : [];
  const selections = [];
  for (const p of picked) if (!it.groups.some((g) => g.id === p.groupId)) throw bad('Invalid option');
  for (const g of it.groups) {
    const ids = [...new Set(picked.filter((p) => p.groupId === g.id).map((p) => p.optionId))];
    if (g.required && ids.length < 1) throw bad(`Please choose an option for "${g.name}" on ${it.name}`);
    if (g.max > 0 && ids.length > g.max) throw bad(`Too many options for "${g.name}"`);
    for (const oid of ids) {
      const o = g.options.find((x) => x.id === oid);
      if (!o) throw bad('Invalid option');
      if (!optionAvailable(o)) throw bad(`${o.name} is not available`);
      selections.push({ group: g.name, name: o.name, price: o.price });
    }
  }
  const excludes = (Array.isArray(raw.excludes) ? raw.excludes : []).filter((e) => it.excludes.includes(e));
  const unitPrice = round2(effPrice(it) + selections.reduce((s, x) => s + x.price, 0));
  return {
    lineId: uid(), itemId: it.id, name: it.name, category: cat.name, qty, basePrice: effPrice(it),
    unitPrice, selections, excludes, note: str(raw.note, 200),
  };
}

function calcTotals(bill, charges) {
  const subtotal = round2(bill.orders.reduce((s, o) => s + o.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0), 0));
  const list = (charges || db.settings.charges.filter((c) => c.active)).map((c) => ({
    name: c.name, amount: round2(c.type === 'percent' ? subtotal * c.value / 100 : c.value),
  }));
  return { subtotal, charges: list, total: round2(subtotal + list.reduce((s, c) => s + c.amount, 0)) };
}
const billTotals = (bill) => (bill.status === 'paid' ? bill.paid : calcTotals(bill));
function billView(b) {
  if (!b) return null;
  const t = billTotals(b);
  return {
    id: b.id, no: b.no, tableId: b.tableId, tableName: b.tableName, pax: b.pax, type: b.type, status: b.status,
    createdAt: b.createdAt, billRequested: !!b.billRequested, receiptPrinted: !!b.receiptPrinted,
    orders: b.orders, subtotal: t.subtotal, charges: t.charges, total: t.total,
    paid: b.status === 'paid' ? { at: b.paid.at, method: b.paid.method, tendered: b.paid.tendered, change: b.paid.change } : null,
  };
}
const openBill = (tableId) => db.bills.find((b) => b.tableId === tableId && b.status === 'open');
function activeTable(id) {
  const t = db.tables.find((x) => x.id === id);
  if (!t) throw new HttpError(404, 'Table not found');
  if (!t.active) throw bad('This table is not active');
  return t;
}
function nextReceiptNo(d) {
  const key = ymd(d);
  db.seq[key] = (db.seq[key] || 0) + 1;
  return `R${key.replace(/-/g, '')}-${String(db.seq[key]).padStart(3, '0')}`;
}

// ---------------------------------------------------------------- statistics
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
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
  return out.map((b) => ({ key: bucketKey(period, b.d), label: b.label, start: b.d, revenue: 0, net: 0, bills: 0, items: 0 }));
}
function stats(period) {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) period = 'daily';
  const bs = buckets(period, new Date());
  const idx = new Map(bs.map((b) => [b.key, b]));
  const from = bs[0].start.getTime();
  const top = new Map(), cat = new Map();
  let revenue = 0, net = 0, bills = 0, itemsSold = 0, pax = 0;
  for (const b of db.bills) {
    if (b.status !== 'paid') continue;
    const at = new Date(b.paid.at);
    if (at.getTime() < from) continue;
    const bk = idx.get(bucketKey(period, at));
    if (!bk) continue;
    const qty = b.orders.reduce((s, o) => s + o.lines.reduce((t, l) => t + l.qty, 0), 0);
    bk.revenue += b.paid.total; bk.net += b.paid.subtotal; bk.bills++; bk.items += qty;
    revenue += b.paid.total; net += b.paid.subtotal; bills++; itemsSold += qty; pax += b.pax || 0;
    for (const o of b.orders) for (const l of o.lines) {
      const t = top.get(l.itemId) || { itemId: l.itemId, name: l.name, qty: 0, revenue: 0 };
      t.qty += l.qty; t.revenue += l.qty * l.unitPrice; top.set(l.itemId, t);
      const c = cat.get(l.category) || { name: l.category, qty: 0, revenue: 0 };
      c.qty += l.qty; c.revenue += l.qty * l.unitPrice; cat.set(l.category, c);
    }
  }
  const fix = (o) => Object.assign(o, { revenue: round2(o.revenue) });
  const open = db.bills.filter((b) => b.status === 'open');
  return {
    period,
    summary: { revenue: round2(revenue), net: round2(net), bills, itemsSold, avgBill: bills ? round2(revenue / bills) : 0, pax },
    series: bs.map((b) => ({ key: b.key, label: b.label, revenue: round2(b.revenue), net: round2(b.net), bills: b.bills, items: b.items })),
    topItems: [...top.values()].map(fix).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 15),
    categories: [...cat.values()].map(fix).sort((a, b) => b.revenue - a.revenue),
    catalog: {
      totalItems: db.items.length,
      listedItems: db.items.filter((i) => i.categoryId).length,
      activeItems: db.items.filter((i) => i.categoryId && i.active && !i.soldOut).length,
      categories: db.categories.map((c) => ({ name: c.name, active: c.active, items: db.items.filter((i) => i.categoryId === c.id).length })),
    },
    live: { openTables: open.length, openAmount: round2(open.reduce((s, b) => s + calcTotals(b).total, 0)) },
  };
}
function demoSales() {
  const pool = db.items.filter((i) => i.categoryId && i.active);
  if (!pool.length || !db.tables.length) throw bad('Set up menu items and tables first');
  // weight items so the ranking is not flat
  const weighted = [];
  pool.forEach((it, i) => { const w = 1 + ((pool.length - i) % 5) + (it.topPick ? 3 : 0) + (it.recommended ? 2 : 0); for (let k = 0; k < w; k++) weighted.push(it); });
  const now = Date.now();
  const methods = ['Cash', 'Card', 'E-Wallet', 'QR Pay'];
  let n = 0;
  for (let day = 400; day >= 0; day--) {
    const count = 8 + Math.floor(Math.random() * 14) + (day < 60 ? 6 : 0);
    for (let k = 0; k < count; k++) {
      const hour = [12, 12, 13, 13, 14, 18, 19, 19, 20, 21][Math.floor(Math.random() * 10)];
      const at = new Date(now - day * 86400000);
      at.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
      if (at.getTime() > now) continue;
      const t = db.tables[Math.floor(Math.random() * db.tables.length)];
      const lines = [];
      for (let j = 1 + Math.floor(Math.random() * 3); j > 0; j--) {
        const it = weighted[Math.floor(Math.random() * weighted.length)];
        lines.push({
          lineId: uid(), itemId: it.id, name: it.name, category: catById(it.categoryId).name, qty: 1 + (Math.random() < 0.25 ? 1 : 0),
          basePrice: effPrice(it), unitPrice: effPrice(it), selections: [], excludes: [], note: '',
        });
      }
      const bill = {
        id: uid(), no: nextReceiptNo(at), tableId: t.id, tableName: t.name, pax: 1 + Math.floor(Math.random() * 4),
        type: Math.random() < 0.15 ? 'takeaway' : 'dinein', status: 'paid', createdAt: at.getTime() - 40 * 60000, demo: true,
        orders: [{ id: uid(), createdAt: at.getTime() - 38 * 60000, status: 'done', doneAt: at.getTime() - 25 * 60000, note: '', lines }],
      };
      const tot = calcTotals(bill, db.settings.charges.filter((c) => c.active));
      bill.paid = Object.assign(tot, { at: at.getTime(), method: methods[Math.floor(Math.random() * 4)], tendered: null, change: null });
      db.bills.push(bill); n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- admin mutations
function applyCategory(c, b) {
  if (b.name !== undefined) { c.name = str(b.name, 60); if (!c.name) throw bad('Category name required'); }
  if (b.type !== undefined) c.type = ['food', 'drink', 'side'].includes(b.type) ? b.type : 'food';
  if (b.active !== undefined) c.active = !!b.active;
  return c;
}
function cleanGroups(groups) {
  if (!Array.isArray(groups)) throw bad('Invalid options');
  return groups.slice(0, 20).map((g) => {
    const name = str(g.name, 60); if (!name) throw bad('Every option group needs a name');
    return {
      id: str(g.id, 20) || uid(), name, required: !!g.required, max: Math.max(0, Math.min(50, Math.floor(num(g.max, 0)))),
      options: (Array.isArray(g.options) ? g.options : []).slice(0, 60).map((o) => {
        const linked = o.itemId ? itemById(o.itemId) : null;
        const oname = linked ? linked.name : str(o.name, 80);
        if (!oname) throw bad('Option name required');
        return { id: str(o.id, 20) || uid(), itemId: linked ? linked.id : null, name: oname, price: money(o.price) };
      }),
    };
  });
}
function applyItem(it, b) {
  if (b.name !== undefined) { it.name = str(b.name, 80); if (!it.name) throw bad('Item name required'); }
  if (b.description !== undefined) it.description = str(b.description, 600);
  if (b.price !== undefined) it.price = money(b.price);
  if (b.promoPrice !== undefined) it.promoPrice = b.promoPrice === null || b.promoPrice === '' ? null : money(b.promoPrice);
  if (it.promoPrice != null && it.promoPrice >= it.price) it.promoPrice = null;
  if (b.categoryId !== undefined) {
    if (b.categoryId && !catById(b.categoryId)) throw bad('Unknown category');
    if ((b.categoryId || null) !== it.categoryId) it.sort = Math.max(0, ...db.items.map((i) => i.sort)) + 10;
    it.categoryId = b.categoryId || null;
  }
  for (const k of ['recommended', 'topPick', 'soldOut', 'active']) if (b[k] !== undefined) it[k] = !!b[k];
  if (b.images !== undefined) it.images = (Array.isArray(b.images) ? b.images : []).filter((u) => /^\/uploads\/[\w.-]+$/.test(u)).slice(0, 10);
  if (b.excludes !== undefined) it.excludes = [...new Set((Array.isArray(b.excludes) ? b.excludes : []).map((e) => str(e, 40)).filter(Boolean))].slice(0, 30);
  if (b.groups !== undefined) it.groups = cleanGroups(b.groups);
  return it;
}
function applySettings(b) {
  const s = db.settings;
  if (b.name !== undefined) s.name = str(b.name, 80) || s.name;
  if (b.currency !== undefined) s.currency = str(b.currency, 5) || 'RM';
  if (b.publicUrl !== undefined) s.publicUrl = str(b.publicUrl, 200).replace(/\/+$/, '');
  if (b.charges !== undefined) {
    if (!Array.isArray(b.charges)) throw bad('Invalid charges');
    s.charges = b.charges.slice(0, 10).map((c) => {
      const name = str(c.name, 40); if (!name) throw bad('Charge name required');
      const value = num(c.value, NaN); if (!(value >= 0) || value > 100000) throw bad('Invalid charge value');
      return { id: str(c.id, 20) || uid(), name, type: c.type === 'fixed' ? 'fixed' : 'percent', value, active: !!c.active };
    });
  }
  if (b.pins) for (const r of ROLES) if (b.pins[r] !== undefined && b.pins[r] !== '') {
    const p = String(b.pins[r]);
    if (!/^\d{4,8}$/.test(p)) throw bad('PIN must be 4-8 digits');
    s.pins[r] = p;
  }
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, roles, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), roles, fn });
const ADMIN = ['admin'], KITCHEN = ['kitchen', 'admin'], CASHIER = ['cashier', 'admin'];

// public
route('GET', '/api/menu', null, () => publicMenu());
route('POST', '/api/login', null, ({ body }) => ({ token: login(body.role, body.pin), role: body.role }));
route('GET', '/api/tables/:id', null, ({ params }) => {
  const t = activeTable(params.id);
  return { table: { id: t.id, name: t.name }, bill: billView(openBill(t.id)) };
});
route('POST', '/api/tables/:id/start', null, ({ params, body }) => {
  const t = activeTable(params.id);
  let b = openBill(t.id);
  if (!b) {
    const takeaway = body.type === 'takeaway';
    const pax = takeaway ? 0 : Math.floor(num(body.pax, 0));
    if (!takeaway && (pax < 1 || pax > 50)) throw bad('Please select number of diners');
    const now = new Date();
    b = { id: uid(), no: nextReceiptNo(now), tableId: t.id, tableName: t.name, pax, type: takeaway ? 'takeaway' : 'dinein', status: 'open', createdAt: now.getTime(), orders: [] };
    db.bills.push(b); save(); broadcast('bills');
  }
  return { bill: billView(b) };
});
route('POST', '/api/tables/:id/orders', null, ({ params, body }) => {
  const t = activeTable(params.id);
  const b = openBill(t.id);
  if (!b) throw bad('Please start your session first');
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 50) throw bad('Your cart is empty');
  const lines = body.lines.map(buildLine);
  b.orders.push({ id: uid(), createdAt: Date.now(), status: 'new', note: str(body.note, 300), lines });
  b.billRequested = false;
  save(); broadcast('orders');
  return { bill: billView(b) };
});
route('POST', '/api/tables/:id/request-bill', null, ({ params }) => {
  const b = openBill(activeTable(params.id).id);
  if (!b) throw bad('No open bill');
  b.billRequested = true; save(); broadcast('bills');
  return { bill: billView(b) };
});

// kitchen
route('GET', '/api/kitchen/orders', KITCHEN, () => {
  const out = [];
  const since = Date.now() - 6 * 3600 * 1000;
  for (const b of db.bills) for (const o of b.orders) {
    if (o.status !== 'done' || (o.doneAt || 0) > since) {
      out.push({ id: o.id, billNo: b.no, tableName: b.tableName, type: b.type, pax: b.pax, createdAt: o.createdAt, status: o.status, doneAt: o.doneAt || null, note: o.note || '', lines: o.lines });
    }
  }
  return { orders: out.sort((a, b) => a.createdAt - b.createdAt) };
});
route('POST', '/api/kitchen/orders/:id/status', KITCHEN, ({ params, body }) => {
  if (!['new', 'cooking', 'done'].includes(body.status)) throw bad('Invalid status');
  for (const b of db.bills) for (const o of b.orders) if (o.id === params.id) {
    o.status = body.status;
    if (body.status === 'done') o.doneAt = Date.now(); else delete o.doneAt;
    save(); broadcast('orders');
    return { ok: true };
  }
  throw new HttpError(404, 'Order not found');
});

// cashier
route('GET', '/api/cashier/tables', CASHIER, () => ({
  tables: db.tables.filter((t) => t.active).map((t) => {
    const b = openBill(t.id);
    return { id: t.id, name: t.name, bill: b && { id: b.id, type: b.type, pax: b.pax, total: calcTotals(b).total, orders: b.orders.length, pending: b.orders.filter((o) => o.status !== 'done').length, billRequested: !!b.billRequested, createdAt: b.createdAt } };
  }),
}));
route('GET', '/api/cashier/bills/:id', CASHIER, ({ params }) => {
  const b = db.bills.find((x) => x.id === params.id);
  if (!b) throw new HttpError(404, 'Bill not found');
  return { bill: billView(b), restaurant: { name: db.settings.name, currency: db.settings.currency } };
});
route('POST', '/api/cashier/bills/:id/printed', CASHIER, ({ params }) => {
  const b = db.bills.find((x) => x.id === params.id);
  if (!b) throw new HttpError(404, 'Bill not found');
  b.receiptPrinted = true; save(); broadcast('bills');
  return { ok: true };
});
route('POST', '/api/cashier/bills/:id/pay', CASHIER, ({ params, body }) => {
  const b = db.bills.find((x) => x.id === params.id);
  if (!b) throw new HttpError(404, 'Bill not found');
  if (b.status !== 'open') throw bad('Bill already paid');
  if (!b.orders.length) throw bad('Bill has no items. Use "Clear table" instead.');
  const method = ['Cash', 'Card', 'E-Wallet', 'QR Pay'].includes(body.method) ? body.method : null;
  if (!method) throw bad('Select a payment method');
  const tot = calcTotals(b);
  let tendered = null, change = null;
  if (method === 'Cash' && body.tendered !== undefined && body.tendered !== '') {
    tendered = money(body.tendered);
    if (tendered < tot.total) throw bad('Cash received is less than total');
    change = round2(tendered - tot.total);
  }
  b.status = 'paid';
  b.paid = Object.assign(tot, { at: Date.now(), method, tendered, change });
  for (const o of b.orders) if (o.status !== 'done') { o.status = 'done'; o.doneAt = Date.now(); }
  save(); broadcast('bills');
  return { bill: billView(b) };
});
route('POST', '/api/cashier/bills/:id/clear', CASHIER, ({ params }) => {
  const i = db.bills.findIndex((x) => x.id === params.id);
  const b = db.bills[i];
  if (!b) throw new HttpError(404, 'Bill not found');
  if (b.status !== 'open' || b.orders.length) throw bad('Only an empty open bill can be cleared');
  db.bills.splice(i, 1); save(); broadcast('bills');
  return { ok: true };
});
route('GET', '/api/cashier/history', CASHIER, () => {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const list = db.bills.filter((b) => b.status === 'paid' && b.paid.at >= d0.getTime()).sort((a, b) => b.paid.at - a.paid.at);
  return { bills: list.map((b) => ({ id: b.id, no: b.no, tableName: b.tableName, total: b.paid.total, method: b.paid.method, at: b.paid.at })), total: round2(list.reduce((s, b) => s + b.paid.total, 0)) };
});

// admin
route('GET', '/api/admin/state', ADMIN, () => ({
  settings: db.settings, tables: db.tables,
  categories: [...db.categories].sort((a, b) => a.sort - b.sort),
  items: [...db.items].sort((a, b) => a.sort - b.sort),
  openTableIds: db.bills.filter((b) => b.status === 'open').map((b) => b.tableId),
}));
route('GET', '/api/admin/stats', ADMIN, ({ query }) => stats(query.period));
route('PUT', '/api/admin/settings', ADMIN, ({ body }) => { applySettings(body); save(); broadcast('menu'); return { settings: db.settings }; });

route('POST', '/api/admin/categories', ADMIN, ({ body }) => {
  const c = applyCategory({ id: uid(), name: '', type: 'food', active: true, sort: Math.max(0, ...db.categories.map((x) => x.sort)) + 10 }, body);
  db.categories.push(c); save(); broadcast('menu'); return { category: c };
});
route('PUT', '/api/admin/categories/:id', ADMIN, ({ params, body }) => {
  const c = catById(params.id); if (!c) throw new HttpError(404, 'Category not found');
  applyCategory(c, body); save(); broadcast('menu'); return { category: c };
});
route('POST', '/api/admin/categories/reorder', ADMIN, ({ body }) => {
  (Array.isArray(body.ids) ? body.ids : []).forEach((id, i) => { const c = catById(id); if (c) c.sort = (i + 1) * 10; });
  save(); broadcast('menu'); return { ok: true };
});
route('DELETE', '/api/admin/categories/:id', ADMIN, ({ params }) => {
  const c = catById(params.id); if (!c) throw new HttpError(404, 'Category not found');
  if (db.items.some((i) => i.categoryId === c.id)) throw bad('Category still has items. Move/remove them first, or deactivate the category instead.');
  db.categories = db.categories.filter((x) => x !== c); save(); broadcast('menu'); return { ok: true };
});
route('POST', '/api/admin/categories/:id/reorder', ADMIN, ({ params, body }) => {
  (Array.isArray(body.ids) ? body.ids : []).forEach((id, i) => { const it = itemById(id); if (it && it.categoryId === params.id) it.sort = (i + 1) * 10; });
  save(); broadcast('menu'); return { ok: true };
});

route('POST', '/api/admin/items', ADMIN, ({ body }) => {
  const it = applyItem({
    id: uid(), categoryId: null, name: '', description: '', price: 0, promoPrice: null, images: [], recommended: false,
    topPick: false, soldOut: false, active: true, groups: [], excludes: [], sort: Math.max(0, ...db.items.map((i) => i.sort)) + 10,
  }, body);
  db.items.push(it); save(); broadcast('menu'); return { item: it };
});
route('PUT', '/api/admin/items/:id', ADMIN, ({ params, body }) => {
  const it = itemById(params.id); if (!it) throw new HttpError(404, 'Item not found');
  applyItem(it, body); save(); broadcast('menu'); return { item: it };
});
route('DELETE', '/api/admin/items/:id', ADMIN, ({ params }) => {
  const it = itemById(params.id); if (!it) throw new HttpError(404, 'Item not found');
  db.items = db.items.filter((x) => x !== it);
  for (const o of db.items) for (const g of o.groups) for (const op of g.options) if (op.itemId === it.id) op.itemId = null; // keep as custom option
  save(); broadcast('menu'); return { ok: true };
});

route('POST', '/api/admin/tables', ADMIN, ({ body }) => {
  const name = str(body.name, 20); if (!name) throw bad('Table name required');
  const id = name.toUpperCase().replace(/[^A-Z0-9_-]+/g, '');
  if (!id) throw bad('Table name must contain letters or numbers');
  if (db.tables.some((t) => t.id === id)) throw bad('Table already exists');
  const t = { id, name, active: true }; db.tables.push(t); save(); broadcast('tables'); return { table: t };
});
route('PUT', '/api/admin/tables/:id', ADMIN, ({ params, body }) => {
  const t = db.tables.find((x) => x.id === params.id); if (!t) throw new HttpError(404, 'Table not found');
  if (body.name !== undefined) t.name = str(body.name, 20) || t.name;
  if (body.active !== undefined) t.active = !!body.active;
  save(); broadcast('tables'); return { table: t };
});
route('DELETE', '/api/admin/tables/:id', ADMIN, ({ params }) => {
  if (openBill(params.id)) throw bad('Table has an open bill');
  db.tables = db.tables.filter((t) => t.id !== params.id); save(); broadcast('tables'); return { ok: true };
});

route('POST', '/api/admin/demo-sales', ADMIN, () => { const n = demoSales(); save(); broadcast('bills'); return { created: n }; });
route('DELETE', '/api/admin/demo-sales', ADMIN, () => {
  const before = db.bills.length; db.bills = db.bills.filter((b) => !b.demo); save(); broadcast('bills');
  return { removed: before - db.bills.length };
});

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// ---------------------------------------------------------------- http plumbing
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json', '.ico': 'image/x-icon' };
const PAGES = { '/': 'index.html', '/customer': 'customer.html', '/admin': 'admin.html', '/kitchen': 'kitchen.html', '/cashier': 'cashier.html' };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendFile(res, file, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/(.)\/+$/, '$1');

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clients.add(res); req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/admin/upload' && req.method === 'POST') {
    if (authRole(req) !== 'admin') throw new HttpError(401, 'Please log in');
    const ext = EXT[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) throw bad('Only JPG, PNG, WEBP or GIF images are allowed');
    const buf = await readBody(req, 6 * 1024 * 1024);
    if (!buf.length) throw bad('Empty file');
    const name = `${uid()}${uid()}.${ext}`;
    fs.writeFileSync(path.join(UP_DIR, name), buf);
    return sendJson(res, 200, { url: `/uploads/${name}` });
  }
  if (p.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(p);
      if (!m) continue;
      let role = null;
      if (r.roles) {
        role = authRole(req);
        if (!role) throw new HttpError(401, 'Please log in');
        if (!r.roles.includes(role)) throw new HttpError(403, 'Not allowed for your role');
      }
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        const raw = await readBody(req, 1024 * 1024);
        if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { throw bad('Invalid JSON'); } }
      }
      const out = await r.fn({ params: decodeParams(m.groups), query: Object.fromEntries(url.searchParams), body, role });
      return sendJson(res, 200, out);
    }
    throw new HttpError(404, 'Unknown API');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  if (PAGES[p]) return sendFile(res, path.join(PUBLIC_DIR, PAGES[p]));
  if (p.startsWith('/uploads/')) {
    const f = path.join(UP_DIR, path.basename(p));
    return sendFile(res, f, 'public, max-age=31536000, immutable');
  }
  const f = path.normalize(path.join(PUBLIC_DIR, p));
  if (!f.startsWith(PUBLIC_DIR + path.sep) || path.extname(f) === '.html') { res.writeHead(404); return res.end('Not found'); }
  return sendFile(res, f);
}
function decodeParams(g) { const o = {}; for (const k in g || {}) o[k] = decodeURIComponent(g[k]); return o; }

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Server error' });
  });
});

loadDb();
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`FnB platform running on http://localhost:${PORT}`);
    for (const p of ['/customer?table=A1', '/admin', '/kitchen', '/cashier']) console.log(`  http://localhost:${PORT}${p}`);
  });
}
module.exports = { server };
