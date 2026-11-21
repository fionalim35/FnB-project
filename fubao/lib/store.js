'use strict';
const fs = require('fs');
const path = require('path');
const { uid, hashPassword, addDays, nowMY } = require('./util');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const RECEIPTS = path.join(DATA_DIR, 'receipts');
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(RECEIPTS, { recursive: true });

let db = null;
let timer = null;

const hours = (s, e) => [{ s, e }];
function weekly(open = '10:00', close = '19:00', days = [1, 2, 3, 4, 5, 6]) {
  const w = {};
  for (let i = 0; i < 7; i++) w[i] = days.includes(i) ? hours(open, close) : [];
  return w;
}

function defaultSettings() {
  return {
      studioName: 'Fubao Beauty Centre',
      phone: '018-2530288',
      whatsapp: '60182530288',
      address: '28, Jalan Perdana 1/4, Ampang, 56100 Majlis Perbandaran Ampang Jaya, Selangor',
      studioEnabled: true,
      homeEnabled: true,
      homeFee: 30,
      homeAreas: ['Kuala Lumpur', 'Petaling Jaya', 'Subang Jaya', 'Shah Alam', 'Klang', 'Puchong', 'Cheras', 'Ampang', 'Kajang', 'Selayang', 'Gombak'],
      homeTravelMin: 45,
      studioWeekly: weekly(),
      studioOverrides: {},
      slotStepMin: 30,
      minLeadHours: 2,
      maxAdvanceDays: 60,
      cancelHours: 24,
      depositPercent: 0,
      bank: { bankName: '', accountNo: '', accountName: 'Fubao Beauty Centre', instructions: 'Please bank in the amount and upload your receipt. Your purchase is confirmed once we verify the payment.' },
      pointsEarnPerRM: 100,
      pointValueRM: 1,
      gamePoints: 0.01,
      emailEnabled: false,
      ownerNotifyEmail: '',
      smtp: { host: 'smtp.gmail.com', port: 465, user: '', pass: '', fromName: 'Fubao Beauty Centre', fromEmail: '' },
  };
}

