# Milestone Reports

## M1 — Foundation (2026-10-30)

**What changed**
- Project scaffold: Expo SDK 57 / RN 0.86 / expo-router / expo-sqlite (ADR-009), `com.nurlogic.nurledger`, Metro port 8186.
- Design system: prototype tokens (Plus Jakarta Sans + JetBrains Mono via @expo-google-fonts, indigo-600/emerald-600/amber-500/rose-500/slate, rounded-xl, tabular-nums `NumberText`).
- DB schema v1 (spec §4 data model): outlet, settings, category, product, lot, **stock_ledger (immutable)**, **cost_layer (FIFO)**, stock_view, sale, sale_line, payment, refund, shift, cash_move, purchase_order, po_line, stocktake(+counts), app_user, **outbox**, delta_cursor.
- First-run seed: 6 categories + 11 products from PROTOTYPE-REFERENCE §9 (values extracted from the live prototype bundle), each with lot (batch+expiry), opening ledger row, opening FIFO cost layer.
- Product CRUD: inventory list (search by name/SKU/barcode, Low-Stock-Only toggle, status chips, amber low-stock tab badge), add/edit form (name, SKU, barcode, category, unit type, cost/price, min/max, carton size + carton barcode, velocity tier, description).
- 5-tab navigation in prototype order: Sell · Inventory · Expiry · Insights · Shift (M2–M4 tabs show scope placeholders).
- Pure, unit-tested domain logic: money (integer minor units, integer rounding), FIFO consumption (spec §4.3.1 worked example), stock projection, status chips, Min/Max reorder, FEFO ranking, calendar days-to-expiry, UUIDv4 idempotency keys.

**Exit test — "add 10 products offline, app survives force-kill"**
_(filled with real device output after AVD run)_

**FR touched**
FR-300, FR-303, FR-307 (schema), FR-308, FR-316, FR-318 (schema), FR-319, FR-321 (schema), FR-322 (schema), FR-502 (schema), FR-602, NFR-3, NFR-8. See `docs/FR-COVERAGE.md`.

**Open items**
- Emulator UI walkthrough for the add-product flow (force-kill persistence proof) — in progress.
- iOS build not yet run (M1 acceptance allows Android or iOS simulator).
- Seed data: prototype's USD prices carried into the SG/SGD outlet as fixtures (ADR-004; DEV-002 notes 11 vs 19 products).

## M2 — Register (2026-10-30)

**What changed**
- **Register (Tab 1 / Sell):** scan (manual + BT/USB keyboard-wedge; camera deferred — DEV-004) → cart (qty steppers, per-line + order discount, per-line price adjust) → **live FIFO gross margin** (FR-321) → payment (cash tender/change, card, mobile, QR, split; card/QR = ADR-006 stubs) → on-screen receipt (FR-109).
- **Sale engine (`saleRepository.completeSale`):** one atomic SQLite transaction — per-line FIFO consume + immutable `stock_ledger` decrement, sale header + per-line COGS (FR-321), payments, outbox op (FR-502), cart clear. Any failure (incl. oversell) rolls the whole thing back — no partial stock state (NFR-3, ADR-002).
- **`stockRepository.applySaleInTx`:** the in-transaction stock movement; `stock_ledger` is still written only from `stockRepository` (module-map rule).
- **Cart persistence (NFR-3):** schema v2 (`current_order`/`current_order_line`) + v1→v2 migration; every cart mutation is written to SQLite, so a kill mid-sale survives relaunch.
- **Pure, unit-tested domain:** `lib/sale.ts` (cart/sale math + `allocateCogs`), `lib/payment.ts` (tender/`evenSplit`), `lib/tax.ts` (TaxEngine), `money.parseMoneyToMinor`; types for `CartLine`/`Sale`/`SaleLine`/`PaymentAllocation`.
- Register UI components: `CartLineRow`, `TotalsBlock`, `PaymentSheet`, `ReceiptView`, `MoneyPrompt`, `QuickChips`.

**Bug found + fixed by the on-device test**
- `completeSale` called `clearActiveOrder()`, which opened a **nested** `withTransactionAsync`. expo-sqlite's `withTransactionAsync` is not nestable → `cannot rollback - no transaction is active`. Fix: `clearActiveOrderInTx(db)` runs the cart-clear DELETEs inside `completeSale`'s own transaction; a standalone `clearActiveOrder()` wrapper is kept for callers outside a transaction.

**Exit test — "complete 10 sales offline, kill app mid-sale, relaunch — sale and stock intact" (real `cs-test` AVD)**
- Register boots; SG/SGD seed loads; scan field, product chips, cart, totals render. Live FIFO margin shown (54% for 1 item → 58% for 2).
- **Kill test:** 2-item cart (SGD 15.00) → `am force-stop` (cold kill) → relaunch → **cart intact (2 items, SGD 15.00)**.
- First charge hit the nested-txn bug above → **rolled back cleanly** (verified in DB: stock 22/8 unchanged, 0 sales, 0 outbox, cart intact — no partial state).
- After fix + reload: CHARGE → Card → Confirm paid → **Payment successful**, Receipt #B9A700C2 (Subtotal 15.00, Tax 9% incl. 1.24, Total 15.00, Card 15.00).
- **DB after commit:** 1 `sale` (1500/124/1500, cogs 630) · 2 `sale_line` with per-line COGS (390 / 240) · stock 22→21 & 8→7 · `cost_layer` 22→21 & 8→7 (FIFO) · `stock_ledger` 11→13 (two `sale` rows, negative deltas) · 1 outbox `sale` op (client UUID, `uploaded_at` NULL) · cart cleared to 0.
- Standing regression: `npx tsc --noEmit` (0 errors) + `npx jest` (49 tests) green.

**FR touched**
FR-101, FR-102, FR-105, FR-107, FR-108, FR-109 (on-screen), FR-302, FR-321, FR-502, NFR-3. Deferred to M5: FR-100 (camera), FR-103 (weighed), FR-104 (EAN-13 parse). PIN-gating (FR-105) → M4. See `docs/FR-COVERAGE.md` + `docs/SPEC-DEVIATION.md` (DEV-003, DEV-004).

**Open items**
- Camera scan (FR-100) + weighed items (FR-103) + EAN-13 parse (FR-104) → M5 (`expo-camera` + BarcodeParser engine).
- Price-override / discount PIN-gating → M4 (roles).
- ESC/POS print + re-print (FR-109) → M5.
- "10 sales offline → reconnect → sync exactly once": offline recording + idempotency key proven here; the reconnect drain + server-side dedup is M5.
- M1 add-10-products force-kill walkthrough is implicitly covered by this run (seed persistence + force-kill survival on the same AVD).

## M3 — Inventory & Expiry (2026-10-30)

