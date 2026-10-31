# Nurledger — User Guide

A guide for store owners and staff. Nurledger is a complete shop: selling,
stock, shifts and reports — all on one device.

> **Good to know first:** Nurledger works **completely offline**. You can run a
> whole day of sales, stock and shifts with no internet at all. Cloud sync is an
> **optional extra** that (a) keeps a backup of your data and (b) lets more than
> one tablet/phone in the shop share the same stock and sales. **It is switched
> OFF by default** — nothing is sent anywhere until you turn it on. If you want
> that, start with [Setting up cloud sync](#setting-up-cloud-sync) (one time,
> about 5–10 minutes).

**Contents**
- [Why Nurledger works the way it does](#why-nurledger-works-the-way-it-does)
- [The five tabs](#the-five-tabs)
- [Selling (the register)](#selling-the-register)
- [Refunds](#refunds)
- [Inventory: products, stocktakes, labels, suppliers, CSV](#inventory)
- [Purchase orders](#purchase-orders)
- [Expiry radar](#expiry-radar)
- [Insights (reports)](#insights-reports)
- [Shifts and the cash drawer](#shifts-and-the-cash-drawer)
- [Settings](#settings)
- [Setting up cloud sync](#setting-up-cloud-sync)
- [Adding more devices / cashiers](#adding-more-devices-a-second-tablet-or-phone)
- [Turning it off / leaving / privacy](#turning-it-all-off--leaving)
- [Troubleshooting](#troubleshooting)

---

## Why Nurledger works the way it does

- **Your shop runs on your device.** Every sale, stock movement and shift is written to
  a database *on the tablet or phone you are holding* — not to a remote server. The
  internet is not a requirement: if the connection drops, the power dips, or you're in a
  dead zone, nothing changes. You keep selling, the numbers stay correct, and anything
  queued goes up later when sync is on.
- **Your data is yours.** When you do turn on cloud sync, it points at **your own** free
  Supabase account — not a Nurledger server. The people who make Nurledger never see
  your sales, stock or shifts, and you can delete the whole project at any time (the app
  keeps working from the device either way).
- **Every number can be explained.** Stock is the sum of an append-only ledger of
  movements — every receiving, sale, adjustment and stocktake is a row that can never be
  edited or deleted. If a figure ever looks wrong, you can trace it line by line to the
  movement that caused it. That is why stock adjustments and refunds always need a
  reason.
- **Money is exact.** Amounts are stored as whole cents, not decimals — there is no
  0.1 + 0.2 drift. Split payments are divided so the parts always add up to the total
  exactly, down to the last cent.
- **Costs are real, not averaged.** When an item sells, the cost counted against it is
  the actual cost of the batch it came from, oldest batch first. Your gross profit is
  what you actually made on the stock you actually sold.
- **One app, anywhere.** Nothing is built-in to a country. The currency, the tax regime
  (e.g. GST 9% inclusive, SST 10% inclusive, VAT — or any custom rate) and the payment
  methods are settings you choose for your store. The same app works in Singapore,
  Malaysia, the EU, or anywhere else.
- **No special permissions.** Nurledger asks for nothing unusual — no camera, no
  Bluetooth. Barcodes are scanned with a USB/Bluetooth *keyboard-wedge* scanner or typed
  in, and printing (receipts, labels, purchase orders) works by generating a file you
  can print on any device, any printer.

---

## The five tabs

| Tab | What it's for |
|---|---|
| **Sell** | The register: scan or type items, take payment, print/show the receipt. |
| **Inventory** | Products, stock levels, stocktakes, label printing, suppliers, purchase orders, CSV import/export. |
| **Expiry** | Your perishables, ranked by nearest expiry (FEFO). |
| **Insights** | KPIs, top sellers, sales history, CSV exports. |
| **Shift** | Open/close the register with a cash float, cash in/out, X and Z reports. |

A **shift must be open before selling.** When no shift is open the register is
locked — tap the banner to open one (the Shift tab).

---

## Selling (the register)

1. **Add items** three ways:
   - **Scan** — point a USB/Bluetooth keyboard-wedge scanner at the barcode
     (or the carton's barcode — a carton adds all the units it contains), or
     type the barcode into the scan field and press Enter.
   - **Weighed items** (vegetables, meat) — scan the **scale's barcode** and
     the app reads the weight: "Weighed — Russet Apples · 1.25 kg" with an
     editable weight → **Add to order**. The price is weight × your per-kg rate.
   - **Search** — type a name or SKU, or tap one of the quick chips.
2. **Edit the order** — change quantities, remove a line, or add a **discount**
   per line or on the whole order.
3. **Check the numbers** — the order shows subtotal, tax (for your configured
   tax regime), discounts, total, and the **live margin** on the order.
4. **Take payment** — cash (enter amount tendered, see change due), card,
   mobile, QR, or **split** across methods.
   - *QR* is currently a reference stub: it shows a reference number (e.g.
     `QR-FD5D88B0`) to put on the receipt and records the payment when you
     confirm it was paid.
   - *Card* records a card payment (use your terminal for the actual charge).
5. **Done** — the on-screen receipt appears. Stock goes down **immediately,
   even offline**, and the sale is saved on the device.

**Staff permissions:** cashiers can sell, but **discounts and price overrides**
ask for the manager/owner PIN. The PIN is device-only and never leaves the
device.

---

## Refunds

Give a refund from **Insights → Sales history**:

1. Find the sale (search by product, cashier or sale ID) and tap it.
2. Tap **Refund** on the line you want back. You can refund:
   - **part or all** of a line (you can never refund more than was sold),
   - each line **individually**,
   - with a **reason** (required — e.g. customer return, order mistake),
   - with **restock on or off per line** (on by default — the item goes back
     into your stock at the cost it was sold for).
3. Cashiers are asked for the manager/owner PIN; owners/managers aren't.
4. Done — the sale now shows as refunded (or "no refundable lines left" when it
   is fully refunded).

What happens behind the scenes: the refund is recorded as an **append-only
fact** (it can never be edited or deleted), the stock goes back, and the
shift's Z-report shows a **Refunds** line so your cash count matches.

---

## Inventory

The Inventory tab opens with five quick rows above the product list:
**Purchase orders · Stocktake · Label printing · Suppliers · Product data (CSV)**,
then the products themselves (search by name/SKU, filter **Low Stock Only**).

### Products
Tap a product for its detail: barcode(s), category, unit, cost, price,
**margin %**, min/max, velocity, lot batch + expiry, last updated, and the last
few stock movements. Quick actions: **Adjust** stock (reason required),
**Restock** (starts a purchase order), **Label** (prints labels for just this
item), **Edit**, **Deactivate**.

**Stock adjustments** add or remove stock with a **required reason** (damaged,
waste, correction…). Every adjustment is an append-only ledger row — your
stock can always be explained, line by line.

**Margin-compression warning:** if your latest purchase cost is higher than the
cost the current price was set against, the product detail shows an amber card —
"Margin compressed 62% → 57%" with the cost comparison and a **suggested price**
that restores your original margin. Tap **Use** to apply it (cashiers need the
PIN). The app **never changes a price by itself**.

### Stocktake (count your stock)
1. **Inventory → Stocktake → New stocktake** — choose **all products** or one
   category, and optionally **blind** (the system's quantities are hidden, so
   counters can't just copy them).
2. On the count screen, enter what you actually counted (saving as you go).
   Your **variance vs the live book updates as you count**.
3. **Apply** — cashiers are asked for the manager/owner PIN. Applying writes one
   stock-adjustment row per difference (reason: "Stocktake <date>"), so the
   shrinkage is fully auditable. Applied stocktakes become read-only.

### Label printing
For products without scannable barcodes (or to reprint):
1. **Inventory → Label printing** (or **Label** on a product's detail page).
2. Pick the **scope** — all products, one category, or a single product — and
   **copies per product** (default 5).
3. Pick the paper: **58 mm roll** (one label per 58×40 mm cut) or **A4 sheet**
   (labels in a 3-column grid for scissors).
4. **Generate & Share** — Nurledger creates a print-ready HTML file and opens
   the share sheet. Open it in any browser on any phone/computer and print on
   any printer — no special hardware needed.

Every label carries a **real, scannable barcode** (UPC-A where the code is
12-digit, otherwise Code 39 — items with no barcode get a Code 39 of their SKU,
so you can sell them by scanning from day one).

### Suppliers
**Inventory → Suppliers.** Keep your vendor list: name, **lead time** (days),
notes, and which products each one supplies. New purchase orders can pick a
supplier from this list (the vendor field autofills), or you can type any
vendor freehand. Deleting a supplier that has linked products asks first and
unlinks them (the products themselves are kept).

### Product data (CSV) — import & export
**Inventory → Product data (CSV)**:
- **Export** — everything (name, SKU, barcode, carton barcode, category, unit,
  cost, price, tax category, min/max, velocity, description, active) as a CSV
  file via the share sheet. Handy for backups or for editing in a spreadsheet.
- **Import** — pick a CSV file → you get a **preview with a report** before
  anything is applied ("13 importable · 1 errors"; problems are shown with the
  exact row and the reason, e.g. "line 15 · price: must be a non-negative
  number") → **Import** applies it.

Import rules: columns are matched **by their header names** (order doesn't
matter); products are matched by **SKU** (a new SKU creates the product, an
existing one updates it); **money is in normal units** (4.50, not cents);
category **names** are used, and a name you haven't used yet is created
automatically.

---

## Purchase orders

**Inventory → Purchase orders.** A PO is how you buy stock in:

1. **Create** — pick a product (or start from **Restock** on the product page,
   which prefills the suggested quantity from your min/max), a supplier (from
   your supplier list or free text), quantity, unit cost, and batch/expiry
   details where relevant.
2. **Receive** — receive all at once or in **batches**; each received batch
   becomes a **lot** (batch code + expiry) and adds stock **and** a FIFO cost
   layer at the batch cost.
3. **Cartons** — for carton products, receive in cartons and the app converts
   to base units (receive 2 cartons of 12 → +24).
4. **Share** — the PO can be exported as a document (vendor, terms, lines,
   totals) via the share sheet — WhatsApp it to the supplier or print it.

---

## Expiry radar

The Expiry tab ranks your batches **FEFO — first-expired, first-out**:
the soonest-to-expire stock is at the top, colour-coded (rose = expired/very
near, amber = soon). It shows the waste you've already lost to expiry. Sell
from the top of this list and your shrinkage drops.

---

## Insights (reports)

- **KPI cards** — revenue (net), COGS, gross profit, operating net margin,
  discounted items, units, transactions, average basket, UPT — for **Today**,
  the **current period** or **all time**.
- **Payment Mix** — how the money came in: sales by payment method (cash,
  card, QR…) for the selected period, with each method's share of the total.
  Switch periods and it updates with them.
- **Extended KPIs** — mark-up %, inventory turnover, days on hand, sell-through,
  GMROI, shrinkage, stockout rate, expiry waste, fill rate.
- **Top sellers** — by revenue share, with velocity/ABC class.
- **Sales history** — every sale, searchable by product / cashier / sale ID.
  This is also where **refunds** start (tap a sale). Export the history to CSV.

---

## Shifts and the cash drawer

1. **Open a shift** — enter the **float** (the cash you start with). The
   register unlocks.
2. During the shift: **cash in / cash out** with a reason (e.g. personal
   purchase, petty cash), and an **X-report** anytime — a non-destructive
   snapshot of sales by method and cash expected in the drawer.
3. **Close the shift** — enter the **counted cash**. The app compares it with
   the expected cash (float + cash sales − cash out + refunds given in cash)
   and shows **exact / over / short**.
4. The **Z-report** is generated and saved with the shift: sales by payment
   method, cash movements, **refunds**, and the variance. The register locks
   again.

Shifts work **fully offline** — close the day's shift with no internet and it
all syncs later.

---

## Settings

- **Store** — the shop's name (shown on receipts and reports).
- **Language** — the app's interface language: **English** or
  **Bahasa Melayu**. This is a **per-device** choice (each staff member's
  tablet can be in a different language) and it does **not** change the shop's
  currency or tax.
- **Currency** — what you sell in. Pick a preset or any ISO currency code.
  ⚠️ Changing the currency reinterprets existing amounts in the new currency —
  re-price as needed. (Some currencies like JPY show no decimals.)
- **Tax** — pick a regime (e.g. Singapore GST 9% inclusive, Malaysia SST 10%
  inclusive, EU VAT 21% exclusive) or a **custom rate** (0–40%, inclusive or
  exclusive). Nothing is hardcoded to a country — the same app works
  anywhere.
- **Receipt width** — 58 mm or 80 mm.
- **Staff** — add cashiers (name, role, PIN). Cashiers sign in on a shared
  tablet by tapping their name; PIN-gated actions (discounts, price overrides,
  refunds, stocktakes, closing shifts, settings) ask for the manager/owner PIN.
- **Cloud sync** — see below.

---

## Setting up cloud sync

Cloud sync connects Nurledger to **your own free Supabase account**. Supabase is a
free online database service. Because it's *your* account, **your data belongs to you** —
the people who make Nurledger can never see it. You can switch it off or delete it at
any time, and your data on the device is never affected.

You only need to do this **once per shop** (about 5–10 minutes). Every other device in
the shop then connects using the same details.

### What you'll need
- A phone or tablet with Nurledger installed (this "first" device).
- Internet access for the setup itself.
- An email address for the Supabase account.

### Step 1 — Create your free Supabase account
1. On any phone or computer, open **<https://supabase.com>**.
2. Tap **Sign up** (you can sign up with your email, or with Google).
3. Fill in your email and choose a password. Check your email and confirm it if asked.
4. You're now logged into the Supabase dashboard.

> Supabase's **free plan is more than enough** for a single shop. You will not be charged
> unless you deliberately upgrade it.

### Step 2 — Create a project for your shop
1. In the dashboard, tap **New project** (or "Create a new project").
2. Give it a name — use your **shop name** (e.g. "My Provision Store").
3. Choose a **database password** and keep it somewhere safe (you won't use it often).
4. Pick a region — choose the one **closest to where your shop is** (e.g. Singapore).
5. Tap **Create new project** and wait 1–2 minutes for it to be ready.

### Step 3 — Copy your project's details
1. Open your new project.
2. In the left menu, go to **Project settings** (the gear icon) → **API**.
3. You'll see three things. Copy **all three**:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon / public key** — a long key labelled `anon public` (this is safe to share with the app)
   - **service_role key** — a long key labelled `service_role` (**keep this private** — it's like a master password for your database)

> The **service_role** key is the only sensitive one. Nurledger uses it at setup to
> **check** that your shop database structure was created correctly (it cannot create
> it for you — see Step 4), and then keeps it stored on your device. Don't paste it
> anywhere else or share it.

### Step 4 — Connect it in Nurledger
1. Open **Nurledger** on your first device.
2. Go to **Settings** (the gear / Store card).
3. Find **Cloud sync** — it will say **Off**.
4. Tap **Connect your store**.
5. Paste the three details (Project URL, anon key, service_role key) and tap **Continue**.
   Nurledger checks that it can reach your project.

   **One manual step (about 1 minute):** Supabase does not let apps create tables in a
   project on your behalf, so you run a short setup script in the project yourself:
   1. Nurledger shows the script on screen — tap **Copy** (it is long, do not type it).
   2. Back in the Supabase dashboard, open **SQL Editor** (left menu) → **New query**.
   3. Paste the script into the editor box and tap **Run**.
   4. You should see a short success message (a few tables created).
   5. Go back to Nurledger and tap **Check that the setup ran**. When it is right you
      will see a **Connected** confirmation.

   This script is safe to re-run any time — it creates the tables and rules for your
   products, categories, sales and stock, and never touches existing data.
   If you connected with an **older app version**, the app shows the *updated*
   script instead (labelled "upgrade") — same steps, and it is just as safe.

### Step 5 — Create your owner login
1. Still in **Cloud sync**, tap **Create owner account** (if prompted).
2. Enter your **email** and choose a **password**. This is *your* login for the shop —
   it's stored in your own Supabase account from Step 1.
3. If Supabase asks you to confirm the email, open your inbox and tap the link.

That's it — **your shop is now connected**.

### Step 6 — Turn sync ON
1. In **Cloud sync**, flip the **Sync** switch to **On**.
2. Your sales, stock, products, categories and refunds now back up to your
   Supabase project, and any queued offline activity uploads automatically.
3. You'll see **"Last synced: just now"** (or a similar line) under the switch.

You can flip this switch **On/Off anytime**. Turning it **Off** stops syncing but **never
deletes anything** — your sales keep being saved on the device, and they upload the next
time you turn it back on.

### Reading the sync banner (Sell tab)
- **"Syncing…"** — working right now.
- **"N ops queued — syncing automatically"** — N things are waiting (normal right after offline sales).
- **"Synced 9:03 AM"** — up to date.
- **"N ops queued · Sync off"** — queued but the switch is off.
- **"Sync error: …"** — something's wrong (the banner says why; see Troubleshooting).

---

## Adding more devices (a second tablet or phone)
1. Install Nurledger on the second device.
2. On the second device: **Settings → Cloud sync → Connect your store**.
3. Paste the **same** three details from your Supabase project (Step 3).
4. Sign in with the **same owner email + password** from Step 5.
5. Turn **Sync** **On**.

Both devices now share the same shop: sell on one, and after it syncs, the other sees the
updated stock, products, categories and sales. If two tablets sell the same item offline and both sync, Nurledger combines
them correctly — **no sale is counted twice**, and stock stays accurate. A refund made on
one device appears on the other after it syncs.

## Adding cashiers (staff)
Staff **don't need a Supabase account.** You (the owner) add them in the app:
1. **Settings → Staff** (or when opening a shift, pick "Add cashier").
2. Give the person a **name**, a **role** (e.g. Cashier), and a **PIN**.
3. On a shared tablet, that person taps their name and enters their PIN to take the register.

The PIN is used only on the device (for permissions like discounts, refunds,
stocktakes and closing a shift).
The PIN is never sent to Supabase. To remove someone, just deactivate their account — they
lose access immediately, and their past sales stay in your records.

---

## Turning it all off / leaving
- **Pause:** flip **Sync** to **Off** — nothing uploads, everything stays on the device.
- **Disconnect:** **Settings → Cloud sync → Disconnect** removes the connection. Your
  device data is untouched.
- **Delete your data:** it's in your Supabase project — delete the project from the
  Supabase dashboard and it's gone. Nurledger (the app) never has a copy of it.

## Is my data private?
Yes. Your data lives in **your own Supabase project**, under **your own account**. The
Nurledger app is just a client that talks to your project. The people who build Nurledger
do not have access to your data. You can verify any time by logging into
<https://supabase.com> and opening your project.

## Troubleshooting
| Problem | What to do |
|---|---|
| "Connection failed" when connecting | Re-check the **Project URL** (must end in `.supabase.co`) and that you pasted the **anon** key, not a truncated one. Make sure the project is still running (free projects pause after a week of no use — opening the project in the dashboard wakes it). |
| Nothing is syncing after turning it On | Wait a moment, then pull to refresh / reopen Settings. Check the device has internet. The "N ops queued" line shows what's waiting. |
| "Sync error: …" mentions a missing table | A newer app version needs the updated setup script: in Settings → Cloud sync, tap **Disconnect** (your data on the device is untouched), then **Connect your store** again — the app detects the older setup and shows the updated script. Run it in Supabase's SQL Editor (safe to re-run — it never touches existing data) and finish the reconnection. |
| I pasted the wrong service_role key | Disconnect, then Connect again with the correct keys. (The setup is repeatable — it won't duplicate your data.) |
| Free project paused (after ~1 week idle) | Open your project in the Supabase dashboard once; it wakes up and sync resumes. |
| A weighed item shows the wrong weight | Re-check the scale's barcode format matches your locale's scale (Settings → the store's locale drives the barcode parser). You can always edit the weight before adding it to the order. |
| Printed labels don't scan | Make sure you printed at 100% scale (no "fit to page"). Regenerate and print again; the barcodes are standard UPC-A/Code 39 and scan with any scanner. |