function seed() {
  const now = Date.now();
  const d = {
    meta: { version: 1, createdAt: now },
    counters: { order: 0, booking: 0 },
    settings: defaultSettings(),
    users: [],
    sessions: {},
    services: [],
    packages: [],
    flashes: [],
    vouchers: [],
    orders: [],
    entitlements: [],
    payments: [],
    bookings: [],
    points: [],
    games: [],
  };

  d.users.push({
    id: uid(), role: 'owner', name: 'Owner', phone: '0182530288', email: '',
    passHash: hashPassword(process.env.OWNER_PASSWORD || 'fubao1234'), active: true, createdAt: now,
  });

  let sort = 0;
  const svc = (name, category, price, o = {}) => {
    const s = Object.assign({
      id: uid(), name, category, description: '', images: [], priceBefore: null, priceAfter: price,
      durationMin: 60, gapMin: 15, studioAllowed: true, homeAllowed: true, validityDays: 0, active: true, sort: (sort += 10), createdAt: now,
    }, o);
    d.services.push(s);
    return s;
  };
  const LASH = 'Lash Extensions', EMB = 'Embroidery', SKIN = 'Skin Care / Aesthetic / Add-on';
  const single = svc('Single Natural Lash', LASH, 110, { durationMin: 120, description: 'Natural-looking single lash extension.' });
  const yy = svc('YY Lash', LASH, 120, { durationMin: 120, description: 'YY-shaped lash extension for extra volume.' });
  const vol = svc('3D / 5D / 6D Lash', LASH, 120, { durationMin: 120, description: 'Volume lash extension - 3D, 5D or 6D.' });
  const cam = svc('Camellia Lash', LASH, 120, { durationMin: 120, description: 'Camellia (flower-effect) lash extension.' });
  const thai = svc('Thai Lash / Kimk / Fairy', LASH, 120, { durationMin: 120, description: 'Thai, Kimk or Fairy style lash extension.' });
  const mist = svc('Mist Brow (韩式粉雾眉)', EMB, 290, { durationMin: 150, gapMin: 15, homeAllowed: false, description: 'Korean-style powder mist brow embroidery. Includes 1 free touch-up within 2 months when bought as the Embroidery package.' });
  const lips = svc('Lips Embroidery (妈生唇)', EMB, 230, { durationMin: 120, homeAllowed: false, description: 'Natural lip colour embroidery.' });
  const eyel = svc('Eyeliner Embroidery (眼线纹绣)', EMB, 190, { durationMin: 90, homeAllowed: false, description: 'Eyeliner embroidery for a defined, lasting eye line.' });
  const mistT = svc('Mist Brow Touch-Up', EMB, 170, { durationMin: 90, homeAllowed: false, description: 'Touch-up session (free within 2 months of your embroidery).' });
  const lipsT = svc('Lips Touch-Up', EMB, 150, { durationMin: 75, homeAllowed: false, description: 'Touch-up session (free within 2 months of your embroidery).' });
  const eyelT = svc('Eyeliner Touch-Up', EMB, 130, { durationMin: 60, homeAllowed: false, description: 'Touch-up session (free within 2 months of your embroidery).' });
  const fill = svc('Fillers (丰唇 / 下巴 / 法令纹)', SKIN, 250, { durationMin: 45, homeAllowed: false, description: 'Dermal fillers for lips, chin or smile lines - per dose.' });
  const kera = svc('Keratin Lash Lift', SKIN, 60, { durationMin: 60, description: 'Lash lift and keratin treatment for naturally curled lashes.' });
  const facial = svc('Basic Facial Cleansing', SKIN, 60, { durationMin: 60, description: 'Deep cleansing facial. Includes free mask and free face massage.' });
  const mani = svc('Basic Manicure', SKIN, 50, { durationMin: 60, description: 'Basic manicure - can mix up to 2 colours.' });

  let psort = 0;
  const pkg = (name, items, price, before, validityDays, o = {}) => {
    const p = Object.assign({
      id: uid(), name, description: '', images: [], priceBefore: before, priceAfter: price, validityDays,
      items, unlimited: false, active: true, sort: (psort += 10), createdAt: now,
    }, o);
    d.packages.push(p);
    return p;
  };
  const six = (s, price) => pkg(`${s.name} - 6 Times`, [{ serviceId: s.id, qty: 6 }], price, s.priceAfter * 6, 180, { description: `6 sessions of ${s.name}.` });
  six(single, 500); six(yy, 550); six(vol, 550); six(cam, 550); six(thai, 550);
  pkg('Embroidery: Mist Brow + 1 Free Touch-Up', [{ serviceId: mist.id, qty: 1 }, { serviceId: mistT.id, qty: 1 }], 290, null, 60, { description: 'Mist brow session plus 1 free touch-up within 2 months.' });
  pkg('Embroidery: Lips + 1 Free Touch-Up', [{ serviceId: lips.id, qty: 1 }, { serviceId: lipsT.id, qty: 1 }], 230, null, 60, { description: 'Lips embroidery plus 1 free touch-up within 2 months.' });
  pkg('Embroidery: Eyeliner + 1 Free Touch-Up', [{ serviceId: eyel.id, qty: 1 }, { serviceId: eyelT.id, qty: 1 }], 190, null, 60, { description: 'Eyeliner embroidery plus 1 free touch-up within 2 months.' });
  pkg('Fillers - 4 Dose', [{ serviceId: fill.id, qty: 4 }], 888, 1000, 365, { description: '4 doses of fillers (lips / chin / smile lines).' });
  pkg('Keratin Lash Lift - 6 Times', [{ serviceId: kera.id, qty: 6 }], 300, 360, 180, { description: '6 sessions of Keratin Lash Lift.' });
  pkg('Basic Facial Cleansing - 6 Times', [{ serviceId: facial.id, qty: 6 }], 300, 360, 180, { description: '6 sessions of Basic Facial Cleansing, with free mask and face massage.' });
  pkg('Basic Manicure - 6 Times', [{ serviceId: mani.id, qty: 6 }], 260, 300, 180, { description: '6 manicure sessions (mix up to 2 colours).' });
  pkg('Special Member Package - Unlimited (1 Year)', [single, yy, vol, cam, thai, kera, facial].map((s) => ({ serviceId: s.id, qty: 1 })), 988, null, 365, {
    unlimited: true,
    description: 'Unlimited lash extension / lash keratin / facial for one year. No limit on length, volume or type. Free brush included.',
  });

  // Sample beauticians (edit or delete in the portal)
  const all = d.services.map((s) => s.id);
  const lashSkills = [single, yy, vol, cam, thai, kera, facial, mani].map((s) => s.id);
  d.users.push({
    id: uid(), role: 'beautician', name: 'Beautician A (sample)', phone: '0120000001', email: '', passHash: hashPassword('beauty123'),
    active: true, createdAt: now, skills: all, weekly: weekly(), overrides: {},
  });
  d.users.push({
    id: uid(), role: 'beautician', name: 'Beautician B (sample)', phone: '0120000002', email: '', passHash: hashPassword('beauty123'),
    active: true, createdAt: now, skills: lashSkills, weekly: weekly(), overrides: {},
  });
  return d;
}

