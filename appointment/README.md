# Service Appointment Platform

Multi-business booking system (beauty, pet grooming, clinics, repairs…): customers pick a service, choose add-ons, area and a
time slot, pay, and get WhatsApp + email reminders one day before. **Zero dependencies** – Node.js 18+ only. Data lives in `data/db.json`.

```bash
cd appointment
npm start        # from repo root: npm run start:appointment   -> http://localhost:3100
npm test         # end-to-end API test (from root: npm run test:appointment)
```

## The 3 role links

| Role | Link | Device | Login (demo) |
|---|---|---|---|
| Customer | `/shop/<business-link>` e.g. `/shop/glow`, `/shop/paws` | Phone | Name + contact number + email |
| Administrator | `/admin` | Desktop | `glow` / `admin123`, `paws` / `admin123` |
| Super Admin | `/super` | iPad | password `super123` (env `SUPER_PASSWORD`) |

Each business gets its own customer link; the Super Admin portal shows it with a QR code. **Change all demo passwords before go-live.**

## What each role can do

* **Customer** – log in, filter by category / search name (live suggestions) / service area, see price, promo, ratings and next available date →
  service page (description, photos, compulsory/optional add-ons with bundle prices, In-shop or Home service with own address, date + time-slot grid,
  remark) → Cart Bag (several services) → totals with SST/service charge and auto-applied voucher → pay → points earned → My bookings
  (own data only) → rating & review after completion.
* **Administrator** – categories (add/activate/deactivate); services with multiple photos; Catalog & tagging (Recommended / Top pick, promo price + period,
  ADD ON groups built from existing services, compulsory or optional, editable bundle price); service persons tagged by skill, working days/hours, leave;
  weekly days & time slots, notice period, closed dates; service areas (shop / home with travel fee); appointments (customer, remark, payment reference,
  points, progress, reassign person, send reminder); customers & vouchers; reviews; reminder log; dashboard daily/weekly/monthly/yearly with top sellers.
* **Super Admin** – onboard / deactivate businesses, reset administrator passwords, platform dashboard (active administrators, services listed, total sales, sales per business).

## Availability rules

A slot is offered only while at least one **active service person tagged for that service** is free for the full duration (service + selected add-ons),
inside business hours and their own working days/hours. When a customer starts checkout the slot is **held for 10 minutes** (configurable); unpaid
orders expire and release the slot. Two items in one cart cannot rely on the same person at the same time.

## Going live – what you must connect

| Item | Status in this build | To go live |
|---|---|---|
| Payment | **Billplz** (FPX + cards) is built in; without keys it falls back to a **demo gateway** (no money moves) | Set `BILLPLZ_API_KEY`, `BILLPLZ_COLLECTION_ID`, `BILLPLZ_XSIGNATURE_KEY` (and `BILLPLZ_SANDBOX=1` while testing) plus `PUBLIC_URL` (must be public HTTPS so Billplz can call `/api/payments/billplz/callback`). Test in the Billplz sandbox before real money |
| WhatsApp reminder | Simulated, logged in *Reminders log* | Set `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` (Meta WhatsApp Cloud API). Business-initiated messages need an approved template: set `WHATSAPP_TEMPLATE` (body params: name, service, date, time, business) |
| Email reminder | Simulated | Set `RESEND_API_KEY` + `EMAIL_FROM` (Resend) |
| Public URL | localhost | Run behind HTTPS; set `PUBLIC_URL` |
| Customer login | Name + phone + email (as specified; no OTP) | Add SMS/WhatsApp OTP if you need stronger identity checks |

Payment safety: a payment is only accepted when the callback signature is valid and the amount equals the order total. If a customer pays after the slot hold expired, the slot is re-booked when still free; otherwise the order is flagged **Refund needed** on the administrator dashboard (refund in Billplz).

Other env vars: `PORT` (3100), `DATA_DIR`, `TZ` (default `Asia/Kuala_Lumpur`), `DEFAULT_COUNTRY_CODE` (60), `SHOW_BUSINESS_LIST=0` (hide business list on `/`).
Reminders run from a 1-minute timer inside the server, so run **one instance** and back up the `data/` folder.
