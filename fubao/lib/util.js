'use strict';
const crypto = require('crypto');

const uid = () => crypto.randomBytes(6).toString('hex');
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v, def = 0) => { if (v === '' || v == null) return def; const n = Number(v); return Number.isFinite(n) ? n : def; };

// All studio times are Malaysia time (UTC+8). Dates are 'YYYY-MM-DD', times 'HH:MM', date-times 'YYYY-MM-DDTHH:MM'.
const MY_OFFSET = 8 * 3600e3;
function nowMY(ms = Date.now()) {
  const d = new Date(ms + MY_OFFSET);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), iso: iso.slice(0, 16), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s) && isDate(s.slice(0, 10));

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const c = crypto.scryptSync(String(pw), salt, 32);
  const b = Buffer.from(h, 'hex');
  return b.length === c.length && crypto.timingSafeEqual(b, c);
}
function normPhone(v) {
  let p = String(v || '').replace(/[^\d]/g, '');
  if (p.startsWith('60')) p = '0' + p.slice(2);
  return p;
}
const normEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 120);

module.exports = { uid, round2, HttpError, bad, str, num, nowMY, addDays, dow, diffDays, toMin, fromMin, isDate, isTime, isDateTime, hashPassword, checkPassword, normPhone, normEmail, MY_OFFSET };
