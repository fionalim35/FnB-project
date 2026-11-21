'use strict';
const S = require('./store');
const { uid, round2, bad, str, num, nowMY, addDays, dow, diffDays, toMin, fromMin, isDate, isTime, MY_OFFSET } = require('./util');
const d = () => S.d();

const BOOKED = ['pending', 'confirmed', 'completed']; // statuses that occupy a beautician's time

// ------------------------------------------------------------------ points
const pointsBalance = (cid) => round2(d().points.filter((p) => p.customerId === cid).reduce((a, p) => a + p.delta, 0));
function addPoints(customerId, delta, type, note, ref) {
  delta = round2(delta);
  if (!delta) return;
  d().points.push({ id: uid(), customerId, delta, type, note: note || '', ref: ref || null, at: Date.now(), date: nowMY().date });
}

// ------------------------------------------------------------------ flash promotions & catalogue
const flashActive = (f, now = nowMY()) => f.active !== false && f.startAt <= now.iso && now.iso <= f.endAt;
const myNowMs = () => Date.now() + MY_OFFSET;
function flashView(f) {
  const ms = (s) => Date.parse(s + ':00Z');
  return { ...f, remainingMs: ms(f.endAt) - myNowMs(), startsInMs: ms(f.startAt) - myNowMs() };
}
function decorate(type, item, now = nowMY()) {
  const f = d().flashes.find((x) => flashActive(x, now) && x.targetType === type && x.targetId === item.id && x.flashPrice != null);
  const out = { ...item, type, price: f ? f.flashPrice : item.priceAfter, flashId: f ? f.id : null };
  if (type === 'package') out.includes = item.items.map((i) => ({ serviceId: i.serviceId, qty: i.qty, name: (d().services.find((s) => s.id === i.serviceId) || {}).name || '?' }));
  return out;
}
function catalog() {
  const now = nowMY();
  return {
    services: d().services.filter((s) => s.active !== false).sort((a, b) => a.sort - b.sort).map((s) => decorate('service', s, now)),
    packages: d().packages.filter((p) => p.active !== false).sort((a, b) => a.sort - b.sort).map((p) => decorate('package', p, now)),
    flashes: d().flashes.filter((f) => flashActive(f, now)).map(flashView),
  };
}

// ------------------------------------------------------------------ vouchers
function voucherUsage(v, customerId) {
  const used = d().orders.filter((o) => o.voucherId === v.id && o.status !== 'cancelled');
  return { total: used.length, mine: used.filter((o) => o.customerId === customerId).length };
}
function voucherProblem(v, customerId) {
  const today = nowMY().date;
  if (!v || v.active === false) return 'This voucher is not available';
  if (v.startDate && today < v.startDate) return 'This voucher is not valid yet';
  if (v.endDate && today > v.endDate) return 'This voucher has expired';
  if (v.scope === 'specific' && !(v.customerIds || []).includes(customerId)) return 'This voucher is not available for your account';
  const u = voucherUsage(v, customerId);
  if (v.perCustomerLimit > 0 && u.mine >= v.perCustomerLimit) return 'You have already used this voucher';
  if (v.totalLimit > 0 && u.total >= v.totalLimit) return 'This voucher has been fully redeemed';
  return null;
}
function voucherDiscount(v, customer, lines, subtotal) {
  const p = voucherProblem(v, customer.id);
  if (p) throw bad(p);
  const base = v.appliesTo === 'service' ? lines.filter((l) => l.type === 'service').reduce((a, l) => a + l.unitPrice * l.qty, 0)
    : v.appliesTo === 'package' ? lines.filter((l) => l.type === 'package').reduce((a, l) => a + l.unitPrice * l.qty, 0) : subtotal;
  if (base <= 0) throw bad(`This voucher only applies to ${v.appliesTo === 'service' ? 'single services' : 'packages'}`);
  if (v.minSpend > 0 && base < v.minSpend) throw bad(`Minimum spend RM${v.minSpend} required for this voucher`);
  let disc = v.type === 'percent' ? base * v.value / 100 : Math.min(v.value, base);
  if (v.type === 'percent' && v.maxDiscount > 0) disc = Math.min(disc, v.maxDiscount);
  return round2(Math.min(disc, subtotal));
}
function entitledVouchers(customer) {
  return d().vouchers.filter((v) => v.scope === 'all' || (v.customerIds || []).includes(customer.id)).map((v) => {
    const problem = voucherProblem(v, customer.id);
    return { id: v.id, code: v.code, title: v.title, description: v.description, type: v.type, value: v.value, minSpend: v.minSpend, maxDiscount: v.maxDiscount, appliesTo: v.appliesTo, startDate: v.startDate, endDate: v.endDate, usable: !problem, reason: problem };
  });
}

