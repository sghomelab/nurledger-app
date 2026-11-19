# NurLedger — User Guide

A guide for store owners and staff. NurLedger is a complete shop: selling,
stock, shifts and reports — all on one device.

> **Good to know first:** NurLedger works **completely offline**. You can run a
> whole day of sales, stock and shifts with no internet at all. Cloud sync is an
> **optional extra** that (a) keeps a backup of your data and (b) lets more than
> one tablet/phone in the shop share the same stock and sales. **It is switched
> OFF by default** — nothing is sent anywhere until you turn it on. If you want
> that, start with [Setting up cloud sync](#setting-up-cloud-sync) (one time,
> about 5–10 minutes).

**Contents**
- [Why NurLedger works the way it does](#why-nurledger-works-the-way-it-does)
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
- [The register lock and forgotten PINs](#the-register-lock--forgotten-pins)
- [Turning it off / leaving / privacy](#turning-it-all-off--leaving)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## Why NurLedger works the way it does

- **Your shop runs on your device.** Every sale, stock movement and shift is written to
  a database *on the tablet or phone you are holding* — not to a remote server. The
  internet is not a requirement: if the connection drops, the power dips, or you're in a
  dead zone, nothing changes. You keep selling, the numbers stay correct, and anything
  queued goes up later when sync is on.
- **Your data is yours.** When you do turn on cloud sync, it points at **your own** free
  Supabase account — not a NurLedger server. The people who make NurLedger never see
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
- **Almost no permissions.** NurLedger asks for nothing unusual — no Bluetooth,
  no location. The only permission it can request is the **camera**, and only when
  you actively open the built-in barcode scanner; use a physical scanner or type
  the code and you never grant it. Printing (receipts, labels, purchase orders)
  works by generating a file you can print on any device, any printer — or email
  to the customer.

---

## The five tabs

| Tab | What it's for |
|---|---|
| **Sell** | The register: scan (camera, physical scanner, or typed) or search items, take payment, on-screen receipt with optional email. Gear icon at the top right opens Settings. |
| **Inventory** | Products, stock levels, stocktakes, label printing, suppliers, purchase orders, CSV import/export. |
| **Expiry** | Your perishables, ranked by nearest expiry (FEFO). |
| **Insights** | Tabbed analytics: **Overview**, **Financials**, **Products**, **History** — KPIs, P&L, top sellers, searchable sales history (where refunds start), CSV exports. |
| **Shift** | Open/close the register with a cash float, cash in/out, Shift snapshot (X-report) and Shift Close (Z-report), both printable. |

A **shift must be open before selling.** When no shift is open the register is
locked — tap the banner to open one (the Shift tab).

---

## Selling (the register)

1. **Add items** four ways:
   - **Camera** — tap the **camera icon** next to the scan field and point the
     phone at the barcode (or the carton's barcode — a carton adds all the units
     it contains). The item is added to the order right away.
   - **Physical scanner or type** — point a USB/Bluetooth *keyboard-wedge*
     scanner at the barcode, or type the code into the scan field and press
     Enter.
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
   even offline**, and the sale is saved on the device. The receipt screen has
   two ways to get it to the customer: **Email** (if you turned on **Ask to
   email the receipt** in Settings → Receipt, you're offered right away — type
   their address or scan their email QR code) and **Share** — the receipt as a
   **PDF** into WhatsApp / Telegram / Messages, or saved to print later. The
   PDF is exactly what's on the screen, so there's never a mismatch.

**Staff permissions:** cashiers can sell, but **discounts and price overrides**
ask for the manager/owner PIN. Cashiers can also have their **own PIN** — it
lets them unlock the register after it auto-locks, and it's needed to switch
back to them. The register itself **locks when nobody is using it** (see *The
register lock and forgotten PINs* below). All PINs are device-only and never
leave the device.

---

## Refunds

Give a refund from **Insights → History tab → Sales history**:

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
4. **Generate & Share** — NurLedger creates a print-ready HTML file and opens
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

A **period selector** (Today · Current period · All time) sits on top and
applies to every tab below it. The tab is split into four sections:

- **Overview** — KPI cards (revenue net, gross profit, operating net margin,
  discounted items, units, transactions, average basket, UPT), **Payment Mix**
  (how the money came in: cash, card, QR… with each method's share of the
  total), and **Extended KPIs** (mark-up %, inventory turnover, days on hand,
  sell-through, shrinkage, stockout rate, expiry waste, fill rate).
- **Financials** — a **Profit & Loss** statement (gross sales → COGS → gross
  margin → your operating expenses: payroll, maintenance, other → operating net
  margin), an **Inventory asset position** (value at cost, at retail, unrealised
  margin) and an **Operating expenses** list you can add to.
- **Products** — **Top sellers** by revenue share with velocity/ABC class, and
  a **Stockout forecast** (what runs out when, based on recent sales).
- **History** — every sale in the period, searchable by product / cashier /
  sale ID, with CSV export. This is also where **refunds** start: tap a sale,
  then **Refund** on the line you want back.

---

## Shifts and the cash drawer

1. **Open a shift** — enter the **float** (the cash you start with). If the
   person at the register has a PIN, they enter it first (proof of identity).
   The register unlocks.
2. During the shift: **cash in / cash out** with a reason (e.g. personal
   purchase, petty cash), and a **Shift snapshot** (the X-report) anytime — a
   non-destructive snapshot of sales by method and the cash expected in the
   drawer.
3. **Close the shift** — enter the **counted cash**. The app compares it with
   the expected cash (float + cash sales − cash out + refunds given in cash)
   and shows **exact / over / short**. When a **cashier** is at the register,
   both the X-report and closing the shift ask for the manager/owner PIN.
4. The **Shift Close report** (the Z-report) is generated and saved with the
   shift: sales by payment method, cash movements, **refunds**, and the
   variance. The register locks again.

Every report sheet has two export actions: **Print** (the system print
dialog — AirPrint on iOS) and **Save / share PDF** — the file matches the
on-screen numbers, in your app language.

Shifts work **fully offline** — close the day's shift with no internet and it
all syncs later.

---

## Settings

Open it from the **gear icon (⚙) at the top right of the Sell tab**.

- **Store** — the shop's name (shown on receipts and reports).
- **Print & export** — one place for everything printable/exportable:
  **Price labels** (58 mm roll or A4 sheet), **Product data (CSV)** (import or
  export the product list), **Purchase orders** (share or print PO documents)
  and **X & Z reports** (jumps to the Shift tab).
- **Language** — the app's interface language: **English**, **Bahasa Melayu**
  or **Filipino**. Until you choose one, the app follows your phone's language
  (and uses English if your language is not supported). This is a **per-device** choice (each staff member's
  tablet can be in a different language) and it does **not** change the shop's
  currency or tax.
- **Theme** — **Light**, **Dark** or **System** (follows the phone). Also
  per-device; your data is unchanged.
- **Currency** — what you sell in. Pick a preset or any ISO currency code.
  ⚠️ Changing the currency reinterprets existing amounts in the new currency —
  re-price as needed. (Some currencies like JPY show no decimals.)
- **Tax** — pick a regime (e.g. Singapore GST 9% inclusive, Malaysia SST 10%
  inclusive, EU VAT 21% exclusive) or a **custom rate** (0–40%, inclusive or
  exclusive). Nothing is hardcoded to a country — the same app works
  anywhere.
- **Receipt** — **Printer width** (58 mm or 80 mm) and **Ask to email the
  receipt** — when on, after every payment NurLedger offers to email the
  receipt to the customer (type their address or scan an email QR code). The
  receipt can also be **Shared as a PDF** from the Payment Successful screen.
- **Security** (owner only) — the **Store PIN** (the shop's master PIN, with
  its one-time **recovery code**), **Auto-lock register** (Never / 1 / 5 / 15 /
  30 min of inactivity, default 5), **Reset a PIN** (any user), and **Verify
  audit log** (the tamper-evident record of every lock, unlock, user switch
  and privileged action). See *The register lock and forgotten PINs*.
- **Cloud sync** — see below.
- **Staff** — managed on the **Shift** tab (see *Adding cashiers and managing
  PINs* below), not in Settings. PIN-gated actions (discounts, price overrides,
  refunds, stocktakes, closing shifts, settings) ask for the manager/owner PIN.
- **Danger zone** — **Reset all data** wipes everything on this device
  (PIN-gated, type-to-confirm). If cloud sync is on, sync first.

---

## Setting up cloud sync

Cloud sync connects NurLedger to **your own free Supabase account**. Supabase is a
free online database service. Because it's *your* account, **your data belongs to you** —
the people who make NurLedger can never see it. You can switch it off or delete it at
any time, and your data on the device is never affected.

You only need to do this **once per shop** (about 5–10 minutes). Every other device in
the shop then connects using the same details.

### What you'll need
- A phone or tablet with NurLedger installed (this "first" device).
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
3. Copy **both** of these:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - the **key labelled `anon public`** — a very long key that starts with
     `eyJ`. This is the one to paste into NurLedger; it is safe to put in the
     app (the real protection is the database rules the setup script installs,
     not the key itself).

   If you see more than one key, take the one labelled **`anon public`** and
   nothing else.

> **Never paste the `service_role` key into NurLedger.** It is a master key for
> your database and the app does not need it (older versions asked for it — if
> you ever pasted it, go to Project settings → API and **regenerate** the
> service role key; current versions delete any stored copy from the phone
> automatically).

> A self-hosted Supabase must be reachable over HTTPS; release builds block
> plain http (only local-development addresses are accepted in debug builds).

> **Heads-up: free projects sleep.** A free Supabase project that sits unused
> for about a week goes to sleep. That's not an error — open the project once
> in the dashboard to wake it (takes a few minutes), and NurLedger's
> connection resumes on its own.

### Step 4 — Connect it in NurLedger
1. Open **NurLedger** on your first device.
2. Open **Settings** (the gear icon at the top right of the Sell tab).
3. Find the **Cloud sync** card — it will say **Off**.
4. Tap **Connect your backend**.
5. Choose **New store** (this is your first device) and paste the two details (Project URL, `anon public` key), then tap **Check connection**.

   What the check can say:
   - **"Backend reachable and the NurLedger schema is deployed."** — you're
     done with this step.
   - **"Backend reachable — but the schema is not deployed yet."** — continue
     to the SQL step below.
   - **"Backend reachable — it runs schema vN, but this app needs vM."** — your
     project was set up by an older app version; run the *updated* script
     shown (safe to re-run — it never touches existing data).
   - **"Backend unreachable: …"** — something's off; see *Common setup
     problems* at the end of this section.

   **One manual step (about 1 minute):** Supabase does not let apps create tables in a
   project on your behalf, so you run a short setup script in the project yourself:
   1. NurLedger shows the script on screen — tap **Copy SQL** (it is long, do not type it).
      It ends with a one-time claim line made just for this setup: only this phone can
      finish creating your store, nobody else who finds your project URL.
   2. Back in the Supabase dashboard, open **SQL Editor** (left menu) → **New query**.
   3. Paste the script into the editor box and tap **Run**.
   4. You should see a short success message (a few tables created).
   5. Go back to NurLedger and tap **I've run it — check setup**. When it is right you
      will see a **Connected** confirmation.

   This script is safe to re-run any time — it creates the tables and rules for your
   products, categories, sales and stock, and never touches existing data.

### Step 5 — Create your owner login
1. Still in **Cloud sync**, tap **Create owner account** (if prompted).
2. Enter your **email** and choose a **password**. This is *your* login for the shop —
   it's stored in your own Supabase account from Step 1.
3. Confirm the email: open your inbox and tap the link Supabase sent — the
   app then shows the **Sign in** button. Keep Supabase's **Confirm email**
   setting **ON** (Authentication → Providers → Email in the dashboard): it's
   safe, it's on by default, and it verifies the account is really yours.
   If the email already has an account, the app says so and offers **Sign in**
   instead.

That's it — **your shop is now connected**.

### Step 6 — Turn sync ON
1. In **Cloud sync**, flip the **Sync** switch to **On**.
2. Your sales, stock, products, categories and refunds now back up to your
   Supabase project, and any queued offline activity uploads automatically.
3. You'll see **"Last synced: just now"** (or a similar line) under the switch.

You can flip this switch **On/Off anytime**. Turning it **Off** stops syncing but **never
deletes anything** — your sales keep being saved on the device, and they upload the next
time you turn it back on.

### Common setup problems

| What you see | What it means / what to do |
|---|---|
| **"Backend unreachable: HTTP 401"** at Check connection | The **`anon public` key is wrong or missing**. Hosted Supabase requires an API key on every request, so a 401 almost always means the key pasted isn't the right one. Go back to Project settings → API, re-copy the key labelled **`anon public`** (it starts with `eyJ`), and try again. (Very old app builds had a bug that showed this even with the right key — it was fixed in 1.0.1.) |
| **"Backend unreachable" (a network message)** | The phone can't reach the URL. Check the device has internet, and re-check the **Project URL** character by character — it must start with `https://`. Also: free projects sleep after ~1 week idle — open the project once in the Supabase dashboard to wake it, then retry. |
| **"Schema still not detected"** | The SQL didn't finish in the SQL Editor. Re-run the bundle, make sure it reports success (no red errors), then tap **I've run it — check setup** again. |
| **"Still on schema vN — the script below adds vM"** | Your project was set up by an older app version. Run the updated script shown (safe to re-run — it never touches existing data), then check again. |
| **"This email already has an account — sign in instead"** | The owner account for this email exists already (maybe on another device). Tap **Sign in** and use that email + password. |
| Claim step fails after running the SQL | The script wasn't run for *this* attempt — each attempt gets its own one-time claim line. Tap **Check connection** again, copy the fresh script, run it in the SQL Editor, then finish. |

### Reading the sync banner (Sell tab)
- **"Syncing…"** — working right now.
- **"N ops queued — syncing automatically"** — N things are waiting (normal right after offline sales).
- **"Synced 9:03 AM"** — up to date.
- **"N ops queued · Sync off"** — queued but the switch is off.
- **"Sync error: …"** — something's wrong (the banner says why; see Troubleshooting).

---

## Adding more devices (a second tablet or phone)
Each device signs in with its **own** account and **joins** the owner's store with an
invite code — so one person logging out never signs anyone else out.

1. **Owner:** on the first device, open **Settings → Cloud sync → Invite a
   device** (PIN-gated). NurLedger shows an invite code — it is **valid for 24
   hours and works once**. Only the **store owner** can create invite codes —
   a device that joined as a member can't.
2. **Second device:** install NurLedger, then **Settings → Cloud sync →
   Connect your backend**.
3. Paste the **same two** project details (Project URL + anon key) from Step 3.
4. Choose **Join with invite code** and enter the code the owner shared.
5. Create a login with **your own email + password** (each device has its own account).
6. Turn **Sync** **On**.

Both devices now share the same shop: sell on one, and after it syncs, the other sees the
updated stock, products, categories and sales. If two tablets sell the same item offline and both sync, NurLedger combines
them correctly — **no sale is counted twice**, and stock stays accurate. A refund made on
one device appears on the other after it syncs.

## Adding cashiers and managing PINs
Staff **don't need a Supabase account.** You (the owner) manage them on the **Shift** tab:
1. Tap **Switch** (or **Add user**) next to the name at the top of the Shift tab.
2. **Add user**: give the person a **name**, a **role** (Cashier, Manager or Owner) and, for Manager and Owner, a **PIN** of 4–8 digits (optional for cashiers).
3. To take the register, tap **Switch** and pick the person.

**Who needs a PIN for what**
- Switching to a **Manager** or **Owner**, or **adding** a Manager or Owner, asks for an owner/manager PIN of at least that level. A cashier cannot make themselves an owner. (An owner can switch to anyone and add anyone without being asked.)
- **Change PIN…** (in the Switch list) asks for an owner/manager PIN every time, then lets you set a new 4–8 digit PIN for the person you pick. Only an owner PIN can change the owner's PIN.
- Discounts, price overrides, refunds, stocktakes, closing a shift and settings ask for the manager/owner PIN when a cashier is at the register.

**If the owner PIN is lost:** the Store PIN can be reset with its **one-time
recovery code** — tap **Forgot the Store PIN?** (lock screen or Settings →
Security) and enter the code shown when the PIN was set. That code lives on
the device only; **NurLogic cannot recover a PIN** (PINs are salted hashes
that never leave the device or go to Supabase). If the recovery code is also
lost, the remaining option is **Settings → Reset all data** on this device
(this erases local data, so sync to the cloud first if you can, then sign in
again afterwards). A fresh install starts with a default Owner PIN, so change
it right away in **Change PIN…**.

The PIN is a **local safeguard against mistakes and casual misuse**, not a vault: someone with the unlocked phone and technical skills can get around it. Keep the phone itself secure.

There is no "deactivate user" action yet. To stop someone using the register, ask them to hand back the device and change the PIN of any manager/owner account they know.

---

## The register lock and forgotten PINs

The register **locks itself when nobody is using it** — so someone who walks
up to the counter can't see the day's totals or sell things.

- **Auto-lock** — **Settings → Security → Auto-lock register**: **Never, 1,
  5, 15 or 30 minutes** of inactivity (default 5). Any tap on the screen
  resets the timer, so an active cashier is never locked mid-sale.
- **When it locks** — a full-screen "Register locked" screen appears. Nothing
  behind it is visible or tappable, and the phone's back button doesn't open
  it.
- **Unlocking** — enter **any** PIN (the screen says so: "Any PIN is proof of
  identity — yours, a coworker's, or the Store PIN."):
  - the **locked user's own PIN** — they continue right where they left off;
  - **another user's PIN** — the register switches to that person (recorded in
    the audit log);
  - the **Store PIN** — the register runs as the **Owner**.
- **No PINs at all?** If nobody in the shop has a PIN set, the register never
  locks (open access) — single-operator shops are unaffected.

**If the Store PIN is forgotten** — on the lock screen (or in **Settings →
Security**) tap **Forgot the Store PIN?** and enter the **one-time recovery
code**. That code was shown **once** when the Store PIN was first set, with
Copy / Print / Email-me options — the app says "Store this offline. It can
reset the Store PIN once, on this device only. It is shown now and never
again." After the code you set a new PIN and get a **fresh** recovery code
(shown once, again). The code lives on the device only — **NurLogic cannot
recover a Store PIN**.

**The audit log** — every lock, unlock, user switch, shift open/close and
privileged action is written to an **append-only, tamper-evident log** (the
same discipline as the stock ledger — rows can never be edited or deleted).
Its integrity is checked automatically at every Z-report close and on demand
(**Settings → Security → Verify audit log** → "Audit log verified — n rows
checked"), and the Z-report's printed / exported copy carries the chain
status — so you can prove the log was never altered.

---

## Turning it all off / leaving
- **Pause:** flip **Sync** to **Off** — nothing uploads, everything stays on the device.
- **Disconnect:** **Settings → Cloud sync → Disconnect** removes the connection. Your
  device data is untouched.
- **Delete your cloud account (in the app):** **Settings → Cloud sync → Delete cloud account…**
  (PIN-gated, you type DELETE to confirm).
  - As a **member** (a phone that joined with an invite code) it deletes only *your own*
    sign-in; the store's data stays with the owner.
  - As the **store owner** it permanently erases **all of the store's data in your cloud**
    (sales, stock, products, categories, invites), removes access for every connected phone,
    and deletes your sign-in. Other phones' sign-ins are not deleted (they simply lose access
    and can delete their own account the same way).
  - The data **on your phone is kept** — this just disconnects it. To wipe the phone too, use
    **Reset all data** afterwards.
  - Needs the latest cloud setup script (currently schema v8): if the app says
    your project "runs schema vN, but this app needs vM", Disconnect → Connect,
    run the updated script in the Supabase SQL Editor, then try again.
- **Delete everything yourself:** you can also delete the whole Supabase project from the
  Supabase dashboard. NurLedger (the app) never has a copy of your data.

## Is my data private?
Yes. Everything is stored on your device first. Cloud sync is optional: when you turn it
on, your data lives in **your own Supabase project**, under **your own account** — the
app sends it only to that project, over HTTPS. The NurLedger app is just a client that
talks to your project. The people who build NurLedger do not have access to your data.
You can verify any time by logging into <https://supabase.com> and opening your project.

NurLedger has **no ads, no analytics and no tracking**, and NurLogic does not collect
your business data. Payments are **recorded, not processed**: the app notes how a
customer paid (cash, card, e-wallet, QR) but does not process or move money. And
NurLedger is **not a registered receipting or e-invoicing system** (for example, it is
not BIR-registered in the Philippines) — it applies your tax settings and shows a
receipt you can share; check your local requirements with your accountant or tax
authority.

Need help? See the [NurLedger support page](https://nurlogic.ai/support) or email
<hello@nurlogic.ai> (we aim to reply within 3 working days).

## Troubleshooting
| Problem | What to do |
|---|---|
| "Backend unreachable: HTTP 401" when connecting | The **`anon public` key is wrong or missing** — hosted Supabase requires a key on every request. Re-copy the key labelled `anon public` (starts with `eyJ`) from Project settings → API and try again. |
| "Backend unreachable" (network message) when connecting | Re-check the **Project URL** (must start with `https://` and look like `https://abcdefg.supabase.co`) and that the phone has internet. Free projects **sleep after ~1 week idle** — open the project once in the dashboard to wake it, then retry. |
| Nothing is syncing after turning it On | Wait a moment, then pull to refresh / reopen Settings. Check the device has internet. The "N ops queued" line shows what's waiting. |
| "Sync error: …" mentions a missing table | A newer app version needs the updated setup script: in Settings → Cloud sync, tap **Disconnect** (your data on the device is untouched), then **Connect your backend** again — the app detects the older setup and shows the updated script. Run it in Supabase's SQL Editor (safe to re-run — it never touches existing data) and finish the reconnection. |
| I pasted the wrong anon key | Disconnect, then Connect again with the correct details. (The setup is repeatable — it won't duplicate your data.) |
| "Invalid claim code" at the last step | The setup script wasn't run for THIS attempt. Tap **Check connection** again — the app shows the script once more — paste and run it in the SQL Editor, then finish. |
| Adding a second phone | On the first phone: Settings → Cloud sync → **Invite a device** (PIN-gated). It shows a one-time code, valid 24 hours. On the second phone: Connect → **Join with invite code**, paste the URL + anon key, enter the code, and create that phone's OWN account. The owner's password is never shared. |
| I was signed out of cloud sync after an update | The sign-in session now lives in the phone's secure keystore. If the keystore is wiped (phone restore, reinstall) the session is gone: go to Settings → Cloud sync and sign in again (Connect → "sign in instead"). Your data on the phone is untouched. |
| A red banner says "N record(s) rejected by your server" | Your cloud server refused those records (usually after an app update that needs the newer setup script, or a mismatch in the server data). Nothing is lost: the records are still on the phone and everything behind them keeps syncing. Open Settings → Cloud sync → **Rejected uploads** to see the reason. Fix the cause (for example Disconnect → Connect to re-run the latest setup script), then tap **Retry rejected**. **Discard…** stops trying for good — those records then never reach your other phones or the cloud (they stay on this phone). |
| Free project paused (after ~1 week idle) | Open your project in the Supabase dashboard once; it wakes up and sync resumes. |
| Camera scanner says camera access is needed | The phone hasn't granted camera permission. Allow it in the phone's Settings → Apps → NurLedger → Camera, then open the scanner again. You can keep denying it — physical scanners and typed barcodes still work. |
| "Schema still not detected" / "Still on schema vN" after running the SQL | Make sure the SQL Editor query **finished without errors** (a red error means it stopped early), then check again in the app. |
| A weighed item shows the wrong weight | Re-check the scale's barcode format matches your locale's scale (Settings → the store's locale drives the barcode parser). You can always edit the weight before adding it to the order. |
| Printed labels don't scan | Make sure you printed at 100% scale (no "fit to page"). Regenerate and print again; the barcodes are standard UPC-A/Code 39 and scan with any scanner. |
| The register is locked and I don't know anyone's PIN | Unlocking works with **any** PIN — the locked user's, a coworker's, or the **Store PIN**. If the Store PIN is forgotten too, tap **Forgot the Store PIN?** and enter the **one-time recovery code** from when it was set. If the code is also lost, **Settings → Reset all data** is the only way (sync to the cloud first if you can). |

## FAQ

### Does NurLedger work without internet?
Yes. The whole register — selling, stock, refunds and shifts — runs on your device. You
can run a full day with no internet at all; anything queued goes to the cloud later, when
sync is on and the device is back online.

### What happens if two tablets sell the same item offline?
NurLedger combines them correctly when both sync: **no sale is counted twice**, and stock
stays accurate.

### Can I use a barcode scanner?
Yes — three ways. Any USB or Bluetooth *keyboard-wedge* scanner works (it types
into the scan field like a keyboard). Or tap the **camera icon** on the Sell tab
(or on the product barcode / carton barcode fields when adding a product) and
scan with the phone's camera. Or type the code by hand.

### Do I need a receipt printer?
No. The receipt appears on screen, and receipts, labels and purchase orders can be
generated as files you can print on any device, any printer. X/Z reports can be
printed or saved as PDF. You can also **email the receipt to the customer**
(Settings → Receipt → Ask to email the receipt) or **share it as a PDF**
(the **Share** button on the Payment Successful screen — WhatsApp, Telegram,
Messages, or save it to print later). (Connecting a physical printer
directly is on the roadmap.)

### How do refunds work?
Open **Insights → History**, tap the sale, and tap **Refund** to refund the whole
sale or individual lines. Returned items are restocked (per line), you record a
reason, and cashiers are asked for the manager/owner PIN.

### Who needs a PIN?
You (the owner) hold the **Store PIN** — the shop's master PIN — and you can
give managers, and if you want **cashiers**, their own 4–8 digit PINs. When a
cashier is at the register, the manager/owner PIN gates discounts, price
overrides, refunds, stocktakes, closing shifts and settings. PINs also unlock
the register after it auto-locks (see *The register lock and forgotten PINs*).

### What happens when the register locks itself?
A full-screen lock screen covers the app until someone enters a PIN — the
locked user's own (they resume), a coworker's (the register transfers to
them), or the Store PIN (the register runs as Owner). The timeout is set in
**Settings → Security** (Never / 1 / 5 / 15 / 30 minutes; default 5). If
nobody in the shop has a PIN set, the register never locks.

### I forgot my PIN — can NurLogic reset it?
No — PINs never leave the device. For the **Store PIN**, tap **Forgot the
Store PIN?** (lock screen or Settings → Security) and enter the **one-time
recovery code** shown when it was set. For a **cashier's or manager's PIN**,
an owner/manager resets it in **Settings → Security → Reset a PIN**. If the
recovery code is also lost, **Settings → Reset all data** starts over (sync to
the cloud first if you can, then rejoin afterwards).

### Which currencies and taxes can I use?
Any ISO currency. For tax, pick a regime (for example Singapore GST 9% inclusive,
Malaysia SST 10% inclusive, EU VAT 21% exclusive) or set a **custom rate** (0–40%,
inclusive or exclusive). Nothing is hardcoded to a country — the same app works anywhere.

### Is NurLedger a BIR-registered or legal e-invoicing system?
No — it is not a registered receipting or e-invoicing system. It applies your tax
settings and shows a receipt you can share. Check your local requirements with your
accountant or tax authority.

### Which languages does it support?
**English**, **Bahasa Melayu** and **Filipino** — change it in Settings and the whole app
updates immediately. It is a per-device choice, so each staff tablet can be in a
different language.

### Does it have a dark mode?
Yes. **Settings → Theme**: **Light**, **Dark** or **System** (follows the phone).
Per-device, and it never changes your data.

### What if my tablet breaks, is lost, or I need a new one?
If cloud sync is on, your data is backed up in your own Supabase project. On the new
device, join the store again with an invite code and it downloads your latest products,
stock and sales.

### My free Supabase project stopped syncing — is it broken?
Probably not. Free Supabase projects **sleep after about a week of inactivity** —
open the project once in the Supabase dashboard to wake it (a few minutes) and sync
resumes. Nothing is deleted while it sleeps.

### How do I back up my data?
Cloud sync keeps a backup in your own Supabase project (see *Setting up cloud sync*
above). You can also export your whole product list as a CSV at any time.

### Does NurLogic see or collect my sales data?
No. Everything is stored on your device first; optional cloud sync goes only to your own
Supabase project. There are no ads, no analytics and no tracking — see *Is my data
private?* above.
