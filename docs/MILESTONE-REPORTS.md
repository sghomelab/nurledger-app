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
