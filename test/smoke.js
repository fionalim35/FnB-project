'use strict';
// End-to-end smoke test: boots the server on a temp data dir and walks the full flow
// customer order -> kitchen -> cashier payment -> admin dashboard.
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fnb-'));
const { server } = require('../server');

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  const ok = async (...a) => { const r = await call(...a); assert.strictEqual(r.status, 200, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
  const log = (m) => console.log('✔', m);

  // auth
  assert.strictEqual((await call('POST', '/api/login', { role: 'admin', pin: 'nope' })).status, 401);
  const admin = (await ok('POST', '/api/login', { role: 'admin', pin: '1111' })).token;
  const kitchen = (await ok('POST', '/api/login', { role: 'kitchen', pin: '2222' })).token;
  const cashier = (await ok('POST', '/api/login', { role: 'cashier', pin: '3333' })).token;
  assert.strictEqual((await call('GET', '/api/admin/state')).status, 401);
  assert.strictEqual((await call('GET', '/api/admin/state', null, kitchen)).status, 403);
  assert.strictEqual((await call('GET', '/api/cashier/tables', null, kitchen)).status, 403);
  log('role access control (401 / 403)');

  // customer
  const menu = await ok('GET', '/api/menu');
  const items = menu.categories.flatMap((c) => c.items);
  const noodles = items.find((i) => i.name === 'Braised Beef Noodles');
  const vermi = items.find((i) => i.name === 'Beef Vermicelli Soup');
  const apple = items.find((i) => i.name === 'Green apple juice');
  const sold = items.find((i) => i.soldOut);
  assert((await call('POST', '/api/tables/A10/orders', { lines: [{ itemId: apple.id, qty: 1 }] })).status === 400); // no session yet
  assert((await call('POST', '/api/tables/A10/start', { type: 'dinein', pax: 0 })).status === 400);
  await ok('POST', '/api/tables/A10/start', { type: 'dinein', pax: 2 });
  assert.strictEqual((await call('GET', '/api/tables/ZZ')).status, 404);
  log('table session start (pax required)');

  // compulsory option enforced
  assert((await call('POST', '/api/tables/A10/orders', { lines: [{ itemId: vermi.id, qty: 1 }] })).status === 400);
  assert((await call('POST', '/api/tables/A10/orders', { lines: [{ itemId: sold.id, qty: 1 }] })).status === 400);
  log('compulsory option + sold-out validation');

  const g = noodles.groups[0];
  const blanched = g.options.find((o) => o.name === 'Blanched Beef');
  const r1 = await ok('POST', '/api/tables/A10/orders', { note: 'urgent', lines: [
    { itemId: noodles.id, qty: 1, selections: [{ groupId: g.id, optionId: blanched.id }], excludes: ['Coriander', 'Hacker'], note: 'less salt' },
    { itemId: apple.id, qty: 1 },
  ] });
  const line = r1.bill.orders[0].lines[0];
  assert.strictEqual(line.unitPrice, 28.9); // 19 + 9.9
  assert.deepStrictEqual(line.excludes, ['Coriander']); // unknown exclusions dropped
  assert.strictEqual(r1.bill.subtotal, 38.8);
  assert.strictEqual(r1.bill.total, 45.01); // 38.8 + 6% SST (2.33) + 10% service (3.88)
  log('order pricing: add-ons, exclusions, SST + service charge');

  // kitchen
  const q = await ok('GET', '/api/kitchen/orders', null, kitchen);
  assert.strictEqual(q.orders.length, 1); assert.strictEqual(q.orders[0].tableName, 'A10'); assert.strictEqual(q.orders[0].lines[0].note, 'less salt');
  await ok('POST', `/api/kitchen/orders/${q.orders[0].id}/status`, { status: 'cooking' }, kitchen);
  await ok('POST', `/api/kitchen/orders/${q.orders[0].id}/status`, { status: 'done' }, kitchen);
  log('kitchen receives order, cooking -> done');

  // second round of ordering on same table accumulates in one bill
  await ok('POST', '/api/tables/A10/orders', { lines: [{ itemId: apple.id, qty: 2 }] });
  const t = await ok('GET', '/api/tables/A10');
  assert.strictEqual(t.bill.orders.length, 2); assert.strictEqual(t.bill.subtotal, 58.6);

  // cashier
  const tables = await ok('GET', '/api/cashier/tables', null, cashier);
  const a10 = tables.tables.find((x) => x.id === 'A10');
  assert(a10.bill && a10.bill.pending === 1);
  assert((await call('POST', `/api/cashier/bills/${t.bill.id}/pay`, { method: 'Cash', tendered: 10 }, cashier)).status === 400);
  const paid = await ok('POST', `/api/cashier/bills/${t.bill.id}/pay`, { method: 'Cash', tendered: 100 }, cashier);
  assert.strictEqual(paid.bill.status, 'paid'); assert.strictEqual(paid.bill.paid.change, round(100 - paid.bill.total));
  assert.strictEqual((await ok('GET', '/api/tables/A10')).bill, null); // table refreshed
  assert((await call('POST', `/api/cashier/bills/${t.bill.id}/pay`, { method: 'Cash' }, cashier)).status === 400); // no double pay
  log('cashier payment, change calc, table reset');

  // admin dashboard
  const st = await ok('GET', '/api/admin/stats?period=daily', null, admin);
  assert.strictEqual(st.summary.bills, 1); assert.strictEqual(st.summary.revenue, paid.bill.total);
  assert.strictEqual(st.topItems[0].name, 'Green apple juice'); assert.strictEqual(st.topItems[0].qty, 3);
  for (const p of ['weekly', 'monthly', 'yearly']) assert((await ok('GET', `/api/admin/stats?period=${p}`, null, admin)).series.length > 0);
  await ok('POST', '/api/admin/demo-sales', {}, admin);
  const big = await ok('GET', '/api/admin/stats?period=yearly', null, admin);
  assert(big.summary.bills > 100); assert(big.topItems.length > 3);
  await ok('DELETE', '/api/admin/demo-sales', null, admin);
  assert.strictEqual((await ok('GET', '/api/admin/stats?period=yearly', null, admin)).summary.bills, 1);
  log('dashboard daily/weekly/monthly/yearly + top items + demo data');

  // admin setup
  const cat = (await ok('POST', '/api/admin/categories', { name: 'Desserts', type: 'food' }, admin)).category;
  const dessert = (await ok('POST', '/api/admin/items', { name: 'Ice Kacang', price: 6, description: 'Shaved ice', categoryId: cat.id }, admin)).item;
  await ok('PUT', `/api/admin/items/${dessert.id}`, { promoPrice: 4.5, topPick: true, groups: [{ name: 'Topping', required: true, max: 1, options: [{ name: 'Red bean', price: 0 }, { itemId: apple.id, price: 5 }] }], excludes: ['Peanuts'] }, admin);
  const m2 = await ok('GET', '/api/menu');
  const d2 = m2.categories.find((c) => c.id === cat.id).items[0];
  assert.strictEqual(d2.effPrice, 4.5); assert.strictEqual(d2.groups[0].options[1].price, 5); assert(d2.topPick);
  await ok('PUT', `/api/admin/categories/${cat.id}`, { active: false }, admin);
  assert(!(await ok('GET', '/api/menu')).categories.some((c) => c.id === cat.id));
  await ok('PUT', '/api/admin/settings', { charges: [{ name: 'GST', type: 'percent', value: 8, active: true }] }, admin);
  await ok('POST', '/api/tables/A1/start', { type: 'takeaway' });
  const r2_ = await ok('POST', '/api/tables/A1/orders', { lines: [{ itemId: apple.id, qty: 1 }] });
  assert.strictEqual(r2_.bill.total, 10.69); assert.strictEqual(r2_.bill.type, 'takeaway');
  assert((await call('DELETE', '/api/admin/tables/A1', null, admin)).status === 400);
  log('admin setup: category, item, promo, options, charges, takeaway order');

  // static pages
  for (const p of ['/', '/customer', '/admin', '/kitchen', '/cashier', '/shared.js']) assert.strictEqual((await fetch(base + p)).status, 200, p);
  assert.strictEqual((await fetch(base + '/../server.js')).status, 404);
  assert.strictEqual((await fetch(base + '/index.html')).status, 404);
  log('4 role URLs + static files served');
  console.log('\nALL TESTS PASSED');
  server.close(); process.exit(0);
})().catch((e) => { console.error('\n✖ FAILED:', e.message); process.exit(1); });
function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
