# FnB Digital Ordering Platform

QR table ordering for restaurants – customers order from their phone, the kitchen gets the order live,
the cashier prints the bill and checks the table out, and the administrator sees sales analytics.

**Zero dependencies** – only Node.js 18+ is needed. Data is stored in `data/db.json` (uploads in `data/uploads/`).

```bash
npm start            # http://localhost:3000   (PORT=8080 npm start to change)
npm test             # end-to-end smoke test of the full order → kitchen → payment → dashboard flow
```

## The 4 role URLs

| Role | URL | Device | Login |
|---|---|---|---|
| Customer | `/customer?table=A10` (one QR per table) | Phone | none (scan QR) |
| Administrator | `/admin` | Desktop | PIN `1111` |
| Kitchen | `/kitchen` | iPad | PIN `2222` |
| Cashier | `/cashier` | iPad | PIN `3333` |

Change the PINs in **Admin → Charges & Settings** before going live. The landing page `/` lists all four links.

## How it works

1. **Admin sets up** categories → items (name, description, price, multiple photos) → places items into categories in the
   *Menu Builder* (tags: Recommended / Top pick, promo price before → after, sold-out, sub-categories such as ADD ON /
   Option / Soup base / Sauce that are compulsory or optional, built from existing items with an editable bundle price,
   and "No coriander"-style exclusions). Also tables + printable QR codes and extra charges (SST / GST / service fee / none).
2. **Customer** scans the table QR → picks number of diners or take-away → browses the menu by category → item page
   (add-ons, exclusions, remark) → Add to cart → cart (subtotal + charges) → Confirm order. They can keep ordering; all
   rounds go on the same table bill, and they can follow each order's status live.
3. **Kitchen** sees each order per table in a live queue (new → start cooking → complete). Late tickets turn red, new orders beep.
4. **Cashier** sees every table (and which asked for the bill), prints the receipt, takes payment (cash/card/e-wallet/QR,
   change calculation) and completes it. The table is reset automatically and the customer's phone says thank you.
5. **Dashboard** (Admin) – daily / weekly / monthly / yearly sales, bills, average bill, items sold, top-selling items,
   sales by category, catalogue size. *Generate demo sales* fills ~1 year of sample data to preview the reports.

## Deployment notes

* Run behind HTTPS (e.g. a reverse proxy or any Node host) and set **Public base URL** in Settings so QR codes use the public address.
* Real-time updates use Server-Sent Events, so keep a single server instance (state is in one JSON file).
* QR images are generated in the browser with `qrcodejs` from cdnjs (the link under each QR works without it).
* Back up the `data/` folder. Set `DATA_DIR` to store it elsewhere.

## Project layout

```
server.js            HTTP server, REST API, SSE, JSON-file database
public/customer.html customer app          public/admin.html    administrator portal
public/kitchen.html  kitchen display       public/cashier.html  cashier
public/shared.js|css staff helpers/styles  test/smoke.js        end-to-end API test
```