// Optional demo data (npm run demo)
function seedDemo(d) {
  const now = Date.now();
  if (d.users.some((u) => u.phone === '0123456789')) return;
  const cust = { id: uid(), role: 'customer', name: 'Demo Customer', phone: '0123456789', email: 'demo@example.com', passHash: hashPassword('demo1234'), active: true, createdAt: now, address: '12, Jalan Demo, Ampang', area: 'Ampang' };
  d.users.push(cust);
  const today = nowMY().date;
  d.vouchers.push({ id: uid(), code: 'WELCOME10', title: 'Welcome RM10 off', description: 'RM10 off any purchase above RM100', type: 'amount', value: 10, minSpend: 100, maxDiscount: 0, startDate: addDays(today, -1), endDate: addDays(today, 90), scope: 'all', customerIds: [], appliesTo: 'all', perCustomerLimit: 1, totalLimit: 0, active: true });
  d.flashes.push({ id: uid(), title: 'Weekend Flash Sale', description: 'Special price on Camellia Lash 6 Times - grab it before the timer ends!', image: '', startAt: addDays(today, -1) + 'T00:00', endAt: addDays(today, 2) + 'T23:59', targetType: 'package', targetId: d.packages.find((p) => p.name.startsWith('Camellia')).id, flashPrice: 480, active: true });
}

function load() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = seed();
    saveNow();
  }
  for (const k of ['users', 'services', 'packages', 'flashes', 'vouchers', 'orders', 'entitlements', 'payments', 'bookings', 'points', 'games']) db[k] = db[k] || [];
  db.sessions = db.sessions || {};
  db.resets = db.resets || {};
  db.mailLog = db.mailLog || [];
  const def = defaultSettings();
  for (const k of Object.keys(def)) if (!(k in db.settings)) db.settings[k] = def[k];
  db.counters = db.counters || { order: 0, booking: 0 };
  const t = Date.now();
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].exp < t) delete db.sessions[k];
  if (process.env.DEMO || process.argv.includes('--demo')) { seedDemo(db); saveNow(); }
  return db;
}
function saveNow() {
  if (!fs.existsSync(DATA_DIR)) return;
  clearTimeout(timer);
  if (!db) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function save() { clearTimeout(timer); timer = setTimeout(saveNow, 150); }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });
process.on('exit', () => { try { saveNow(); } catch { /* data folder removed (tests) */ } });

module.exports = { DATA_DIR, UPLOADS, RECEIPTS, load, save, saveNow, d: () => db, weekly };