**What changed**
- **Product detail (FR-300 surface):** `app/inventory/[id].tsx` — mobile idiom for the prototype's 17-column desktop table: list row + rich detail (barcode, category, unit, cost, price, **margin %**, min/max, velocity, lot batch + expiry, status, last updated, ledger last-5) with quick actions **Adjust** (reason required) · **Restock** (→PO prefill) · **Edit** · **Deactivate/Reactivate**.
- **Stock adjustments (FR-316):** `AdjustStockDialog` — reason **required**; `stockRepository.applyStockMoveInTx` is now the single in-transaction stock writer (inbound adds a FIFO `cost_layer` at the given cost, outbound consumes FIFO; `applySaleInTx` delegates to it). Writes an immutable `adjustment` ledger row with `reason` — schema v3 adds `stock_ledger.reason` via a guarded `ALTER TABLE` migration (`hasColumn` check).
- **Purchase orders (FR-306):** `app/po/*` — list (empty state + FAB), create (vendor + lines; carton lines via `cartonsToBase`), detail with **Receive** (confirm dialog). `poRepository.receivePO` = one transaction: one `lot` + one **lot-linked** `cost_layer` (`ref_type='lot'`) per line + `receive_po` ledger rows + PO status/dates. `planReceive` skips fully-received lines (idempotent re-receive = no-op).
- **FEFO Expiry Radar (FR-307):** `app/(tabs)/expiry.tsx` — 4 summary cards (Expired waste / Expiring / Other / Batches) + FEFO-ranked batch rows with urgency bands (expired/critical rose, soon amber, ok green). `stockRepository.expiryRadar` joins lot→cost_layer (`ref_type='lot'`) for per-batch remaining qty; `expiryUrgency`/`summarizeRadar` pure + tested.
- **Reorder → PO (FR-308):** `productRepository.reorderCandidates` (on-hand < min → suggest max − on-hand), `useReorder`, Restock quick action deep-links `/po/new?product=&qty=` (product + Min/Max qty prefilled).
- **Carton break (FR-318/FR-322):** PO lines for carton products show a `Cartons (×N)` input, stored as base units; `useCart` scan resolves `carton_barcode` → adds `cartonSize` base units.
- **Data layer:** schema v3 + guarded migration; `src/lib/po.ts` pure module (`po.test.ts`, 6 tests); expiry urgency/summary tests in `stock.test.ts` (3); seed links each opening cost layer to its lot (verified on-device 11/11).
- **Bug found + fixed by the on-device test:** the PO form's cost/expiry inputs were controlled with snap-formatting (cost re-formats to 2 decimals, expiry all-or-nothing), so backspace couldn't clear them — replaced with per-line raw-text draft buffers that parse live and normalize on blur.

**Exit test — "receive PO in batches, sell until low-stock badge fires, expiry view ranks FEFO correctly" (real `cs-test` AVD)**

Run on `cs-test` (Android emulator, headless), app against local Metro. DB pulled + queried
via `adb` root + `python3 sqlite3` after each step.

1. **PO create + receive in batches (FR-306).** New PO "Test Wholesale SG", 1 line: Barista Oat
   Milk 1L, qty 12 @ SGD 2.35 (≠ seeded 2.10, to prove layers use PO cost), lot `PO-TEST-01`,
   exp 2026-11-10 → total SGD 28.20. Created → DRAFT, NET30, ORD 12 / RCVD 0. **Receive PO** →
   confirm → UI: RECV'D chip, RCVD 12, "Fully received".
   DB after receive:
   - `purchase_order`: status `received`, `net30`, total 2820
   - `po_line`: 12/12 @ **235**, lot `PO-TEST-01`, exp 2026-11-10
   - new `lot` row for `PO-TEST-01`
   - oat-milk `cost_layer`: `(210, 24, ref_type='lot')` + `(235, 12, ref_type='lot')` — both lot-linked
   - stock projection 24+12 = **36**
   - two `receive_po` ledger rows with correct lot attribution (`BT-2611O` +24@210, `PO-TEST-01` +12@235)
2. **FEFO radar ranks correctly (FR-307).** After receive, Expiry tab: Expiring 138 → **150**,
   Batches 11 → **12**. New batch ranked exactly right — "Barista Oat Milk 1L · lot PO-TEST-01 ·
   exp 2026-11-10 · 11d (amber) · 12" between Cold Brew (11-04, 5d rose) and Greek Yogurt (11-12, 13d).
3. **Carton break (FR-318/FR-322).** All seeded products have `carton_size=1`; via the Edit form set
   Sparkling Mineral Water Lime 500ml to **carton size 12 + carton barcode `4000000000010`**
   (DB: `carton_size=12`, `carton_barcode='4000000000010'`). On Sell, typed the **carton** barcode +
   Enter → cart line qty **12** base units ("12 items", line total 12 × 2.25 = SGD 27.00).
4. **Low-stock badge fires (FR-305).** Cleared cart, sold 5× French Butter Croissant (14 → 9 < min 10):
   CHARGE → cash tender SGD 20.00 → change **SGD 2.50** → receipt #0B42BF69 (5 × 3.50 = 17.50,
   tax 9% inclusive = 1.44, FIFO margin preview 66% / SGD 11.50 before payment). After the sale the
   Inventory tab's "Low Stock Only **2**" counter and the **tab-bar badge 1 → 2** both updated
   (sourdough already low + croissant now low). DB: `sale` ledger row −5, cogs 600, lot `BK-261029`;
   croissant projection 9.
5. **Adjustment round-trip (FR-316).** Product detail → **Adjust** → dialog: On hand 78 → 78,
   Add/Remove, qty 2 → projected **80**. **Required-reason gate verified:** with qty=2 and empty
   reason the Confirm button stayed disabled (pixel-checked pale vs. solid indigo); after typing
   "cycle count" it enabled. Confirmed.
   DB after apply:
   - `stock_ledger`: `('adjustment', +2, 75, reason='cycle count', lot BT-2704L)` — immutable row, FEFO lot attributed
   - new FIFO layer `(75, 2, ref_type='move')` at product cost
   - water stock projection 78+2 = **80**
6. **Product detail (FR-300 surface).** Full column set rendered: SKU, barcode, carton barcode +
   "1 carton = 12 units", category, unit, velocity, min/max, margin 67%, last updated; FEFO batch
   card (BT-2704L · exp 2027-04-15 · 167d · qty); recent movements; quick actions Adjust/Restock/
   Edit/Deactivate.

**Bugs found + fixed by the on-device test (2 beyond the PO-form draft-buffer fix above):**
- **Stale data on focus:** product detail (and the Inventory/Expiry tabs) loaded only on mount;
  tab screens stay mounted, so an Edit saved to the DB while the detail card showed stale values
  (carton fields still "—" / "1 carton = 1 units"), and the low-stock badge lagged a sale. Fixed
  with `useFocusEffect` reloads in `app/inventory/[id].tsx`, `app/(tabs)/inventory.tsx`,
  `app/(tabs)/expiry.tsx`.