// ------------------------------------------------------------------ orders
function buildLines(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) throw bad('Your cart is empty');
  const now = nowMY();
  return raw.map((r) => {
    const type = r.type === 'package' ? 'package' : 'service';
    const qty = Math.floor(num(r.qty, 1));
    if (qty < 1 || qty > 20) throw bad('Invalid quantity');
    const it = (type === 'package' ? d().packages : d().services).find((x) => x.id === r.id && x.active !== false);
    if (!it) throw bad('An item in your cart is no longer available');
    const dec = decorate(type, it, now);
    const items = type === 'service'
      ? [{ serviceId: it.id, name: it.name, qty: 1 }]
      : it.items.map((i) => ({ serviceId: i.serviceId, name: (d().services.find((s) => s.id === i.serviceId) || {}).name || '?', qty: i.qty }));
    return { type, itemId: it.id, name: it.name, qty, unitPrice: dec.price, priceBefore: it.priceBefore || null, validityDays: it.validityDays || 0, unlimited: type === 'package' && !!it.unlimited, items, flash: !!dec.flashId };
  });
}
function findVoucher(id, code) {
  const c = str(code, 40).toUpperCase();
  const v = d().vouchers.find((x) => (id && x.id === id) || (c && x.code === c));
  if (!v) throw bad('Voucher code not found');
  return v;
}
function priceOrder(customer, rawLines, opts = {}) {
  const lines = buildLines(rawLines);
  const subtotal = round2(lines.reduce((a, l) => a + l.unitPrice * l.qty, 0));
  let voucher = null, vd = 0;
  if (opts.voucherId || opts.code) { voucher = findVoucher(opts.voucherId, opts.code); vd = voucherDiscount(voucher, customer, lines, subtotal); }
  const pts = round2(Math.max(0, num(opts.points, 0)));
  if (pts > pointsBalance(customer.id) + 0.0001) throw bad('You do not have enough points');
  const pd = round2(pts * d().settings.pointValueRM);
  if (vd + pd > subtotal + 0.001) throw bad('Voucher and points are more than the amount payable');
  const total = round2(subtotal - vd - pd);
  const dp = d().settings.depositPercent || 0;
  return { lines, subtotal, voucher, voucherDiscount: vd, pointsUsed: pts, pointsDiscount: pd, total, depositPercent: dp, depositRequired: round2(total * dp / 100) };
}
const confirmedPaid = (order) => round2(d().payments.filter((p) => p.kind === 'order' && p.refId === order.id && p.status === 'confirmed').reduce((a, p) => a + p.amount, 0));
const pendingPaid = (order) => round2(d().payments.filter((p) => p.kind === 'order' && p.refId === order.id && p.status === 'pending').reduce((a, p) => a + p.amount, 0));
function orderUsable(order) {
  if (!order || order.status === 'cancelled') return false;
  if (order.status === 'paid') return true;
  return order.depositRequired > 0 && confirmedPaid(order) >= order.depositRequired - 0.005;
}
function awardPoints(order) {
  if (order.pointsAwarded || order.status !== 'paid') return;
  const per = d().settings.pointsEarnPerRM || 100;
  const earned = Math.floor(order.total / per);
  order.pointsAwarded = true;
  order.pointsEarned = earned;
  if (earned > 0) addPoints(order.customerId, earned, 'earn', `Purchase ${order.no} (RM${order.total.toFixed(2)})`, order.id);
}
function refreshOrder(order) {
  if (order.status === 'cancelled') return;
  if (confirmedPaid(order) >= order.total - 0.005) {
    if (order.status !== 'paid') { order.status = 'paid'; order.paidAt = Date.now(); }
    awardPoints(order);
  }
}
function createOrder(customer, priced, { source = 'online', startDate, createdBy } = {}) {
  const s = d();
  const start = startDate || nowMY().date;
  const order = {
    id: uid(), no: 'FB-' + String(++s.counters.order).padStart(5, '0'), customerId: customer.id, lines: priced.lines,
    subtotal: priced.subtotal, voucherId: priced.voucher ? priced.voucher.id : null, voucherCode: priced.voucher ? priced.voucher.code : null,
    voucherDiscount: priced.voucherDiscount, pointsUsed: priced.pointsUsed, pointsDiscount: priced.pointsDiscount, total: priced.total,
    depositPercent: priced.depositPercent, depositRequired: priced.depositRequired, status: 'pending_payment', createdAt: Date.now(),
    date: start, source, createdBy: createdBy || customer.id, pointsAwarded: false,
  };
  s.orders.push(order);
  for (const line of priced.lines) {
    for (let q = 0; q < line.qty; q++) {
      const unitId = uid();
      for (const it of line.items) {
        s.entitlements.push({
          id: uid(), unitId, orderId: order.id, customerId: customer.id, packageId: line.type === 'package' ? line.itemId : null, title: line.name,
          serviceId: it.serviceId, serviceName: it.name, total: line.unlimited ? null : it.qty, unlimited: line.unlimited,
          startDate: start, expiryDate: line.validityDays > 0 ? addDays(start, line.validityDays) : null, status: 'active', createdAt: Date.now(),
        });
      }
    }
  }
  if (order.pointsUsed > 0) addPoints(customer.id, -order.pointsUsed, 'redeem', `Redeemed on order ${order.no}`, order.id);
  if (order.total <= 0) { order.status = 'paid'; order.paidAt = Date.now(); awardPoints(order); }
  return order;
}
function cancelOrder(order, by) {
  const s = d();
  if (order.status === 'cancelled') throw bad('Order is already cancelled');
  const ents = s.entitlements.filter((e) => e.orderId === order.id);
  if (s.bookings.some((b) => b.status === 'completed' && ents.some((e) => e.id === b.entitlementId))) throw bad('Sessions from this order have already been used, so it cannot be cancelled');
  order.status = 'cancelled'; order.cancelledAt = Date.now(); order.cancelledBy = by;
  ents.forEach((e) => { e.status = 'cancelled'; });
  s.bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && ents.some((e) => e.id === b.entitlementId)).forEach((b) => {
    b.status = 'cancelled'; b.log.push({ at: Date.now(), by, text: 'Cancelled because the order was cancelled' });
  });
  if (order.pointsUsed > 0) addPoints(order.customerId, order.pointsUsed, 'refund', `Order ${order.no} cancelled - points returned`, order.id);
  if (order.pointsAwarded && order.pointsEarned > 0) addPoints(order.customerId, -order.pointsEarned, 'reverse', `Order ${order.no} cancelled - points removed`, order.id);
}

