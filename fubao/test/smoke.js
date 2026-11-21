'use strict';
// End-to-end API test. Runs the real server against a throw-away data folder.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.FUBAO_SMTP_ALLOW_SELF_SIGNED = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fubao-test-'));
const server = require('../server.js');
const U = require('../lib/util');
const fake = require('./fakesmtp');

let base, passed = 0;
async function call(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const ok = async (p) => { const r = await p; assert(r.status === 200, `expected 200, got ${r.status}: ${r.error}`); return r; };
const fail = async (p, status, text) => { const r = await p; assert.strictEqual(r.status, status, `expected ${status}, got ${r.status}`); if (text) assert(String(r.error).includes(text), `error "${r.error}" should include "${text}"`); };
const step = (name) => { passed++; console.log('  ok -', name); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function nextOpenDate(minDays = 2) {
  let date = U.addDays(U.nowMY().date, minDays);
  while (U.dow(date) === 0) date = U.addDays(date, 1); // Sunday closed by default
  return date;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    // ---- owner
    const owner = await ok(call('POST', '/api/auth/login', { identifier: '018-253 0288', password: 'fubao1234' }));
    const O = owner.token; step('owner can log in with contact number');
    await fail(call('POST', '/api/auth/login', { identifier: '0182530288', password: 'wrong' }), 401);
    const pub = await ok(call('GET', '/api/public'));
    assert(pub.services.length >= 10 && pub.packages.length >= 10); step('catalogue seeded from the price list');
    const camellia = pub.packages.find((p) => p.name.startsWith('Camellia'));
    assert.strictEqual(camellia.priceAfter, 550); assert.strictEqual(camellia.priceBefore, 720);
    const unlimited = pub.packages.find((p) => p.unlimited); assert.strictEqual(unlimited.priceAfter, 988); assert.strictEqual(unlimited.validityDays, 365);

    // ---- owner creates a service with image, a voucher, a flash promo
    const up = await ok(call('POST', '/api/admin/upload', { image: PNG }, O));
    assert(up.url.startsWith('/uploads/'));
    const img = await fetch(base + up.url); assert.strictEqual(img.status, 200);
    const svc = (await ok(call('POST', '/api/admin/services', { name: 'Test Facial', category: 'Skin', priceBefore: 100, priceAfter: 80, durationMin: 60, gapMin: 30, images: [up.url] }, O))).item;
    assert.strictEqual(svc.priceBefore, 100); step('owner adds service with image, before/after price, duration and gap');
    const staff = (await ok(call('GET', '/api/admin/staff', null, O))).items;
    assert(staff.length === 2);
    const bea = staff[0];
    await ok(call('PUT', '/api/admin/staff/' + bea.id, { ...bea, skills: [...bea.skills, svc.id] }, O));
    const pkg = (await ok(call('POST', '/api/admin/packages', { name: 'Test Facial x3', priceBefore: 240, priceAfter: 200, validityDays: 30, items: [{ serviceId: svc.id, qty: 3 }] }, O))).item;
    step('owner adds package with validity');

    // ---- customer registers & vouchers
    const reg = await ok(call('POST', '/api/auth/register', { name: 'Alice', phone: '012-345 6789', email: 'alice@example.com', password: 'secret1' }));
    const C = reg.token;
    await fail(call('POST', '/api/auth/register', { name: 'Alice2', phone: '0123456789', email: 'a2@example.com', password: 'secret1' }), 400, 'already registered');
    await fail(call('GET', '/api/admin/stats', null, C), 403);
    const all = (await ok(call('POST', '/api/admin/vouchers', { code: 'ALL10', title: '10 off', type: 'amount', value: 10, scope: 'all' }, O))).item;
    const mine = (await ok(call('POST', '/api/admin/vouchers', { code: 'ALICE20', title: 'Alice only', type: 'percent', value: 20, maxDiscount: 15, scope: 'specific', customerIds: [reg.user.id] }, O))).item;
    const reg2 = await ok(call('POST', '/api/auth/register', { name: 'Bob', phone: '0111111111', email: 'bob@example.com', password: 'secret2' }));
    const v1 = (await ok(call('GET', '/api/my', null, C))).vouchers, v2 = (await ok(call('GET', '/api/my', null, reg2.token))).vouchers;
    assert(v1.some((v) => v.code === 'ALICE20') && !v2.some((v) => v.code === 'ALICE20') && v2.some((v) => v.code === 'ALL10'));
    await fail(call('POST', '/api/quote', { lines: [{ type: 'package', id: pkg.id, qty: 1 }], voucherId: mine.id }, reg2.token), 400, 'not available');
    step('vouchers: all customers vs specific customer');

    // ---- flash promo
    const t = U.nowMY();
    await ok(call('POST', '/api/admin/flashes', { title: 'Flash!', startAt: U.addDays(t.date, -1) + 'T00:00', endAt: U.addDays(t.date, 1) + 'T23:59', targetType: 'package', targetId: pkg.id, flashPrice: 150 }, O));
    const pub2 = await ok(call('GET', '/api/public'));
    assert(pub2.flashes.length === 1 && pub2.flashes[0].remainingMs > 0);
    assert.strictEqual(pub2.packages.find((p) => p.id === pkg.id).price, 150); step('flash promotion with countdown applies special price');

    // ---- purchase: flash 150, voucher 20% capped 15 -> 135
    const q = await ok(call('POST', '/api/quote', { lines: [{ type: 'package', id: pkg.id, qty: 1 }], voucherId: mine.id }, C));
    assert.strictEqual(q.subtotal, 150); assert.strictEqual(q.voucherDiscount, 15); assert.strictEqual(q.total, 135);
    const order = (await ok(call('POST', '/api/orders', { lines: [{ type: 'package', id: pkg.id, qty: 1 }], voucherId: mine.id }, C))).order;
    assert.strictEqual(order.status, 'pending_payment');
    await fail(call('POST', '/api/orders', { lines: [{ type: 'package', id: pkg.id, qty: 1 }], voucherId: mine.id }, C), 400, 'already used');
    let my = await ok(call('GET', '/api/my', null, C));
    assert(my.entitlements.length === 1 && my.entitlements[0].state === 'awaiting_payment' && my.points === 0);
    const date = nextOpenDate();
    const bookBody = { entitlementId: my.entitlements[0].id, mode: 'studio', date, start: '11:00', contact: { name: 'Alice', phone: '0123456789' } };
    await fail(call('POST', '/api/bookings', bookBody, C), 400, 'waiting for payment');
    step('purchase is created; booking blocked until payment is confirmed');

    // ---- receipt upload + owner confirmation + points
    await fail(call('POST', '/api/payments', { kind: 'order', refId: order.id, amount: 135, image: 'nope' }, C), 400);
    const pay = (await ok(call('POST', '/api/payments', { kind: 'order', refId: order.id, amount: 135, image: PNG, note: 'Maybank' }, C))).payment;
    const rc = await fetch(base + pay.receipt + '?t=' + C); assert.strictEqual(rc.status, 200);
    const rc2 = await fetch(base + pay.receipt + '?t=' + reg2.token); assert.strictEqual(rc2.status, 404);
    await ok(call('POST', '/api/admin/payments/' + pay.id, { action: 'confirm' }, O));
    my = await ok(call('GET', '/api/my', null, C));
    assert.strictEqual(my.orders[0].status, 'paid'); assert.strictEqual(my.points, 1, 'RM135 => 1 point');
    const ent = my.entitlements[0];
    assert.strictEqual(ent.state, 'active'); assert.strictEqual(ent.total, 3); assert.strictEqual(ent.expiryDate, U.addDays(U.nowMY().date, 30));
    step('receipt confirmed -> order paid, validity starts, points earned (RM100 = 1 pt)');

    // ---- availability & booking
    const slots = (await ok(call('GET', `/api/availability/slots?serviceId=${svc.id}&date=${date}&mode=studio`, null, C))).slots;
    assert(slots.length > 0 && slots.some((s) => s.time === '11:00'));
    const b1 = (await ok(call('POST', '/api/bookings', bookBody, C))).booking;
    assert.strictEqual(b1.status, 'pending'); assert.strictEqual(b1.beauticianId, bea.id, 'only Beautician A has the skill');
    await fail(call('POST', '/api/bookings', { ...bookBody, start: '11:30' }, reg.token ? C : C), 400, 'already have an appointment');
    const slotsAfter = (await ok(call('GET', `/api/availability/slots?serviceId=${svc.id}&date=${date}&mode=studio`, null, C))).slots;
    // 60 min + 30 min gap: 11:00 booking blocks until 12:30 => 12:00 is blocked, 12:30 is free
    assert(!slotsAfter.some((s) => s.time === '11:00' || s.time === '12:00') && slotsAfter.some((s) => s.time === '12:30'));
    step('booking prevents overlap and respects service duration + gap');
    await fail(call('POST', '/api/bookings', { ...bookBody, mode: 'home', start: '15:00' }, C), 400, 'address');
    const home = (await ok(call('POST', '/api/bookings', { ...bookBody, mode: 'home', start: '15:00', contact: { name: 'Alice', phone: '0123456789', address: '1 Jalan Test', area: 'Ampang' } }, C))).booking;
    assert.strictEqual(home.homeFee, 30); assert.strictEqual(home.feeStatus, 'unpaid'); step('home service adds RM30 fee and needs address');

    // ---- approvals; session deducted only after completion
    my = await ok(call('GET', '/api/my', null, C));
    assert.strictEqual(my.entitlements[0].used, 0); assert.strictEqual(my.entitlements[0].reserved, 2);
    await ok(call('POST', `/api/admin/bookings/${b1.id}/action`, { action: 'approve' }, O));
    await ok(call('POST', `/api/admin/bookings/${home.id}/action`, { action: 'reject', reason: 'Too far' }, O));
    my = await ok(call('GET', '/api/my', null, C));
    assert.strictEqual(my.entitlements[0].reserved, 1); assert.strictEqual(my.entitlements[0].used, 0);
    const bLogin = await ok(call('POST', '/api/auth/login', { identifier: '0120000001', password: 'beauty123' }));
    const B = bLogin.token;
    await fail(call('GET', '/api/admin/stats', null, B), 403);
    const sb = (await ok(call('GET', '/api/staff/bookings?from=' + date + '&to=' + date, null, B))).bookings;
    assert.strictEqual(sb.length, 1);
    const bLogin2 = await ok(call('POST', '/api/auth/login', { identifier: '0120000002', password: 'beauty123' }));
    await fail(call('POST', `/api/staff/bookings/${b1.id}/complete`, {}, bLogin2.token), 404);
    await ok(call('POST', `/api/staff/bookings/${b1.id}/complete`, {}, B));
    my = await ok(call('GET', '/api/my', null, C));
    assert.strictEqual(my.entitlements[0].used, 1); assert.strictEqual(my.entitlements[0].remaining, 2);
    step('approval flow; beautician completes; only then 1 session is deducted (2 left)');

    // ---- points redemption
    const q2 = await ok(call('POST', '/api/quote', { lines: [{ type: 'service', id: svc.id, qty: 1 }], points: 1 }, C));
    assert.strictEqual(q2.pointsDiscount, 1); assert.strictEqual(q2.total, 79);
    await fail(call('POST', '/api/quote', { lines: [{ type: 'service', id: svc.id, qty: 1 }], points: 5 }, C), 400, 'enough points');
    const o2 = (await ok(call('POST', '/api/orders', { lines: [{ type: 'service', id: svc.id, qty: 1 }], points: 1 }, C))).order;
    my = await ok(call('GET', '/api/my', null, C)); assert.strictEqual(my.points, 0);
    await ok(call('POST', `/api/admin/orders/${o2.id}/cancel`, {}, O));
    my = await ok(call('GET', '/api/my', null, C)); assert.strictEqual(my.points, 1, 'points returned on cancel');
    step('points redeem at RM1 per point and are refunded on cancel');

    // ---- mini game
    const g = await ok(call('POST', '/api/game/play', { score: 9 }, C));
    assert.strictEqual(g.earned, 0.01); assert.strictEqual(g.points, 1.01);
    await fail(call('POST', '/api/game/play', {}, C), 409);
    step('mini game: +0.01 point, once per day');

    // ---- owner manual sale, unlimited package
    const sale = (await ok(call('POST', '/api/admin/orders', { customerId: reg.user.id, lines: [{ type: 'package', id: unlimited.id, qty: 1 }], markPaid: true, method: 'cash' }, O))).order;
    assert.strictEqual(sale.status, 'paid');
    my = await ok(call('GET', '/api/my', null, C));
    const unl = my.entitlements.filter((e) => e.unlimited); assert(unl.length >= 5 && unl.every((e) => e.state === 'active' && e.remaining === null));
    assert.strictEqual(my.points, 1.01 + 9, 'RM988 => 9 points'); assert(my.isMember);
    step('owner manual sale; RM988 unlimited package; 9 points earned');

    // ---- availability controls
    await ok(call('PUT', '/api/admin/studio-day', { date, mode: 'closed' }, O));
    const closed = (await ok(call('GET', `/api/availability/slots?serviceId=${svc.id}&date=${date}&mode=studio`, null, C))).slots; assert.strictEqual(closed.length, 0);
    await ok(call('PUT', '/api/admin/studio-day', { date, mode: 'default' }, O));
    await ok(call('PUT', `/api/admin/staff/${bea.id}/day`, { date, mode: 'off' }, O));
    const off = (await ok(call('GET', `/api/availability/slots?serviceId=${svc.id}&date=${date}&mode=studio`, null, C))).slots; assert.strictEqual(off.length, 0);
    step('studio closed days and beautician days off remove availability');

    // ---- customer cannot see others' data
    const bob = await ok(call('GET', '/api/my', null, reg2.token)); assert(bob.entitlements.length === 0 && bob.bookings.length === 0);
    const stats = await ok(call('GET', '/api/admin/stats', null, O)); assert(stats.customers === 2);
    step('customers only see their own information');

    // ---- email alerts through a (fake) SMTP server
    const smtp = await fake.start();
    await fail(call('POST', '/api/auth/register', { name: 'NoMail', phone: '0199999999', password: 'secret1' }), 400, 'email');
    await fail(call('POST', '/api/admin/test-email', {}, O), 400);
    await ok(call('PUT', '/api/admin/settings', { ...(await ok(call('GET', '/api/admin/settings', null, O))).settings, emailEnabled: true, ownerEmail: 'owner@example.com', smtp: { host: '127.0.0.1', port: smtp.port, user: 'studio@example.com', pass: 'app-pass', fromName: 'Fubao', fromEmail: 'studio@example.com' } }, O));
    const gs = (await ok(call('GET', '/api/admin/settings', null, O))).settings; assert(gs.smtp.passSet && gs.smtp.pass === undefined, 'password never sent back');
    await ok(call('POST', '/api/admin/test-email', {}, O));
    const wait = async (fn) => { for (let i = 0; i < 40; i++) { const m = fn(); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } assert.fail('email not received'); };
    await wait(() => smtp.mails.find((m) => m.to === 'owner@example.com' && /Test email/.test(m.subject)));
    step('email: owner can set up SMTP and send a test email (password hidden afterwards)');

    // booking alert to owner, confirmation to customer
    const date2 = nextOpenDate(3);
    const myAfter = await ok(call('GET', '/api/my', null, C));
    const entForMail = myAfter.entitlements.find((e) => e.bookable && !e.unlimited && e.serviceId === svc.id) || myAfter.entitlements.find((e) => e.bookable);
    const bk2 = (await ok(call('POST', '/api/bookings', { entitlementId: entForMail.id, mode: 'studio', date: date2, start: '14:00', beauticianId: null, contact: { name: 'Alice', phone: '0123456789' } }, C))).booking;
    await ok(call('PUT', `/api/admin/staff/${bea.id}/day`, { date: date2, mode: 'default' }, O)).catch(() => {});
    await wait(() => smtp.mails.find((m) => m.to === 'owner@example.com' && /New booking request/.test(m.subject)));
    await ok(call('POST', `/api/admin/bookings/${bk2.id}/action`, { action: 'approve' }, O));
    await wait(() => smtp.mails.find((m) => m.to === 'alice@example.com' && /confirmed/.test(m.subject)));
    step('email: owner alerted on new booking; customer emailed when approved');

    // ---- password reset (customer, beautician, owner)
    const forgot = await ok(call('POST', '/api/auth/forgot', { identifier: '0123456789' }));
    const codeMail = await wait(() => smtp.mails.find((m) => m.to === 'alice@example.com' && /reset code/.test(m.subject)));
    const code = /code is: (\d{6})/.exec(codeMail.text)[1];
    await fail(call('POST', '/api/auth/reset', { identifier: '0123456789', code: '000000', password: 'newpass1' }), 400, 'Incorrect');
    await fail(call('POST', '/api/auth/reset', { identifier: '0123456789', code, password: 'abc' }), 400, 'at least 6');
    await ok(call('POST', '/api/auth/reset', { identifier: 'alice@example.com', code, password: 'newpass1' }));
    await fail(call('POST', '/api/auth/login', { identifier: '0123456789', password: 'secret1' }), 401);
    await ok(call('POST', '/api/auth/login', { identifier: '0123456789', password: 'newpass1' }));
    await fail(call('GET', '/api/my', null, C), 401); // old sessions signed out
    await fail(call('POST', '/api/auth/reset', { identifier: '0123456789', code, password: 'another1' }), 400, 'invalid');
    const ghost = await ok(call('POST', '/api/auth/forgot', { identifier: '0100000000' })); assert.strictEqual(ghost.message, forgot.message, 'does not reveal whether an account exists');
    await ok(call('PUT', '/api/admin/staff/' + bea.id, { ...bea, skills: bea.skills, email: 'bea@example.com' }, O));
    await ok(call('POST', '/api/auth/forgot', { identifier: 'bea@example.com' }));
    const bm = await wait(() => smtp.mails.find((m) => m.to === 'bea@example.com' && /reset code/.test(m.subject)));
    await ok(call('POST', '/api/auth/reset', { identifier: '0120000001', code: /code is: (\d{6})/.exec(bm.text)[1], password: 'beauty456' }));
    await ok(call('POST', '/api/auth/login', { identifier: '0120000001', password: 'beauty456' }));
    await ok(call('POST', '/api/auth/forgot', { identifier: '0182530288' }));
    const om = await wait(() => smtp.mails.filter((m) => m.to === 'owner@example.com' && /reset code/.test(m.subject))[0]);
    await ok(call('POST', '/api/auth/reset', { identifier: 'owner@example.com', code: /code is: (\d{6})/.exec(om.text)[1], password: 'owner2026' }));
    await ok(call('POST', '/api/auth/login', { identifier: '0182530288', password: 'owner2026' }));
    step('password reset by emailed code works for customer, beautician and owner');

    // ---- rewards from the customer profile (birthday / referral)
    const O2 = (await ok(call('POST', '/api/auth/login', { identifier: '0182530288', password: 'owner2026' }))).token;
    const C2 = (await ok(call('POST', '/api/auth/login', { identifier: '0123456789', password: 'newpass1' }))).token;
    const month = U.nowMY().date.slice(0, 7);
    await ok(call('PUT', '/api/admin/customers/' + reg.user.id, { name: 'Alice', phone: '0123456789', email: 'alice@example.com', birthday: '1995-' + month.slice(5) + '-15', referredBy: reg2.user.id, active: true }, O2));
    const bl = (await ok(call('GET', '/api/admin/customers?birthday=month', null, O2))).items; assert(bl.length === 1 && bl[0].birthdayThisMonth);
    assert.strictEqual((await ok(call('GET', '/api/admin/customers', null, O2))).items.find((c) => c.id === reg2.user.id).referrals, 1);
    const pts0 = (await ok(call('GET', '/api/my', null, C2))).points;
    await ok(call('POST', `/api/admin/customers/${reg.user.id}/reward`, { kind: 'voucher', reason: 'Birthday', type: 'amount', value: 30, endDate: U.addDays(U.nowMY().date, 30) }, O2));
    await ok(call('POST', `/api/admin/customers/${reg.user.id}/reward`, { kind: 'points', reason: 'Referral', points: 3 }, O2));
    const lashId = pub.services.find((s) => s.name.startsWith('Camellia')).id;
    await ok(call('POST', `/api/admin/customers/${reg.user.id}/reward`, { kind: 'session', reason: 'Birthday', item: 'service:' + lashId, title: 'Birthday free lash', expiryDate: U.addDays(U.nowMY().date, 20) }, O2));
    const mine2 = await ok(call('GET', '/api/my', null, C2));
    assert(mine2.vouchers.some((v) => /^BIRT-/.test(v.code) && v.usable));
    assert.strictEqual(mine2.points, pts0 + 3);
    const free = mine2.entitlements.find((e) => e.title === 'Birthday free lash');
    assert(free && free.state === 'active' && free.total === 1 && free.expiryDate === U.addDays(U.nowMY().date, 20));
    assert.strictEqual(mine2.rewards.length, 3);
    const bobSees = await ok(call('GET', '/api/my', null, reg2.token)); assert(!bobSees.vouchers.some((v) => /^BIRT-/.test(v.code)));
    await wait(() => smtp.mails.find((m) => m.to === 'alice@example.com' && /birthday reward/.test(m.subject)));
    step('owner gives birthday/referral rewards (voucher, points, free session) from the customer profile');
    smtp.close();
    console.log(`\nAll ${passed} checks passed.`);
    process.exitCode = 0;
  } catch (e) {
    console.error('\nFAILED:', e.stack || e);
    process.exitCode = 1;
  } finally {
    server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode), 100);
  }
})();