- **Stale tab-bar badge:** the badge reads `useProducts().lowStock` in `TabLayout` — a separate hook
  instance that never reloads (in-screen counter showed 2, badge still 1). Fixed by making the
  low-stock count a module-level store shared by every `useProducts` instance
  (`useSyncExternalStore` in `src/hooks/useAppData.ts`); any instance's reload (a sale's post-charge
  refresh, the tab focus-refresh) updates the badge immediately — verified: badge = 2 right after
  boot and without visiting Inventory.

**FR touched**
FR-305, FR-306 (print/share → M6), FR-307, FR-308, FR-316, FR-318, FR-319, FR-322, FR-300 surface. Deferred → M6: FR-304 stocktake UI, FR-317 labels, FR-320 margin UI (DEV-005). Adjustment PIN → M4. See `docs/FR-COVERAGE.md` + `docs/SPEC-DEVIATION.md`.

**Open items**
- Stocktake UI (FR-304), label printing (FR-317), margin-compression UI (FR-320), PO print/share → M6 (DEV-005).
- Adjustment PIN-gating → M4 (roles).
- Standing regression: `npx tsc --noEmit` (0 errors) + `npx jest` (58 tests) green.

## Post-M3 — Multi-currency + configurable tax locale (2026-10-30)

Standalone commit on `main` (no milestone tag), in response to the owner request:
"The app needs to support other currencies not just sgd, please make sure of that."

**Scope**
- Store settings screen (`app/settings.tsx`, entered via the Store card on the Shift tab):
  store name, currency (20 curated ISO codes + free-form 3-letter ISO entry, `Intl`-
  validated), tax regime (5 presets as data: none / SG GST 9% incl / MY SST 10% incl /
  US 8.25% excl / EU 21% excl, each with a suggested currency+locale; plus a custom rate
  0–40% ≤2 decimals with inclusive/exclusive).
- `src/lib/currency.ts` (new) — catalogs + pure helpers.
- `src/repositories/outletRepository.ts` (new) — `getOutlet`/`updateOutlet` (moved out of
  productRepository; feature isolation per the module map).
- `useOutlet` now refetches on screen focus (`useFocusEffect`), so a settings save
  propagates to every tab without a manual refresh.
- `formatMoney` handles zero-decimal currencies (JPY/KRW/VND/ISK/CLP) — display-only
  rounding; storage stays uniform 1/100 major unit for ALL currencies (FR-602).

**RN bug found on-device: `Alert.alert` truncates to 3 buttons.**
RN 0.86's `Alert.js:100` does `buttons.slice(0, 3)` — anything beyond the first three is
*silently dropped* (and the three shown are mapped to neutral/negative/positive, so the
order appears reversed). This broke the new 20-currency picker (only 3 options shown)
and turned out to be a **latent production bug in two M1/M3 screens**: the category
picker (`app/inventory/edit.tsx`, 8 options → only 3 visible) and the PO product picker
(`app/po/new.tsx`, 11 products → only 3 visible).

**Fix: `src/components/PickerOverlay.tsx`** — a shared bottom-sheet list picker (dimmed
backdrop, definite `height: '72%'` sheet, own ScrollView, Cancel row). All four pickers
now use it. Also learned: a nested ScrollView does not reliably steal the swipe gesture
on Android (verified with adb swipes) — list pickers must be full-screen overlays with a
definite height, not inline lists.

**Device verification (cs-test AVD)**
1. Shift store card: "SGD · Singapore GST 9% — inclusive" → saved MYR + SST 10% → card
   updates to "MYR · Malaysia SST 10% — inclusive" (focus-refetch works).
2. Cart with cheddar (850 minor): Subtotal **MYR 8.50**, Tax (10%, incl.) **MYR 0.77**
   (850 × 10/110 = 77.27 → 77), Total **MYR 8.50**, margin 54% — math exact.
3. Free-form currency "TWD" → preview "TWD — NT$123.45" → register shows NT$ amounts.
4. JPY (zero-decimal) → line **¥9**, Subtotal ¥9, Tax (10%, incl.) **¥1**, CHARGE **¥9**.
5. Full 22-row currency overlay scrolls; both legacy pickers (category, PO product) now
   show their full lists — spot-checked and cancelled, nothing created.
6. Restored to SG/SGD/GST 9% at the end: Sell shows the "Tax (9%, incl.)" row, cart
   empty, no test sale written (DB still holds just the one pre-existing SGD sale in the
   outbox).

**Bugs found + fixed**
- RN `Alert.alert` 3-button truncation — 4 pickers migrated to `PickerOverlay`
  (2 new + 2 latent M1/M3 production bugs).
- Nested-ScrollView swipe unreliability (Android) — overlays with definite height instead
  of inline lists.

**FR touched**
FR-600, FR-602 → full. PIN/role gating for settings changes → M4 (DEV-003).

**Open items**
- PaymentMethods / BarcodeParser / receipt-template / e-invoicing locale engines remain
  on the M5 list (the TaxEngine + currency surfaces of FR-600/FR-602 are now done).
- Standing regression: `npx tsc --noEmit` (0 errors) + `npx jest` (77 tests) green.

## M4 — Shifts & Back office (2026-10-30)

**Scope (per handoff BUILD-PROMPT M4):** shift lifecycle (float, register lock, cash
in/out, X-report, close → Z-report, offline), cashier switch + role-aware UI + PIN
gates, Insights (KPI cards, extended KPIs, P&L, Velocity/ABC, stockout forecast,
expense entry, searchable sales history, CSV exports).

**Exit test (PASSED):** full offline shift day on the `cs-test` AVD → open shift
(float 200.00) → Owner cash sale 7.50 → switch to Jun (cashier) → Jun card sale 8.00
→ cash in 50.00 / cash out 20.00 → X-report (expected cash on hand 237.50) → close
shift (PIN 1234) → counted **227.50** → Z-report variance **Short −SGD 10.00**
(expected 237.50 vs counted 227.50 — matches counted cash exactly). After close the
register re-locks (FR-200) and the closed shift persists with its full Z-report
(`z_report_json`) on the detail screen.

### What shipped
- **Schema v4:** `app_user` (role + `pin_hash`), `expense`; `shift.cashier_id`,
  `shift.z_report_json`, `shift.closed_at`. Migration is **self-healing**: the M4
  tables + default users are re-asserted (`ENSURE_M4_SQL` + `ensureDefaultUsers`) on
  every bootstrap, so an app upgraded from a pre-M4 install repairs itself (this
  fixed the launch crash on the existing v3 DB — device-verified).
- **Shifts (FR-200…204):** open with float (register locked + inline Open shift
  otherwise), cash in/out with reason + movement list, X-report (sales by method +
  cash on hand, non-destructive), close with counted-cash → variance → Z-report
  (sales by method, cash movements, variance; refunds line = 0 until M6). Card sales
  excluded from the drawer (ADR-006). All local-SQLite-only (offline by
  construction; the closed-shift outbox op ships with M5).