// ------------------------------------------------------------------ entitlements (purchased services / package balances)
function entView(e) {
  const s = d();
  const bks = s.bookings.filter((b) => b.entitlementId === e.id);
  const used = bks.filter((b) => b.status === 'completed').length;
  const reserved = bks.filter((b) => b.status === 'pending' || b.status === 'confirmed').length;
  const order = s.orders.find((o) => o.id === e.orderId);
  const today = nowMY().date;
  let state = 'active';
  if (e.status === 'cancelled' || (order && order.status === 'cancelled')) state = 'cancelled';
  else if (!orderUsable(order)) state = 'awaiting_payment';
  else if (e.expiryDate && e.expiryDate < today) state = 'expired';
  else if (!e.unlimited && used >= e.total) state = 'used_up';
  const remaining = e.unlimited ? null : Math.max(0, e.total - used);
  const available = e.unlimited ? null : Math.max(0, e.total - used - reserved);
  return { ...e, used, reserved, remaining, available, state, orderNo: order ? order.no : '', daysLeft: e.expiryDate ? diffDays(today, e.expiryDate) : null, bookable: state === 'active' && (e.unlimited || available > 0) };
}

// ------------------------------------------------------------------ availability
const parseRanges = (arr) => (arr || []).map((r) => ({ s: toMin(r.s), e: toMin(r.e) })).filter((r) => r.e > r.s);
function intersect(a, b) {
  const out = [];
  for (const x of a) for (const y of b) { const s = Math.max(x.s, y.s), e = Math.min(x.e, y.e); if (e > s) out.push({ s, e }); }
  return out;
}
function studioRanges(date) {
  const st = d().settings;
  const ov = (st.studioOverrides || {})[date];
  if (ov) return ov.closed ? [] : parseRanges(ov.ranges);
  return parseRanges((st.studioWeekly || {})[dow(date)]);
}
function staffRanges(b, date) {
  const ov = (b.overrides || {})[date];
  const own = ov ? (ov.off ? [] : parseRanges(ov.ranges)) : parseRanges((b.weekly || {})[dow(date)]);
  return intersect(own, studioRanges(date));
}
const occOf = (start, dur, gap, mode) => { const t = mode === 'home' ? (d().settings.homeTravelMin || 0) : 0; return { s: start - t, e: start + dur + gap + t }; };
function busy(beauticianId, date, excludeId) {
  return d().bookings.filter((b) => b.beauticianId === beauticianId && b.date === date && b.id !== excludeId && BOOKED.includes(b.status))
    .map((b) => occOf(toMin(b.start), b.durationMin, b.gapMin, b.mode));
}
function slotOk(b, date, startMin, spec, mode, { excludeId, ignoreLead } = {}) {
  const dur = spec.durationMin, gap = spec.gapMin || 0;
  if (!staffRanges(b, date).some((r) => startMin >= r.s && startMin + dur <= r.e)) return false;
  const o = occOf(startMin, dur, gap, mode);
  if (busy(b.id, date, excludeId).some((x) => o.s < x.e && x.s < o.e)) return false;
  if (!ignoreLead) {
    const now = nowMY(), st = d().settings;
    if (date < now.date) return false;
    if (date === now.date && startMin < now.min + (st.minLeadHours || 0) * 60) return false;
    if (date > addDays(now.date, st.maxAdvanceDays || 60)) return false;
  }
  return true;
}
const qualified = (serviceId) => d().users.filter((u) => u.role === 'beautician' && u.active !== false && (u.skills || []).includes(serviceId));
function slots({ service, date, mode, beauticianId }) {
  const step = d().settings.slotStepMin || 30;
  let pool = qualified(service.id);
  if (beauticianId) pool = pool.filter((b) => b.id === beauticianId);
  const map = {};
  for (const b of pool) {
    for (const r of staffRanges(b, date)) {
      for (let t = Math.ceil(r.s / step) * step; t + service.durationMin <= r.e; t += step) {
        if (slotOk(b, date, t, service, mode)) (map[t] = map[t] || []).push(b.id);
      }
    }
  }
  return Object.keys(map).map(Number).sort((a, b) => a - b).map((t) => ({ time: fromMin(t), beauticianIds: map[t] }));
}
function availableDays({ service, month, mode, beauticianId }) {
  const out = [];
  const first = month + '-01';
  for (let i = 0; i < 31; i++) {
    const date = addDays(first, i);
    if (date.slice(0, 7) !== month) break;
    if (slots({ service, date, mode, beauticianId }).length) out.push(date);
  }
  return out;
}

