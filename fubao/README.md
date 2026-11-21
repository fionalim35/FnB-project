# Fubao Beauty Centre – Customer App & Owner Portal

Zero dependencies – only Node.js 18+ is needed. Data lives in `data/db.json` (uploads in `data/uploads`, receipts in `data/receipts`).

```bash
cd fubao
npm start        # http://localhost:3000   (PORT=8080 npm start to change)
npm run demo     # same, plus a demo customer (0123456789 / demo1234), a voucher and a flash sale
npm test         # 16 end-to-end rule checks
```

| Who | URL | First login |
|---|---|---|
| Customer | `/` | Register with contact number (or email) + password |
| Owner | `/admin` | `0182530288` / `fubao1234` – **change in Settings → Change my password** |
| Beautician | `/admin` | Created by owner (sample: `0120000001` / `beauty123` – delete or edit) |

## What it does
Owner portal: services (photos, price before/after, session length + gap, studio/home), packages (sessions, validity, unlimited),
flash promotions with countdown, vouchers (all / specific customers), beauticians (skills + weekly hours), calendar (closed days,
special hours, days off), bookings (approve / assign / reschedule / complete), customers (balances, manual sale, points),
receipts to verify, settings (home fee RM30, areas, deposit %, bank details, points rules).
Customer app: browse, cart + voucher + points, bank-in receipt upload, wallet (used / left / validity), booking with calendar,
home-service address, rewards (points, vouchers), daily mini-game (+0.01 point), purchase history.
Beautician: sees own appointments and marks them completed.

## Key rules
* Validity starts on the **purchase date**; sessions can be booked once payment is confirmed (or the deposit, if a deposit % is set).
* A session is deducted **only when the treatment is marked completed**.
* Bookings need owner approval; the system blocks overlapping times using session length + gap (+ travel time for home visits).
* Points: RM100 spent = 1 point (after payment confirmed); 1 point = RM1 off. Mini-game: 0.01 point, once per day (Malaysia time).
* Home service adds RM30 per visit (paid by bank-in + receipt upload).
* All times are Malaysia time (UTC+8).

## Deployment notes
Run behind HTTPS on any Node host; keep a single instance (state is one JSON file). Back up the `data/` folder (`DATA_DIR` moves it).
`OWNER_PASSWORD=...` sets the owner password on first start.