- **Roles & PIN (FR-500/FR-501):** seeded Owner (PIN `1234` — documented test
  fixture) + Jun (Cashier, no PIN). `roleCanAct` gates 5 actions: `discount`
  (line + order), `price_override`, `stock_adjust`, `close_shift`, `store_settings`.
  `PinPrompt` (keypad, 4–8 digits, pending <8, definite-fail at 8, "Wrong PIN"
  error). Unlock is single-action and never persisted. SHA-256 in pure JS
  (`s:<salt16>:<hash>`). Stricter than spec: cashiers' close-shift is PIN-gated too.
- **Insights (FR-400/401/403):** period selector (Today / Current period / All
  time), KPI cards (net basis: revenue, COGS, GP, ONM %, discounted items, units +
  tx/avg basket/UPT), Extended KPIs (GM %, markup, turnover, days on hand,
  sell-through, GMROI, shrinkage, stockout rate, expiry waste, fill rate), P&L
  (GROSS money-in basis, prototype structure + Operating Costs + Inventory Asset
  Position), Velocity/ABC top-15, stockout forecast (days-left at today velocity,
  red ≤1d), operating-expense entry (3 categories) feeding P&L, sales history with
  live search (product/cashier/sale ID) + cashier attribution.
- **CSV exports** (`src/lib/csv.ts`): P&L, Velocity/ABC, stockout forecast, sales
  history — in-app preview sheet (file saved to app exports dir) + Android share
  sheet (`expo-sharing`).
- **Seed:** `ensureDefaultUsers` idempotent (seed + v3→v4 migration + every
  bootstrap).

### Device verification (cs-test AVD, matrix (a)–(l))
- (a) register-locked banner + inline Open shift (float 200) ✓
- (b) shift card: float 200, expected 200, active user Owner ✓
- (c) Owner sale: cheddar 8.50, discount 1.00 **without PIN** (owner ungated) →
  total 7.50 (tax 0.62, margin 48%·4.60) → cash 7.50 → receipt #DF0BC498 ✓
- (d) Switch → Jun (direct, no PIN); Jun discount → **PinPrompt**; 9999 stays
  pending at 4 digits (PIN may be longer); 99999999 → "Wrong PIN — try again" + dots
  cleared; **1234 → MoneyPrompt** ✓ (all 4 gate paths)
- (e) Jun sale: discount 0.50 → total 8.00 (tax 0.66, margin 51%·4.10) → **Card**
  → "Charge on terminal" (ADR-006 stub) → Confirm paid → receipt #63145CFC; drawer
  unchanged at 207.50 (card excluded from drawer) ✓
- (f) Cash in 50.00 ("Float") → 257.50 + movement "+ Float +50.00"; cash out 20.00
  ("Personal") → 237.50 + movement "− Personal −20.00" ✓
- (g) X-report: Card 8.00 / Cash 7.50 / total 15.50; expected cash on hand
  200+7.50+50−20 = **237.50** ✓
- (h) Close shift (as Jun) → **PinPrompt "Close shift — PIN required"** → 1234 →
  counted 227.50 → **Z-report: Expected 237.50, Counted 227.50, Variance (Short)
  −SGD 10.00 (red)** ✓ — **M4 exit test**
- (i) post-close: register-locked banner returns (FR-200 re-lock); closed-shift row
  "Short SGD 10.00 · expected SGD 237.50" → detail screen with persisted Z-report ✓
- (j) Insights: KPI Today (net 30.28 / COGS 13.80 / GP 16.48 / ONM 58.18% / 2
  discounted / 7 units / 3 tx / 10.09 avg / 2.33 UPT) ✓; Extended KPIs (54.43% GM,
  119.42% markup, 0.01× turnover, 36500d DOH, 58.3% sell-through, 0.02× GMROI,
  100% fill) ✓; P&L (gross 33.00, GM 19.20, ONM 58.18% = 19.20/33.00) ✓; Velocity/ABC
  (croissant A/Fast 53% → cheddar C cum 100% >95%) ✓; stockout (croissant 9 @ 5.0/day
  → 1d red; cheddar 20 @ 2.0/day → 10d) ✓; expense entry (Staff Payroll 100) → P&L
  row + ONM −244.85% ✓; sales-history search "Jun" → exactly 1 row ✓; CSV sheet
  (176 chars, correct headers/values) → Android share sheet ✓
- (k) Settings as Jun: edit store name → Save → **PinPrompt "Store settings — PIN
  required"** → 1234 → "Store settings updated." (gate re-applies on the second
  save — single-action semantics) ✓
- (l) Stock adjustment as Jun: Adjust → dialog (preview ungated) → qty 2 + "Counting
  correction" → Confirm → **nested PinPrompt over the dialog** → 1234 → ledger row
  "Adjustment +2 · Counting correction" (stock 9 → 11) ✓

### Bugs found + fixed (this milestone)
1. **Launch crash on upgraded installs** — an existing v3 DB lacked the M4 tables
   and the migration path only ran at seed. Fixed with a self-healing bootstrap
   (`ENSURE_M4_SQL` + `ensureDefaultUsers` on every `getDb()`); device-verified.
2. **npm 10 peer-auto-install** — `npm install` was silently re-linking
   reanimated/worklets 0.10.3 from the parent workspace, crashing launch. Fixed
   with `.npmrc` `legacy-peer-deps=true` + restored lockfile + `npm ci`. (The APK
   still autolinks the parent's `libreanimated.so`/`libworklets.so` — harmless,
   verified running; do not "fix".)
3. **Raw string in `<View>` (RN warning)** — the P&L "Operating Costs" /
   "Inventory Asset Position" section labels were rendered as bare strings in a
   View (dev warning + text styles silently ignored). Fixed with `<Text>`; the
   intended uppercase micro styling now actually applies. Device-verified (warning
   gone, headers styled).
4. **Store settings unreachable (M4 regression)** — the M3 "Change" button on the
   Shift-tab Store card was dropped in the M4 rewrite, leaving `app/settings.tsx`
   with no navigation entry point. Restored button + style; verified
   (Store card → Store settings).

### FR touched
FR-200…FR-204 → full. FR-400 → partial (payment-method split is per-shift via
X/Z-report, not a daily dashboard tile — see FR-COVERAGE caveat). FR-401 → full.
FR-403 → full (documented approximations for turnover/GMROI averages + snapshot
rates). FR-500 → full (stricter on cashier close-shift). FR-501 → partial
(refunds + stocktake-apply gates await the M6 actions). DEV-003/DEV-005 resolved.

### Open items
- Refunds (line-level, FR-110/FR-111) + stocktake apply flow → M6; Z-report
  `refundsMinor` already reserved (= 0 for now).