// ------------------------------------------------------------------ bookings
function modeCheck(service, mode) {
  const st = d().settings;
  if (mode !== 'studio' && mode !== 'home') throw bad('Please choose studio visit or home service');
  if (mode === 'studio' && (!st.studioEnabled || service.studioAllowed === false)) throw bad('This treatment is not available at the studio');
  if (mode === 'home' && (!st.homeEnabled || service.homeAllowed === false)) throw bad('Home service is not available for this treatment');
}
function makeBooking({ customer, entitlementId, mode, date, start, beauticianId, contact, byOwner, byName }) {
  const s = d(), st = s.settings;
  const ent = s.entitlements.find((e) => e.id === entitlementId && e.customerId === customer.id);
  if (!ent) throw bad('Please choose one of your purchased services');
  const ev = entView(ent);
  if (!ev.bookable) throw bad(ev.state === 'awaiting_payment' ? 'This purchase is still waiting for payment confirmation' : ev.state === 'expired' ? 'This package has expired' : ev.state === 'cancelled' ? 'This purchase was cancelled' : 'No sessions left on this purchase');
  const service = s.services.find((x) => x.id === ent.serviceId);
  if (!service) throw bad('This service is no longer offered');
  modeCheck(service, mode);
  if (!isDate(date) || !isTime(start)) throw bad('Please choose a date and time');
  if (ent.expiryDate && date > ent.expiryDate) throw bad(`That date is after your package validity (${ent.expiryDate})`);
  const c = { name: str(contact && contact.name, 80), phone: str(contact && contact.phone, 30), area: str(contact && contact.area, 80), address: str(contact && contact.address, 300) };
  if (!c.name || !c.phone) throw bad('Please enter the name and contact number');
  if (mode === 'home') {
    if (!c.address) throw bad('Please enter the home address for the beautician to attend');
    if (st.homeAreas && st.homeAreas.length && !c.area) throw bad('Please choose your area');
  }
  const sm = toMin(start);
  // customer cannot hold two overlapping appointments
  const mine = s.bookings.filter((b) => b.customerId === customer.id && b.date === date && ['pending', 'confirmed'].includes(b.status));
  if (mine.some((b) => sm < toMin(b.start) + b.durationMin && toMin(b.start) < sm + service.durationMin)) throw bad('You already have an appointment at that time');
  let pool = qualified(service.id);
  if (beauticianId) pool = pool.filter((b) => b.id === beauticianId);
  if (!pool.length) throw bad('That beautician is not available for this treatment');
  const free = pool.filter((b) => slotOk(b, date, sm, service, mode, { ignoreLead: byOwner }));
  if (!free.length) throw bad('Sorry, that time is no longer available. Please pick another slot.');
  const load = (b) => s.bookings.filter((x) => x.beauticianId === b.id && x.date === date && BOOKED.includes(x.status)).length;
  free.sort((a, b) => load(a) - load(b));
  const chosen = free[0];
  const booking = {
    id: uid(), no: 'BK-' + String(++s.counters.booking).padStart(5, '0'), customerId: customer.id, entitlementId: ent.id, orderId: ent.orderId,
    serviceId: service.id, serviceName: service.name, title: ent.title, mode, date, start, end: fromMin(sm + service.durationMin),
    durationMin: service.durationMin, gapMin: service.gapMin || 0, beauticianId: chosen.id, autoAssigned: !beauticianId, contact: c,
    homeFee: mode === 'home' ? (st.homeFee || 0) : 0, status: 'pending', createdAt: Date.now(), log: [{ at: Date.now(), by: byName || customer.name, text: 'Booking requested' }],
  };
  s.bookings.push(booking);
  return booking;
}
function moveBooking(b, { beauticianId, date, start }, byName) {
  const s = d();
  const service = s.services.find((x) => x.id === b.serviceId) || { durationMin: b.durationMin, gapMin: b.gapMin, id: b.serviceId };
  const nb = beauticianId || b.beauticianId, nd = date || b.date, ns = start || b.start;
  if (!isDate(nd) || !isTime(ns)) throw bad('Invalid date or time');
  const staff = s.users.find((u) => u.id === nb && u.role === 'beautician' && u.active !== false);
  if (!staff) throw bad('Beautician not found');
  if (!(staff.skills || []).includes(b.serviceId)) throw bad(`${staff.name} is not set up with this skill`);
  const spec = { durationMin: b.durationMin, gapMin: b.gapMin };
  if (!slotOk(staff, nd, toMin(ns), spec, b.mode, { excludeId: b.id, ignoreLead: true })) throw bad(`${staff.name} is not free at that time (outside working hours or overlapping another appointment)`);
  const changed = [];
  if (nb !== b.beauticianId) changed.push('beautician -> ' + staff.name);
  if (nd !== b.date || ns !== b.start) changed.push(`time -> ${nd} ${ns}`);
  b.beauticianId = nb; b.date = nd; b.start = ns; b.end = fromMin(toMin(ns) + b.durationMin); b.autoAssigned = false;
  if (changed.length) b.log.push({ at: Date.now(), by: byName, text: 'Changed ' + changed.join(', ') });
  return service;
}
function completeBooking(b, byName) {
  if (!['pending', 'confirmed'].includes(b.status)) throw bad('Only pending or confirmed appointments can be completed');
  const ent = d().entitlements.find((e) => e.id === b.entitlementId);
  const ev = ent && entView(ent);
  if (!ev || ['cancelled', 'awaiting_payment'].includes(ev.state)) throw bad('This purchase is not active (cancelled or awaiting payment)');
  if (!ev.unlimited && ev.used >= ev.total) throw bad('All sessions on this purchase are already used');
  b.status = 'completed'; b.completedAt = Date.now();
  b.log.push({ at: Date.now(), by: byName, text: 'Treatment completed - 1 session deducted' });
}

