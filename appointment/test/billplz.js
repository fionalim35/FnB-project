'use strict';
// Billplz integration test with a stubbed Billplz API (no network): bill creation, signed callback, replay, wrong amount, late payment.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apt-bp-'));
Object.assign(process.env, { BILLPLZ_API_KEY: 'key', BILLPLZ_COLLECTION_ID: 'col1', BILLPLZ_XSIGNATURE_KEY: 'sigkey', PUBLIC_URL: 'http://pay.test', BILLPLZ_SANDBOX: '1' });
const { server, getDb, bpSignature } = require('../server');

const realFetch = global.fetch; const bills = [];
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://www.billplz-sandbox.com/api/v3/bills')) {
    const f = Object.fromEntries(new URLSearchParams(opts.body));
    assert(opts.headers.Authorization.startsWith('Basic '));
    const b = { id: 'bill' + (bills.length + 1), url: 'https://www.billplz-sandbox.com/bills/bill' + (bills.length + 1), form: f };
    bills.push(b);
    return { ok: true, json: async () => b };
  }
  return realFetch(url, opts);
};
let base;
const call = async (method, url, body, token, raw) => {
  const r = await realFetch(base + url, { method, headers: { 'Content-Type': raw ? 'application/x-www-form-urlencoded' : 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ok = async (...a) => { const r = await call(...a); assert.strictEqual(r.status, 200, `${a[1]} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const callback = (bill, over) => {
  const p = { id: bill.id, collection_id: 'col1', paid: 'true', state: 'paid', amount: bill.form.amount, paid_amount: bill.form.amount, paid_at: '2026-10-26 10:00:00 +0800', ...over };
  p.x_signature = (over && over.x_signature) || bpSignature(p);
  return call('POST', '/api/payments/billplz/callback', new URLSearchParams(p).toString(), null, true);
};

(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}`;
  const tok = (await ok('POST', '/api/shop/paws/login', { name: 'Lim Wei', phone: '0188888888', email: 'lim@example.com' })).token;
  assert.strictEqual((await ok('GET', '/api/shop/paws')).payMode, 'billplz');
  const svc = (await ok('GET', '/api/shop/paws/services?q=Basic Bath', undefined, tok))[0];
  const d = await ok('GET', '/api/shop/paws/services/' + svc.id, undefined, tok);
  const area = d.areas.find((a) => a.type === 'shop').id;
  const days = (await ok('POST', '/api/shop/paws/days', { itemId: svc.id }, tok)).days.filter((x) => x.state === 'open');
  const slots = (await ok('POST', '/api/shop/paws/availability', { itemId: svc.id, date: days[0].date }, tok)).slots.filter((s) => s.available);
  const mk = (i) => ({ itemId: svc.id, addons: [], areaId: area, date: days[0].date, time: slots[i].time });
  const db = getDb();

  // 1. pay -> bill created with the right amount, customer redirected to Billplz
  let o = await ok('POST', '/api/shop/paws/orders', { lines: [mk(0)] }, tok);
  const pay = await ok('POST', `/api/shop/paws/orders/${o.id}/pay`, {}, tok);
  assert.strictEqual(pay.redirectUrl, bills[0].url); assert.strictEqual(pay.status, 'pending_payment');
  assert.strictEqual(bills[0].form.amount, String(Math.round(o.total * 100)));
  assert(bills[0].form.callback_url === 'http://pay.test/api/payments/billplz/callback' && bills[0].form.redirect_url.includes(o.id));
  await ok('POST', `/api/shop/paws/orders/${o.id}/pay`, {}, tok);
  assert.strictEqual(bills.length, 1, 'bill reused on retry');

  // 2. forged / tampered callbacks are rejected
  assert.strictEqual((await callback(bills[0], { x_signature: 'deadbeef' })).status, 401);
  const unpaid = await callback(bills[0], { paid: 'false', state: 'due' });
  assert.strictEqual(unpaid.status, 200); assert.strictEqual(db.orders.find((x) => x.id === o.id).status, 'pending_payment');
  assert.strictEqual((await callback(bills[0], { paid_amount: '100' })).status, 400, 'wrong amount');
  assert.strictEqual(db.orders.find((x) => x.id === o.id).status, 'pending_payment');

  // 3. genuine callback confirms; replay is harmless; points awarded once
  assert.strictEqual((await callback(bills[0])).status, 200);
  assert.strictEqual((await callback(bills[0])).status, 200);
  o = await ok('GET', '/api/shop/paws/orders/' + o.id, undefined, tok);
  assert.strictEqual(o.status, 'paid'); assert.strictEqual(o.payment.method, 'billplz');
  assert.strictEqual((await ok('GET', '/api/shop/paws/me', undefined, tok)).customer.points, o.points);

  // 4. late payment after the hold expired: slot still free -> reinstated
  let o2 = await ok('POST', '/api/shop/paws/orders', { lines: [mk(2)] }, tok);
  await ok('POST', `/api/shop/paws/orders/${o2.id}/pay`, {}, tok);
  const rec = db.orders.find((x) => x.id === o2.id); rec.holdUntil = Date.now() - 1000; db.appts.filter((a) => a.orderId === o2.id).forEach((a) => { a.holdUntil = Date.now() - 1000; });
  await ok('GET', '/api/shop/paws/orders', undefined, tok); // triggers sweep -> expired
  assert.strictEqual(rec.status, 'expired');
  assert.strictEqual((await callback(bills[1])).status, 200);
  assert.strictEqual(rec.status, 'paid'); assert(!rec.needsRefund);
  assert(db.appts.filter((a) => a.orderId === o2.id).every((a) => a.status === 'scheduled'));

  // 5. late payment and the slot was taken by someone else -> flagged for refund, no double booking
  const tok2 = (await ok('POST', '/api/shop/paws/login', { name: 'Tan', phone: '0177777777', email: 'tan@example.com' })).token;
  let o3 = await ok('POST', '/api/shop/paws/orders', { lines: [mk(4)] }, tok);
  await ok('POST', `/api/shop/paws/orders/${o3.id}/pay`, {}, tok);
  const r3 = db.orders.find((x) => x.id === o3.id); r3.holdUntil = Date.now() - 1000; db.appts.filter((a) => a.orderId === o3.id).forEach((a) => { a.holdUntil = Date.now() - 1000; });
  await ok('GET', '/api/shop/paws/orders', undefined, tok);
  // fill the slot with Ken AND Lily (both can do Basic Bath)
  const l = mk(4);
  for (const t of [tok2, tok2]) { const x = await ok('POST', '/api/shop/paws/orders', { lines: [l] }, t).catch(() => null); }
  const taken = db.appts.filter((a) => a.date === l.date && a.time === l.time && a.status === 'hold' && a.orderId !== o3.id).length;
  if (taken < 2) { const t3 = (await ok('POST', '/api/shop/paws/login', { name: 'Ng', phone: '0166666660', email: 'ng@example.com' })).token; await ok('POST', '/api/shop/paws/orders', { lines: [l] }, t3); }
  assert.strictEqual((await callback(bills[2])).status, 200);
  assert.strictEqual(r3.needsRefund, true);
  assert(db.appts.filter((a) => a.orderId === o3.id).every((a) => a.status === 'cancelled'), 'not double booked');
  const pawsAdmin = (await ok('POST', '/api/admin/login', { username: 'paws', password: 'admin123' })).token;
  assert.strictEqual((await ok('GET', '/api/admin/stats?period=daily', undefined, pawsAdmin)).live.refunds.length, 1);
  assert.strictEqual((await ok('GET', '/api/shop/paws/orders/' + o3.id, undefined, tok)).refundNeeded, true);

  console.log('billplz: all checks passed');
  server.close(); process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