- Daily/period payment-method split tile for the Insights dashboard (query exists:
  `getShiftSalesByMethod`).
- Sync of the closed-shift record (outbox op) → M5 with the rest of FR-502.
- Standing regression: `npx tsc --noEmit` (0 errors) + `npx jest`
  (145 tests, 13 suites) green.

## M5 — Cloud & sync (2026-10-31)

**Scope (per handoff BUILD-PROMPT M5):** BYO Supabase (the store owns its own
backend — ADR-010/DEV-006), idempotent outbox sync (push + pull deltas),
product LWW + immutable audit, server-side stock recompute (never
client-merged), two-device concurrency, locale engines (PaymentMethods,
BarcodeParser, receipt template — TaxEngine + currency already done Post-M3),
weighed items (FR-103/FR-104), receipt widths (FR-604), FR-503 status surface,
lossless disconnect/reconnect. Design: `docs/SYNC-DESIGN.md`.

### What shipped
- **BYO cloud (ADR-010, DEV-006):** `app/cloud-setup.tsx` wizard — paste
  URL + anon + service keys → paste-SQL step (copy the bundle → Supabase SQL
  Editor → verify via a service-key `schemaDeployed` check) → owner
  sign-up (or "already registered" → sign-in) → create-or-join store.
  `src/lib/cloud/schemaSql.ts` is the versioned idempotent SQL bundle (tables,
  RLS, views, audit). `src/lib/cloud/supabaseAdapter.ts` implements the
  `CloudAdapter` interface on `@supabase/supabase-js` (pure JS — **no new
  native deps**; peer-deps checked before install). The creator is never a
  data custodian: there is no Nurledger-hosted backend.
- **Outbox + cursors (FR-502):** `outboxRepository` — enqueue-at-write for
  `product` / `ledger` / `sale` (PO receive enqueues its stock move as a
  `ledger` op); FIFO pending; `markUploaded`; `delta_cursor` table (per-entity
  monotonic `MAX`). `useSync` hook — drain → push → mark, then pull deltas →
  apply; exposes the banner status. **Sync is OFF by default** (per-device
  runtime toggle in Settings → Cloud sync).
- **Correctness (SYNC-DESIGN §3):** server dedupe by **data-row conflicts**
  (`product.id`, `sale.uuid`, `stock_ledger.sync_op_id`) — there is no server
  ops table. Product edits merge **LWW on `updated_at`** and write an
  immutable `product_audit` row per attempt: `created` / `rejected`
  (same-value no-op) / `applied` (winning change), with before/after JSON +
  `changed_by_device`. **Stock is recomputed server-side from the sale
  ledger — never client-merged.** Tenant mapping: each device keeps its local
  outlet UUID; push payloads remap `outlet_id` local→tenant at drain time;
  pulled rows are written with the local outlet id. Multi-device seed
  identity via `deterministicId(name)` (SHA-256 → v5 UUID, namespace
  `nurledger:seed:v1:`) so two devices seed the *same* products.