// ------------------------------------------------------------------ views
function paymentView(p) { return { id: p.id, kind: p.kind, refId: p.refId, amount: p.amount, status: p.status, method: p.method, note: p.note, receipt: p.file ? '/api/receipt/' + p.file : null, createdAt: p.createdAt, reason: p.reason || '' }; }
function orderView(o) {
  const paid = confirmedPaid(o), pending = pendingPaid(o);
  return { ...o, confirmedPaid: paid, pendingPaid: pending, balance: round2(Math.max(0, o.total - paid)), usable: orderUsable(o), payments: d().payments.filter((p) => p.kind === 'order' && p.refId === o.id).map(paymentView) };
}
function bookingView(b) {
  const s = d();
  const staff = s.users.find((u) => u.id === b.beauticianId);
  const pays = s.payments.filter((p) => p.kind === 'booking' && p.refId === b.id);
  const paid = round2(pays.filter((p) => p.status === 'confirmed').reduce((a, p) => a + p.amount, 0));
  const pend = round2(pays.filter((p) => p.status === 'pending').reduce((a, p) => a + p.amount, 0));
  const feeStatus = !b.homeFee ? 'none' : paid >= b.homeFee - 0.005 ? 'paid' : pend > 0 ? 'review' : 'unpaid';
  const cust = s.users.find((u) => u.id === b.customerId);
  return { ...b, beauticianName: staff ? staff.name : '', customerName: cust ? cust.name : '', customerPhone: cust ? cust.phone : '', feeStatus, payments: pays.map(paymentView) };
}
const pubUser = (u) => ({ id: u.id, role: u.role, name: u.name, phone: u.phone, email: u.email || '', address: u.address || '', area: u.area || '', skills: u.skills || undefined });

module.exports = {
  d, BOOKED, pointsBalance, addPoints, flashActive, flashView, decorate, catalog, voucherProblem, voucherDiscount, entitledVouchers, voucherUsage,
  buildLines, priceOrder, createOrder, cancelOrder, confirmedPaid, pendingPaid, orderUsable, refreshOrder, awardPoints, entView,
  studioRanges, staffRanges, slots, availableDays, qualified, slotOk, modeCheck, makeBooking, moveBooking, completeBooking,
  paymentView, orderView, bookingView, pubUser,
};
