'use strict';
// End-to-end smoke test: super admin -> admin setup -> customer booking -> payment -> reminders -> dashboards.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apt-'));
const { server, reminderTick, getDb } = require('../server');

let base, passed = 0;
const call = async (method, url, body, token) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};
const ok = async (...a) => { const r = await call(...a); assert.strictEqual(r.status, 200, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const fail = async (status, ...a) => { const r = await call(...a); assert.strictEqual(r.status, status, `${a[0]} ${a[1]} expected ${status} got ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const test = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  let sup, glow, pawsTok, cust, cust2, order, facial, facialDetail, date, slot, apptId;
  const line = (extra) => ({ itemId: facial.id, addons: [], areaId: facialDetail.areas.find((a) => a.type === 'shop').id, ...extra });

  await test('pages are served', async () => {
    for (const p of ['/', '/admin', '/super', '/shop/glow', '/common.js']) assert.strictEqual((await fetch(base + p)).status, 200, p);
    assert.strictEqual((await fetch(base + '/server.js')).status, 404);
  });

  await test('super admin login + onboarding + deactivate', async () => {
    await fail(401, 'POST', '/api/super/login', { password: 'nope' });
    sup = (await ok('POST', '/api/super/login', { password: 'super123' })).token;
    await fail(401, 'GET', '/api/super/stats');
    const b = await ok('POST', '/api/super/businesses', { name: 'Test Spa', industry: 'Spa', adminUser: 'spa', adminPass: 'secret1' }, sup);
    assert.strictEqual(b.slug, 'test-spa');
    await fail(400, 'POST', '/api/super/businesses', { name: 'Test Spa', adminUser: 'spa2', adminPass: 'secret1' }, sup);
    await ok('PUT', '/api/super/businesses/' + b.id, { active: false }, sup);
    await fail(403, 'POST', '/api/admin/login', { username: 'spa', password: 'secret1' });
    await fail(403, 'GET', '/api/shop/test-spa');
    await ok('PUT', '/api/super/businesses/' + b.id, { active: true }, sup);
    const s = await ok('GET', '/api/super/stats?period=monthly', undefined, sup);
    assert.strictEqual(s.platform.total, 3); assert.strictEqual(s.platform.active, 3);
  });

  await test('administrator login and tenant isolation', async () => {
    await fail(401, 'POST', '/api/admin/login', { username: 'glow', password: 'bad' });
    glow = (await ok('POST', '/api/admin/login', { username: 'glow', password: 'admin123' })).token;
    pawsTok = (await ok('POST', '/api/admin/login', { username: 'paws', password: 'admin123' })).token;
    const gi = await ok('GET', '/api/admin/items', undefined, glow);
    const pi = await ok('GET', '/api/admin/items', undefined, pawsTok);
    assert(gi.length && pi.length);
    assert(!gi.some((i) => pi.some((p) => p.id === i.id)));
    await fail(404, 'PUT', '/api/admin/items/' + pi[0].id, { name: 'hacked' }, glow);
    await fail(401, 'GET', '/api/admin/items', undefined, sup);
  });

  await test('admin setup: category, service, promo, add-on bundle', async () => {
    const cat = await ok('POST', '/api/admin/categories', { name: 'Waxing', icon: '🪒' }, glow);
    await fail(400, 'POST', '/api/admin/categories', { name: 'waxing' }, glow);
    const it = await ok('POST', '/api/admin/items', { name: 'Leg Wax', price: 50, durationMin: 30, categoryId: cat.id, description: 'x' }, glow);
    await fail(400, 'PUT', '/api/admin/items/' + it.id, { promoPrice: 80 }, glow);
    await ok('PUT', '/api/admin/items/' + it.id, { promoPrice: 40, promoFrom: inDays(0), promoTo: inDays(5), topPick: true }, glow);
    const eye = (await ok('GET', '/api/admin/items', undefined, glow)).find((i) => i.name === 'Eye Treatment');
    await ok('PUT', '/api/admin/items/' + it.id, { groups: [{ name: 'ADD ON', required: true, max: 1, options: [{ itemId: eye.id, price: 20 }] }] }, glow);
    await fail(400, 'PUT', '/api/admin/items/' + it.id, { groups: [{ name: 'Bad', options: [{ itemId: 'zzz' }] }] }, glow);
    await fail(409, 'DELETE', '/api/admin/categories/' + cat.id, undefined, glow);
  });

  await test('customer login: validation, own account, email check, per-business token', async () => {
    await fail(400, 'POST', '/api/shop/glow/login', { name: 'A', phone: '1', email: 'x' });
    cust = (await ok('POST', '/api/shop/glow/login', { name: 'Siti Aminah', phone: '012-345 6789', email: 'siti@example.com' })).token;
    await fail(401, 'POST', '/api/shop/glow/login', { name: 'Siti', phone: '0123456789', email: 'other@example.com' });
    await fail(401, 'GET', '/api/shop/glow/services');
    const pawsLogin = await ok('POST', '/api/shop/paws/login', { name: 'Siti Aminah', phone: '0123456789', email: 'siti@example.com' });
    await fail(401, 'GET', '/api/shop/glow/services', undefined, pawsLogin.token);
    cust2 = (await ok('POST', '/api/shop/glow/login', { name: 'Raj Kumar', phone: '0199999999', email: 'raj@example.com' })).token;
  });

  await test('browse: filter by category, search, area; suggestions; detail', async () => {
    const all = await ok('GET', '/api/shop/glow/services', undefined, cust);
    assert(all.length >= 7 && all[0].topPick, 'top picks first');
    assert(!all.some((s) => ['Eye Treatment', 'Nail Art'].includes(s.name)), 'add-on-only items hidden');
    assert.deepStrictEqual((await ok('GET', '/api/shop/glow/services?q=manicure', undefined, cust)).map((s) => s.name), ['Gel Manicure']);
    assert.strictEqual((await ok('GET', '/api/shop/glow/services?areaType=home', undefined, cust)).length, all.length);
    assert((await ok('GET', '/api/shop/glow/suggest?q=fac', undefined, cust)).length >= 2);
    facial = all.find((s) => s.name === 'Hydrating Facial');
    assert(facial.nextAvailable);
    facialDetail = await ok('GET', '/api/shop/glow/services/' + facial.id, undefined, cust);
    assert(facialDetail.groups[0].options.length === 2 && facialDetail.areas.length === 2);
    const wax = all.find((s) => s.name === 'Leg Wax');
    assert(wax.promo && wax.effPrice === 40 && wax.price === 50);
  });

  await test('availability: slots follow opening days and staff tagging', async () => {
    const days = await ok('POST', '/api/shop/glow/days', { itemId: facial.id }, cust);
    const open = days.days.find((d) => d.state === 'open');
    assert(open); date = open.date;
    const av = await ok('POST', '/api/shop/glow/availability', { itemId: facial.id, date }, cust);
    slot = av.slots.find((s) => s.available).time;
    assert(days.days.filter((d) => d.state === 'closed').length >= 3, 'Sundays closed');
  });

  await test('quote: compulsory add-on, home address, totals, charges', async () => {
    const home = facialDetail.areas.find((a) => a.type === 'home');
    await fail(400, 'POST', '/api/shop/glow/quote', { lines: [line({ areaId: home.id, address: 'x', date, time: slot })] }, cust);
    await fail(400, 'POST', '/api/shop/glow/quote', { lines: [line({ date })] }, cust); // no time chosen
    const opt = facialDetail.groups[0].options[0];
    const q = await ok('POST', '/api/shop/glow/quote', { lines: [line({ date, time: slot, addons: [opt.id] })] }, cust);
    assert.strictEqual(q.subtotal, 120 + opt.price);
    const total = Math.round(q.subtotal * 1.18 * 100) / 100;
    assert.strictEqual(q.total, total, 'service charge 10% + SST 8%');
    assert.strictEqual(q.points, Math.floor(total));
    const hq = await ok('POST', '/api/shop/glow/quote', { lines: [line({ areaId: home.id, address: '1 Jalan Test, KL 50000', date, time: slot })] }, cust);
    assert.strictEqual(hq.subtotal, 140, 'home travel fee added');
    await fail(400, 'POST', '/api/shop/glow/quote', { lines: [line({ date: inDays(-1), time: slot })] }, cust);
    await fail(400, 'POST', '/api/shop/glow/quote', { lines: [] }, cust);
  });

  await test('order -> hold -> slot disappears -> pay -> points', async () => {
    const opt = facialDetail.groups[0].options[0];
    order = await ok('POST', '/api/shop/glow/orders', { lines: [line({ date, time: slot, addons: [opt.id], remark: 'Sensitive skin' })] }, cust);
    assert.strictEqual(order.status, 'pending_payment');
    const ord2 = await ok('POST', '/api/shop/glow/orders', { lines: [line({ date, time: slot, remark: 'second' })] }, cust2);
    const third = await call('POST', '/api/shop/glow/orders', { lines: [line({ date, time: slot })] }, cust2);
    assert.strictEqual(third.status, 409, 'both facial staff booked => slot gone: ' + JSON.stringify(third.data));
    const av = await ok('POST', '/api/shop/glow/availability', { itemId: facial.id, date }, cust2);
    assert.strictEqual(av.slots.find((s) => s.time === slot).available, false);
    await fail(404, 'GET', '/api/shop/glow/orders/' + order.id, undefined, cust2);
    await fail(404, 'POST', `/api/shop/glow/orders/${order.id}/pay`, { method: 'card' }, cust2);
    await fail(400, 'POST', `/api/shop/glow/orders/${order.id}/pay`, { method: 'bitcoin' }, cust);
    const paid = await ok('POST', `/api/shop/glow/orders/${order.id}/pay`, { method: 'fpx' }, cust);
    assert.strictEqual(paid.status, 'paid'); assert(paid.payment.ref);
    assert.strictEqual((await ok('POST', `/api/shop/glow/orders/${order.id}/pay`, { method: 'fpx' }, cust)).payment.ref, paid.payment.ref, 'idempotent');
    const me = await ok('GET', '/api/shop/glow/me', undefined, cust);
    assert.strictEqual(me.customer.points, paid.points); assert(paid.points > 100);
    const db = getDb(); db.orders.find((o) => o.id === ord2.id).holdUntil = Date.now() - 1000;
    const av2 = await ok('POST', '/api/shop/glow/availability', { itemId: facial.id, date }, cust2);
    assert.strictEqual(av2.slots.find((s) => s.time === slot).available, true, 'expired hold released');
    await fail(409, 'POST', `/api/shop/glow/orders/${ord2.id}/pay`, { method: 'card' }, cust2);
  });

  await test('customer sees only own appointments', async () => {
    const a1 = await ok('GET', '/api/shop/glow/appointments', undefined, cust);
    assert.strictEqual(a1.length, 1); assert.strictEqual((await ok('GET', '/api/shop/glow/appointments', undefined, cust2)).length, 0);
    assert.strictEqual(a1[0].remark, 'Sensitive skin'); assert(!a1[0].customer && !a1[0].staffName, 'no internals leaked');
  });

  await test('admin sees paid booking with payment, points, remark; progress; reassign', async () => {
    const list = await ok('GET', `/api/admin/appointments?from=${date}&to=${date}`, undefined, glow);
    assert.strictEqual(list.length, 1);
    const a = list[0]; apptId = a.id;
    assert.strictEqual(a.customer.name, 'Siti Aminah'); assert.strictEqual(a.order.payment.method, 'fpx'); assert(a.order.points > 0); assert.strictEqual(a.remark, 'Sensitive skin');
    assert.strictEqual((await ok('GET', '/api/admin/appointments', undefined, pawsTok)).length, 0, 'other business sees nothing');
    const other = (await ok('GET', `/api/admin/appointments/${a.id}/staff`, undefined, glow)).find((s) => s.id !== a.staffId);
    if (other) assert.strictEqual((await ok('PUT', '/api/admin/appointments/' + a.id, { staffId: other.id }, glow)).staffId, other.id);
    await fail(404, 'PUT', '/api/admin/appointments/' + a.id, { status: 'completed' }, pawsTok);
    await fail(400, 'PUT', '/api/admin/appointments/' + a.id, { status: 'weird' }, glow);
    await ok('PUT', '/api/admin/appointments/' + a.id, { status: 'in_progress' }, glow);
  });

  await test('reviews only after completion, once', async () => {
    await fail(400, 'POST', '/api/shop/glow/reviews', { apptId, rating: 5, comment: 'x' }, cust);
    await ok('PUT', '/api/admin/appointments/' + apptId, { status: 'completed' }, glow);
    await fail(404, 'POST', '/api/shop/glow/reviews', { apptId, rating: 5 }, cust2);
    await fail(400, 'POST', '/api/shop/glow/reviews', { apptId, rating: 9 }, cust);
    await ok('POST', '/api/shop/glow/reviews', { apptId, rating: 5, comment: 'Lovely!' }, cust);
    await fail(400, 'POST', '/api/shop/glow/reviews', { apptId, rating: 4 }, cust);
    const d = await ok('GET', '/api/shop/glow/services/' + facial.id, undefined, cust);
    assert.strictEqual(d.reviews, 1); assert.strictEqual(d.recentReviews[0].name, 'Siti');
    assert.strictEqual((await ok('GET', '/api/admin/reviews', undefined, glow)).length, 1);
  });

  await test('voucher assigned by admin is auto-deducted on the next order', async () => {
    const siti = (await ok('GET', '/api/admin/customers', undefined, glow)).find((c) => c.name === 'Siti Aminah');
    assert(siti.spent > 0);
    await fail(400, 'POST', '/api/admin/vouchers', { customerIds: [], type: 'amount', value: 10 }, glow);
    await ok('POST', '/api/admin/vouchers', { customerIds: [siti.id], type: 'amount', value: 15, note: 'Thanks' }, glow);
    const q = await ok('POST', '/api/shop/glow/quote', { lines: [line({ date, time: slot })] }, cust);
    assert.strictEqual(q.discount, 15); assert(q.voucher);
    assert.strictEqual((await ok('POST', '/api/shop/glow/quote', { lines: [line({ date, time: slot })] }, cust2)).discount, 0, 'voucher belongs to Siti only');
    const o = await ok('POST', '/api/shop/glow/orders', { lines: [line({ date, time: slot })] }, cust);
    await ok('POST', `/api/shop/glow/orders/${o.id}/pay`, { method: 'card' }, cust);
    assert.strictEqual((await ok('POST', '/api/shop/glow/quote', { lines: [line({ date, time: slot })] }, cust)).discount, 0, 'voucher consumed');
  });

  await test('two cart items cannot use the same single person at the same time', async () => {
    const pc = (await ok('POST', '/api/shop/paws/login', { name: 'Lim', phone: '0188888888', email: 'lim@example.com' })).token;
    const svc = await ok('GET', '/api/shop/paws/services?q=Nail Trim Combo', undefined, pc);
    const d = await ok('GET', '/api/shop/paws/services/' + svc[0].id, undefined, pc);
    const shop = d.areas.find((a) => a.type === 'shop').id;
    const day = (await ok('POST', '/api/shop/paws/days', { itemId: svc[0].id }, pc)).days.find((x) => x.state === 'open').date;
    const av = (await ok('POST', '/api/shop/paws/availability', { itemId: svc[0].id, date: day }, pc)).slots.filter((s) => s.available);
    const l = { itemId: svc[0].id, addons: [], areaId: shop, date: day, time: av[0].time };
    const q = await ok('POST', '/api/shop/paws/quote', { lines: [l, l, l] }, pc);
    assert.strictEqual(q.lines.filter((x) => !x.problem).length, 2, 'Ken + Lily only => 2 of 3 fit');
    assert.strictEqual(q.ok, false);
  });

  await test('reminders: appointment tomorrow gets WhatsApp + email once', async () => {
    const db = getDb();
    const a = db.appts.find((x) => x.id === apptId);
    a.status = 'scheduled'; a.date = inDays(1); delete a.reminderAt;
    db.businesses.find((b) => b.slug === 'glow').settings.reminderHour = 0;
    const before = db.outbox.length;
    await reminderTick(); await reminderTick();
    const rows = db.outbox.slice(before).filter((r) => r.kind === 'reminder' && r.apptId === apptId);
    assert.deepStrictEqual(rows.map((r) => r.channel).sort(), ['email', 'whatsapp']);
    assert(rows.find((r) => r.channel === 'whatsapp').to.startsWith('60123456789'), 'phone normalised to international');
    assert(/Hydrating Facial/.test(rows[0].text));
    const log = await ok('GET', '/api/admin/outbox', undefined, glow);
    assert(log.rows.length >= 4 && log.live.whatsapp === false);
  });

  await test('dashboards: admin daily/weekly/monthly/yearly + demo data + super overview', async () => {
    for (const p of ['daily', 'weekly', 'monthly', 'yearly']) {
      const s = await ok('GET', '/api/admin/stats?period=' + p, undefined, glow);
      assert(s.summary.revenue > 0 && s.series.length > 0 && s.topItems.length > 0, p);
    }
    await ok('POST', '/api/admin/demo-sales', {}, glow);
    const m = await ok('GET', '/api/admin/stats?period=monthly', undefined, glow);
    assert(m.summary.orders > 100 && m.topItems[0].count > 5 && m.catalog.listedItems >= 8);
    assert.strictEqual((await ok('GET', '/api/admin/stats?period=monthly', undefined, pawsTok)).summary.orders, 0, 'paws sees only its own sales');
    const s = await ok('GET', '/api/super/stats?period=yearly', undefined, sup);
    assert(s.summary.revenue >= m.summary.revenue && s.businesses.find((b) => b.slug === 'glow').sales > 0);
    await ok('DELETE', '/api/admin/demo-sales', undefined, glow);
  });

  console.log(`\n${passed} test groups passed`);
  server.close(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
