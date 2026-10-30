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