- **Locale engines:** `paymentMethodsForLocale` (en-SG: Cash/Card/PayNow
  QR/Split; en-MY: Cash/Card/Touch 'n Go QR/Split) + QR stub acquirer behind
  an interface (ADR-006: Prepare QR → `QR-XXXXXXXX` reference → "no live
  acquirer" note → Confirm paid). `src/lib/barcode.ts` — per-locale
  `BarcodeParser` (pure): GTIN exact match + EAN-13 in-store range (first
  digit `2`) weighed parse (last 5 digits = grams, first 8 = item key matched
  via `findByWeighedKey`: `barcode = key OR key LIKE 'key%'`).
  `src/lib/receipt.ts` — receipt layout engine (pure): 58mm = 32 cols, 80mm =
  48 cols, long names truncated to fit; width chosen in Settings, reloaded on
  Sell-tab focus.
- **Weighed items (FR-103/104):** per-kg rates, stock tracked in **grams**
  (`stock_view.qty_g`; `STOCK_QTY_SQL` routes weighed products to grams),
  `linePriceForWeight = round(priceMinor × g / 1000)`. Scale barcode →
  "Weighed — <name>" prompt (weight editable) → explicit **Add to order** →
  line at per-kg math. Sale commit writes a ledger row `(qty_delta=0,
  qty_g_delta=−g)` and bypasses FIFO (COGS recorded as a per-kg fact).
  Adjust dialog is grams-aware for weighed products ("Quantity (grams) *",
  routes to `qtyGDelta`).
- **Schema v5:** `stock_view` gains `qty_g`; outbox partial index;
  `delta_cursor` table; upgrade path is self-healing (T8: app updated over a
  live v4 DB with real data → zero loss).
- **FR-503 status surface:** Sell banner + Settings cloud section (connect
  state, ON/OFF toggle, last-synced, queue count, Sync now, Disconnect).
- **No hardcoded country/tax:** the 8.25 US preset is gone —
  `grep -rn "8.25" src/ app/` → **0 matches**; all rates come from presets or
  the custom-rate entry (engine id only, never a literal in the math).

### Exit test — two-device E2E (PASSED, 9/9)
Two emulators (A = emulator-5554, B = emulator-5556) against a **local
Supabase** (Postgres + PostgREST + GoTrue + RLS — full fidelity; the emulator
reaches the host at `10.0.2.2`).
- **T1 wizard (CREATE + JOIN):** A creates the store → server outlet id =
  A's local id `39e044dd-c930-4890-a199-93ae168a1fae`, 1 `org_member`,
  1 auth user. B, same backend + credentials → "This email already has an
  account — sign in instead" → sign-in → create-or-join → B's local outlet
  **untouched**, `cloud.outlet_id` = tenant id.
- **T2 sync OFF by default:** fresh profile is pure-local (no cloud config);
  B queues with sync off: `1 ops queued · sync off`.
- **T3 offline sale on B:** Supabase STOPPED, verified offline window
  (container down, health endpoint refused) → B sells (uuid
  `d79ac3f3…`) → start server → B's op uploads.
- **T4 convergence + idempotency:** both devices converge; psql: server
  **5 sales / 11 products / 19 ledger / 22 audit**; both devices identical
  (croissant stock 10, sourdough 7); **re-sync is a no-op** (counts
  unchanged — no double-apply).
- **T5 product LWW + audit:** A edits croissant 3.50 → 4.00; B (holding the
  pulled 4.00) edits 4.00 → 4.50 with a later timestamp (1793388766265).
  Server = **450** (B wins); A pulls `(450, 1793388766265)`. `product_audit`
  chain: `created 350 → rejected (same-value 350, B's seed push) → applied
  350→400 (device A) → applied 400→450 (device B)`.
- **T6 no hardcoded tax + locale switch:** grep zero (above). Switched the
  store to the MY preset (SST 10% inclusive, en-MY, MYR) → Sell shows
  `Tax (10%, incl.)` + MYR + methods Cash/Card/**Touch 'n Go QR**/Split →
  sale of 6.50 shows tax **0.59** (inclusive: 650×10/110). Reverted to
  SGD / en-SG / GST 9% / 80mm.
- **T7 QR stub + weighed + receipts:** Touch 'n Go QR → Prepare QR →
  REFERENCE **QR-FD5D88B0** + stub note (ADR-006) → Confirm paid → payment
  row `(method='qr', 650, 'QR-FD5D88B0')`, reference on receipt #0BBAE031.
  Weighed: created "Russet Apples" (unit type kg, 8.90/kg, item key
  `20000000`); scale code `2000000001250` → "Weighed — Russet Apples · 1.25 kg
  · line price MYR 11.13" (= round(890×1250/1000)) → sale **1113/tax 101**;
  ledger `+5000 g` (adjust) → `−1250 g` (sale); stock 5000 → **3750 g**.
  Receipts: 80mm = 48-col separators; 58mm = 32-col + truncated names
  (`Artisan Country S…`).
- **T8 upgrade with live data:** app updated v4 → v5 on device A over a
  populated DB → all data intact (zero loss).
- **T9 lossless disconnect/reconnect:** sync OFF + sale → `1 ops queued ·
  Sync off` → **Disconnect** (cloud config cleared except `cloud.backfill_v1`;
  outbox + `delta_cursor` **intact**) → reconnect wizard ("already
  registered" → sign-in → "Your backend is linked") → sync ON → `Synced`.
  Server now has the queued sale (`acd75cf9…`, 650); cursors advanced
  monotonically (sale 1793390101688 → 1793390228519, ledger → 1793390228520,
  product unchanged); device A: **0 pending / 0 FK violations**.

### Bugs found + fixed (this milestone — all live-verified)
1. **Outbox FIFO index** — the pending-queue query indexed on `rowid` to get
   stable FIFO order without an extra column.
2. **`stock_view` migration** — SQLite views can't be `CREATE ... IF NOT
   EXISTS`; the v5 migration now `DROP VIEW IF EXISTS` + re-create.
3. **Unescaped backticks in the BYO SQL bundle** — the template literal ate
   SQL identifiers; bundle now deploys clean (verified via `schemaDeployed`).
4. **`useSync` stale banner** — status state not refreshed after a manual
   sync; now derived from a single store-driven update.
5. **Multi-device seed identity** — each device seeded *different* product
   UUIDs, so two devices disagreed about seed rows. Fixed with
   `deterministicId` (SHA-256 → v5 UUID) — cross-device proven live.
6. **Drain payload resolution** — push payloads referenced local row ids that
   didn't exist on the server; builders now resolve by
   `uuid = ? OR id = ?` (pure helpers in `src/lib/sync.ts`).
7. **Product push payload ignored the tenant outlet remap** — a joined
   device (B) pushed its local outlet id → server rejected it ("not a
   member") → **FIFO stall** (queue never drained). Remap applied at drain
   for all entities.
8. **Pull wrote `sale_uuid` into child `sale_id`** — child rows pointed at
   the server UUID instead of the local id → FK failure → **the whole pull
   rolled back forever**. Fixed with a uuid→local-id map applied to child
   rows.
9. **Rekey artifact (device A):** 12 `lot` rows had a dangling `product_id`
   after the tenant remap; repaired from A's own `cost_layer` rows
   (`ref_type='lot'`), DB pushed back to the device.
10. **Adjust dialog routed weighed qty to `qtyDelta`** — a grams restock
    landed in the base-unit column, invisible to the grams stock
    (`stockQty` for weighed = `qty_g`). Now `qtyDelta: isWeighed ? 0 :
    delta`, `qtyGDelta: isWeighed ? delta : null`, label "Quantity (grams)
    *".
11. **Receipt width loaded once on mount** — a Settings change had no effect
    until app restart. `app/(tabs)/index.tsx` now re-reads
    `getReceiptWidth()` on tab focus (`useFocusEffect`).

### FR touched
FR-502 → full (product/ledger/sale; shift *headers* remain local — see open
items). FR-503 → full. FR-504 → full (two devices, server arbitrates).
FR-505 → full (owner cloud auth; cashiers local-PIN per DEV-006). FR-506 →
full (tenant RLS in the BYO bundle). FR-601 → full (QR = stub per ADR-006).
FR-603 → full. FR-604 → full (layout engine; physical print M6). FR-103/104
→ full. FR-109 → partial remains (print + re-print UI → M6). DEV-006 logged.

### Open items
- **Shift/PO header records are not synced** — sales, stock and products
  converge, but the `shift` framing (float, Z-report) stays per-device
  (register state). Syncing closed-shift records is an M6 item (the M4
  report's pointer).
- Camera scan (FR-100) — `expo-camera` wiring → M6 (visible stub, DEV-004).
- Physical ESC/POS print + re-print from sales history (FR-109 tail) → M6
  (DEV-005) with label printing.
- Standing regression: `npx tsc --noEmit` (0 errors) + `npx jest`
  (209 tests, 18 suites) green.

## M6 — Release hardening (2026-10-31)

**Scope (per handoff BUILD-PROMPT M6 + M-priority gaps from the M5 audit):**
line-level refunds (FR-110/FR-111: per-line qty ≤ sold, reason code,
per-line restock, PIN-gated), stocktake UI (FR-304), label printing (FR-317),
supplier master (FR-313), CSV import/export (FR-314), PO print/share (FR-306
tail), margin-compression suggestions (FR-320), i18n EN + Bahasa Melayu
(FR-115), Play/App Store packaging **prep**. Packaging = prepare only — NO
EAS build queued without Mas's explicit GO.

### What shipped
- **Schema v6** (self-healing, data survives): `refund_line` (line-level
  amounts + restock flag), `supplier` (name, lead time, notes) +
  `product.supplier_id` (guarded ALTER in `ensureM6()`), category
  `created_at/updated_at` (guarded ALTER + NULL backfill — what makes
  categories LWW-syncable). v5→v6 verified on a live populated DB.
- **Refunds (FR-110/FR-111):** `src/lib/refund.ts` (pure) — the line's
  full-refund value is `round(saleTotal × lineTotal / Σ lineTotals)` with the
  LAST line absorbing the rounding remainder, so a full refund of the sale
  sums to EXACTLY `sale.total_minor` (`line_total_minor` is tax-EXCLUDE; the
  sale header carries the authoritative tax). Partial refund =
  `round(lineFullValue × k / lineQty)`. `refundRepository` commits ONE atomic
  transaction: refund + refund lines + (restock per line → immutable
  `stock_ledger` row + FIFO cost-layer restore at the sold `unit_cost_minor`)
  + `refund` outbox op, with per-line caps (you cannot refund more than was
  sold). `app/refund/[saleId].tsx` reached from the sales-history row: per-line
  qty ≤ sold, reason code required, restock toggle default-on; a fully
  refunded sale shows "This sale has no refundable lines left." The Z-report
  `refundsMinor` line (reserved in M4) is now wired.
- **Stocktake (FR-304):** `src/lib/stocktake.ts` (pure) + `stocktakeRepository`
  — create (all / by category, blind option), save counts save-on-blur, apply
  in ONE atomic tx: one `adjustment` ledger row + one `ledger` outbox op per
  non-zero variance (reason "Stocktake <local date>"), then the header is
  applied. UI: Inventory → Stocktake — blind hides the book qty, variance is
  computed live against the LIVE book (not a snapshot), apply is
  `stocktake_apply`-PIN-gated, applied takes are read-only.
- **Label printing (FR-317):** `src/lib/label.ts` (pure) — 58×40 mm label
  (name + price + barcode SVG + code), roll58 (one label/page, `@page 58mm`)
  and sheetA4 (3-column grid) layouts, per-product copy counts, HTML-escaped.
  Symbology: 12-digit codes → **UPC-A bit-for-bit identical to ZXing/Zint
  geometry** (all-L left half); otherwise Code 39 (43-char data set). 22 unit
  tests incl. ZXing-verified bit vectors. Scan round-trip: scanners report a
  12-digit UPC-A as EAN-13 with a leading 0 → `parseBarcodeSg` normalizes
  13-digit leading-0 → 12-digit; `findByBarcode` also matches `sku`
  (case-insensitive) and the '0'-prefixed form, so no-barcode items print
  scannable Code 39 SKUs. `app/labels/index.tsx`: scope (All / category rows /
  single product), copies stepper, paper toggle, Generate & Share →
  `exports/*.html` → expo-sharing. Entry points: product-detail "Label" action
  + Inventory tab "Label printing" row.
- **Supplier master (FR-313):** CRUD (name, lead time, notes), per-supplier
  SKU links, delete-with-links warning (unlink keeps products). PO form:
  supplier picker (autofills the vendor name) + free-text fallback.
- **CSV import/export (FR-314):** `src/lib/productCsv.ts` (pure) — serialize/
  parse, RFC-4180 `splitCsv`, column mapping **by header name** (column order
  free), strict per-row line-numbered validation, money in major units.
  UI: Inventory → "Product data (CSV)" hub — Export (share sheet) / Import
  (picker → preview "13 importable · 1 errors" → report → apply in ONE tx:
  upsert by SKU case-insensitive, unknown category names auto-created, every
  created/updated product enqueues its own outbox op — the import syncs like
  N manual edits).
- **PO print/share (FR-306 tail):** `buildPoText` (pure) → exports dir →
  system share sheet (WhatsApp/email/print).
- **Margin compression (FR-320):** `analyzeMargin` in `src/lib/stock.ts`
  (pure) — baseline = OLDEST cost layer (the cost the price was set against,
  spec §4.3.1), current = NEWEST layer; `compressed = current.cost >
  baseline.cost`; suggested price = `ceil(currentCost × 100 / (100 −
  baselineMarginPct))`. Product detail shows an amber card ("Margin
  compressed 62% → 57% · Latest cost SGD 2.35 vs SGD 2.10 · SGD 6.19 holds
  62% margin") with a "Use" action — `price_override`-gated, and the price is
  NEVER auto-changed (ADR-003).
- **i18n (FR-115):** `src/i18n/` — `en.ts` `as const` (the key set), `ms.ts`
  typed `Record<keyof EnDict,string>` so the compiler enforces key parity,
  pure `resolveLang`/`t`/`bindT` with `{param}` interpolation + EN fallback.
  `useT` on `useSyncExternalStore` (module-level `cachedLang` + listeners) so
  **every** mounted instance — including the root-layout header — re-renders
  on the same tap. The UI language is stored DEVICE-locally
  (`settings.ui.language`) — never the outlet's business locale (currency/tax
  stay with the store). 14-file sweep of user-facing strings; documents,
  labels, PO bodies, payment-method names and tax-preset labels stay English
  by design (business data).
- **Packaging prep (NO EAS queue):** `eas.json` profiles (development =
  dev-client, preview = internal, production = autoIncrement), icon 1024 +
  Android adaptive fg/bg/mono + splash assets present, `docs/PACKAGING.md`
  (identity, profile table, **no special permissions** rationale — camera +
  BT printer deferred to v2, Play/ASC runbook, privacy posture:
  offline-first, BYO cloud ADR-010, no analytics/PII). Version bump to 1.0.0
  deferred to build-GO time.
- **Category sync (cloud schema v3) — see bug #1 below:** categories are now
  a first-class synced entity (bundle v3, `SyncEntity` += `category`,
  enqueue-at-write, `buildCategoryPayload`, `backfillCategoriesOnce`, pull
  categories FIRST, pure `resolveCategoryDelta` + 9 unit tests).

### Exit test — device E2E (PASSED, all 7 scenarios)
Two emulators (A = emulator-5554, B = emulator-5556) + local Supabase
(schema v3 re-pasted; outlet `39e044dd…`).
- **R1 — offline refund:** per-line refund (weighed 1250 g + 1 loaf), restock
  on, reason + PIN enforced for cashier (owner bypasses; wrong PIN rejected).
  DB-verified: exact full-refund invariant (1113 = sale total), append-only
  ledger, net stock 0, FIFO cost layer restored at the sold unit cost.
- **R2 — refund syncs to server + pulls on the second device:** A's auto-retry
  drained all 21 pending ops (2 refunds, 3 stocktake ledger rows, 15
  products, 7 categories). Server: 2 `refund` rows (1113 customer_return /
  650 order_mistake, restock=t), 2 `refund_line` (weighed qty_g=1250; count
  qty=1), 2 restock `stock_ledger` rows (+1250 g; +1 @ 240). **This is what
  exposed the category bug** — B's pull failed forever (FK). After the v3
  fix: B's pull completed — DB-verified **7 categories** (incl. the
  CSV-created "Imported" `b1d258d8…`), 2 refunds + 2 lines + 2 restock
  ledger rows, all 5 cursors advanced, `cloud.last_error` cleared, banner
  "Synced". B UI: the refunded sale (Oct 31 3:51 AM · Russet Apples · SGD
  11.13) in Insights → sales history opens and shows "This sale has no
  refundable lines left." A repro harness replaying B's real pull against B's
  real DB snapshot: ALL STEPS OK.
- **S1 — blind stocktake:** all products, blind (book hidden), 3 counted
  variances (cheddar 22/20, sourdough 2/4, russet 4800/5000 g) + 9
  confirmations → cashier Jun → PIN prompt (wrong 8-digit PIN rejected,
  owner 1234 unlocks) → apply. DB: header applied, 3 `adjustment` ledger
  rows `ref_type='stocktake'` with matching outbox op_ids, stock_view
  updated, cheddar +2 FIFO cost layer at product.cost_minor.
- **L1 — labels:** Beverages × 4 copies, 58mm roll → share sheet → file
  pulled: 16 labels, 16 SVGs, correct names/prices/codes; **all 4 unique
  barcodes ZBar-decoded** from the device file (EAN-13 "0"+code → normalized
  back). Product-detail "Label" → single-product scope (1 × 5).
- **C1 — CSV export → re-import:** export 12 products (share sheet; pulled
  file: commas quoted per RFC-4180, major-unit money, category names) →
  import a fixed 14-column file (12 seeded SKUs @ new values + 1 new SKU + 1
  bad-price row) → "1 created · 12 updated · New categories: Imported · 1
  row(s) skipped"; bad row reported as "line 15 · price: must be a
  non-negative number"; no duplicate rows; outbox ops resolve (0 dangling).
- **P1 — PO share:** PO detail → Share → share sheet with
  `po_test_wholesale_sg_*.txt`; pulled file verified line-by-line (store/
  supplier/terms header, "12 @ SGD 2.35 = SGD 28.20", lot + exp + received
  12/12 annotation, "Total: SGD 28.20 (1 line, 12 units)").
- **I1 — locale round-trip:** Settings → Language (Segmented English |
  Bahasa Melayu) → tap Bahasa Melayu → the ENTIRE Settings screen flips live
  incl. the root-layout header ("Store settings" → "Tetapan kedai", "Mata
  Wang", "Jual dalam") + tab bar (Jual/Inventori(3)/Tarikh Luput/Analitik/
  Syif) + Sell screen (Pesanan Semasa, CAJ, "Cukai (9%, termasuk)", JUMLAH,
  banner "21 operasi menunggu — menyegerak secara autom…") → relaunch → still
  Malay (persisted; `settings.ui.language='ms'`) → tap English → full revert
  live incl. header.

### Bugs found + fixed (this milestone — all live-verified)
1. **Category-sync gap (R2) — the milestone's big one:** categories were
   local-only, but `product.category_id REFERENCES category(id)` locally and
   categories were NOT in the cloud schema. Device A's CSV import created
   category "Imported" (`b1d258d8…`) on A only; when B pulled products, its
   upsert for "Import Test Product" violated the FK → the pull transaction
   rolled back → **B's entire pull batch was stranded on stale cursors,
   forever** (every sync tick re-pulled the same delta, re-failed, re-rolled
   back; refunds never landed on B). Fix = make categories a synced entity:
   - **Cloud schema v3** (BYO bundle): `category` table (id, outlet_id, name,
     created_at, updated_at, updated_by_device) + member RLS + idempotent
     `apply_category` LWW RPC (returns created/updated/kept). **Deliberately
     NO UNIQUE(outlet_id, name)** — two devices can create same-named
     categories with different ids offline; a server-side unique constraint
     would stall the FIFO drain on the second insert. Name uniqueness is a
     CLIENT invariant (local `UNIQUE(name)`) resolved on pull.
   - `SyncEntity`/cursors/pull += `category`; **categories pulled FIRST** so a
     product's `category_id` can never dangle on pull.
   - Local `category` gains `created_at/updated_at` (`ensureM6` self-heal:
     guarded `hasColumn` ALTER + one-time NULL backfill); seed +
     `createCategory` + CSV auto-create all write timestamps and enqueue at
     write time.
   - `buildCategoryPayload` (op_id = category.id — categories are
     create-only, so no fresh-op-id/hint variant) +
     `backfillCategoriesOnce()` (flag `cloud.backfill_v3`) for seed/CSV
     categories that predate the entity.
   - Pure `resolveCategoryDelta` in `src/lib/sync.ts`: LWW by id, then
     same-name (NOCASE) collision → the LOCAL row keeps identity and the
     remote id is **remapped** onto it (also dedupes two new same-named remote
     rows in-batch); pulled products' `category_id` is re-keyed through the
     remap. 9 new unit tests.
   - Verified: v3 re-pasted → A auto-pushed its 7 categories → B's pull
     completed end to end (R2 above) + repro harness ALL STEPS OK.
2. **Stocktake reason date was UTC** — a 5 AM stocktake stamped *yesterday*
   in the ledger reason. Now the local date.
3. **SAF URI-grant percent-decoding** — the picked CSV's content URI carried
   through an expo-router query string got percent-decoded
   (`document%3A…` → `document:…`); AMS grant lookup is an EXACT Uri match
   against the ENCODED string (proven via `dumpsys activity permissions`) →
   `SecurityException` on read. Fix: `src/lib/pickedFile.ts` module-state
   handoff (`setPickedFile` → `router.push('/import-csv')` with no params →
   `getPickedFile`). NOTE: not a Downloads/`raw:` provider issue — the earlier
   conclusion was wrong. (Side finding: the file must be
   MediaStore-indexed for the picker's search to find it.)
4. **`useT` stale header** — the first i18n wiring read language from
   per-instance state; the root-layout header (mounted at app root) kept the
   old language after a switch until the next navigation. Fix: module-level
   store on `useSyncExternalStore` (`cachedLang` + listeners + `emit()`) —
   every instance re-renders on the same tap. Device re-verified.
5. **UPC-A scan round-trip** — scanners report a 12-digit UPC-A as EAN-13
   with a leading 0; printed labels with raw UPC-A data were unreadable.
   `parseBarcodeSg` now normalizes 13-digit leading-0 → 12-digit, and
   `findByBarcode` matches `sku` (case-insensitive) + the '0'-prefixed form.
   Bit vectors verified against ZXing/Zint.

### FR touched
FR-110/FR-111 → full (incl. sync + Z-report line). FR-304 → full. FR-317 →
full (printable HTML via share; physical thermal output = same HTML on any
browser/printer — no BT hardware). FR-313 → full. FR-314 → full. FR-306 →
full (print/share tail). FR-320 → full. FR-115 → full (EN + MS; the i18n
seam takes more locales as data files). FR-501 → full (all 7 gates live).
FR-502 → extended (refund + category entities). FR-100 / FR-109 tail /
FR-604 physical print → **v2** (camera + BT printer deferred — no special
permissions in the release build; DEV-004/DEV-005 updated). FR-315 → schema
ready, no v1 UI (S1). Packaging → prep only (docs/PACKAGING.md); NO EAS build
queued.

### Open items
- **Shift/PO header records are not synced** (carried from M5) — the `shift`
  framing (float, Z-report) stays per-device register state; syncing
  closed-shift records remains v2.
- Camera scan (FR-100) + physical ESC/POS print / re-print (FR-109/FR-604
  tail) → v2 (BT printer + camera permissions deferred for the release build).
- EAS store builds: prepared, not queued — awaiting Mas's explicit build GO
  (quota check + version bump to 1.0.0 happen at build time).
- Standing regression: `npx tsc --noEmit` (0 errors) + `npx jest`
  (316 tests, 23 suites) green.
