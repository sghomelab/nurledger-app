# FR Coverage — Nurledger

Audited after each milestone (per BUILD-PROMPT convention). Status: ✅ done · 🔜 scheduled · — not applicable.

## M1 — Foundation (done)

| FR | Requirement | Status | Files / tests |
|----|-------------|--------|---------------|
| FR-300 | Product master (name, barcode(s), category, cost, price, tax cat, UoM, min/max) | ✅ | `src/db/schema.ts` (product), `app/(tabs)/inventory/new.tsx`, `app/(tabs)/inventory/[id].tsx` |
| FR-302 | Real-time local stock data model (decrement path lands M2) | 🔜 M2 | `stock_ledger` + `stock_view` schema in place |
| FR-303 | Stock levels per outlet (v1 = 1 outlet, schema ready) | ✅ | `outlet_id` on product/lot/ledger/cost_layer/sale/shift/PO/stocktake |
| FR-307 | Lot/expiry tracking (schema) | ✅ | `lot` table + FEFO index; seed carries prototype batch/expiry; UI in M3 |
| FR-308 | Reorder suggestions Min/Max (math) | ✅ | `src/lib/stock.ts reorderSuggestion` + test |
| FR-316 | Immutable append-only stock ledger | ✅ | `stock_ledger` (no UPDATE/DELETE paths), `src/repositories/stockRepository.ts appendLedgerRow` |
| FR-318 | Pack/case-break UoM (schema: carton_size, ledger in base units) | ✅ | schema `carton_size`; UI path in M3 |
| FR-319 | FIFO cost layers | ✅ | `cost_layer` table, `consumeFifo`/`applyConsumption` + tests (spec §4.3.1 worked example) |
| FR-321 | Per-sale-line COGS (schema) | 🔜 M2 | `sale_line.unit_cost_minor/cogs_minor` columns in place |
| FR-322 | Dual barcodes (schema: barcode + carton_barcode, both indexed) | ✅ | schema + index; scan path in M2 |
| FR-502 | Client-UUID idempotency keys (schema) | ✅ | `sync_op_id UNIQUE`, `uuidv4()` + test |
| FR-602 | Money = integer minor units + ISO currency | ✅ | `src/lib/money.ts` + tests; outlet.currency |
| NFR-3 | No data loss on kill (local SQLite, synchronous writes) | ✅ | expo-sqlite async API, all writes awaited; force-kill exit test |
| NFR-8 | Money unit tests | ✅ | `src/__tests__/money.test.ts` |

**Design system (prototype tokens §8):** ✅ `src/theme/tokens.ts` + `src/fonts.ts` (Plus Jakarta Sans + JetBrains Mono, indigo/emerald/amber/rose/slate, rounded-xl, tabular-nums via `NumberText`).

**Navigation (5 sections, prototype order):** ✅ `app/(tabs)/_layout.tsx` — Sell · Inventory · Expiry · Insights · Shift; low-stock badge on Inventory tab.

**Seed (PROTOTYPE-REFERENCE §9):** ✅ 6 categories + 11 products with barcodes, costs, prices, stock, thresholds, batches, expiries — `src/seed/data.ts` + `src/__tests__/seed.test.ts`.

## M2 — Register (done)

Core loop: scan → cart → live FIFO margin → payment → receipt → offline decrement, all on local
SQLite with an idempotent outbox write. Money = integer minor units (ADR-004); every cart mutation
is persisted (NFR-3) and `completeSale` is one atomic transaction (FIFO consume + immutable ledger
+ sale header/lines + payments + outbox) that rolls back as a whole on any failure.

| FR | Requirement | Status | Files / tests |
|----|-------------|--------|---------------|
| FR-101 | Manual entry: SKU/name search + quick product chips | ✅ | `app/(tabs)/index.tsx` (search + `QuickChips`), `productRepository.findByBarcode` |
| FR-102 | Bluetooth / USB keyboard-wedge scanner | ✅ | `index.tsx` scan field (`blurOnSubmit=false`, Enter submits, keeps focus) |
| FR-105 | Cart: qty edit, remove line, per-line + order discount | ✅ | `useCart` (`setQty`/`removeLine`/`setLineDiscount`/`setOrderDiscount`), `CartLineRow`, `MoneyPrompt`; PIN-gating deferred (DEV-003) |
| FR-107 | Payments: cash (tender/change), card, mobile, QR, split | ✅ (card/QR = ADR-006 stubs) | `src/lib/payment.ts` (`evenSplit`, `changeDue`, `PAYMENT_METHODS`), `PaymentSheet`, `payment.test.ts` |
| FR-108 | Tax by TaxEngine (incl/excl), receipt shows breakdown by category | ✅ | `src/lib/tax.ts` (`flatRateTaxEngine`, `taxEngineFor`), `computeTotals`, `ReceiptView`; `tax.test.ts` |
| FR-109 | Receipt (on-screen "no printer" fallback) | ✅ partial | `ReceiptView` + `saleRepository.getSale`; ESC/POS print + re-print → M5 (DEV-004) |
| FR-302 | Real-time local stock decrement (the M2 decrement path) | ✅ | `stockRepository.applySaleInTx` (FIFO consume + immutable `stock_ledger` row, in-tx) |
| FR-321 | Per-sale-line COGS recorded at sale time (FIFO) | ✅ | `saleRepository.completeSale` (per-line `unit_cost_minor`/`cogs_minor`), live preview via `allocateCogs`; `sale.test.ts` |
| FR-502 | Client-UUID idempotency keys → outbox op per sale | ✅ | `saleRepository.completeSale` outbox INSERT (`sync_op_id`), `uuidv4()` |
| FR-100 | Camera scan (MLKit/`expo-camera`) | 🔜 M5 | camera stub in `index.tsx` (DEV-004) |
| FR-103 | Weighed items (weight × unit price) | 🔜 M5 | `CartLine.qty` is base units; weighed grams path in M5 (DEV-004) |
| FR-104 | Embedded-weight EAN-13 parse (per-locale BarcodeParser) | 🔜 M5 | engine lands in M5 (DEV-004) |
| FR-106 | Held / parked orders | 🔜 M3 | `current_order` is single-active today; parking in M3 |

**Cart persistence + kill test (NFR-3):** ✅ schema v2 (`current_order`/`current_order_line`) + v1→v2
migration (`database.ts`); `useCart` persists every mutation; `completeSale` clears the cart in the
same transaction as the stock decrement. *On-device force-kill walkthrough: see M2 report in
`MILESTONE-REPORTS.md`.*

**Standing regression:** `npx tsc --noEmit` (0 errors) + `npx jest` (49 tests) green.

## M3 — Inventory & Expiry (done)

Inventory detail + quick actions, stock adjustments with required reason, purchase orders with
in-batch receiving, the FEFO Expiry Radar, reorder→PO flow, and carton break. The `stock_ledger`
remains the single source of truth — every movement is one immutable row (schema v3 adds `reason`).

| FR | Requirement | Status | Files / tests |
|----|-------------|--------|---------------|
| FR-305 | Low-stock alerts (on-hand ≤ min → badge/list) | ✅ | Low-Stock-Only toggle + Low Stock chips + amber Inventory-tab badge (`useProducts.lowStock`); badge verified on-device (BAK-SOUR-01) |
| FR-306 | PO create (manual + from reorder suggestion) + receive flow (batches → stock + cost) | ✅ (print/share → M6) | `src/lib/po.ts` (pure: `poTotalCostMinor`/`remainingToReceive`/`isFullyReceived`/`planReceive`/`cartonsToBase`), `poRepository` (`createPO`/`getPO`/`listPOs`/`receivePO` in-tx), `app/po/index.tsx` · `new.tsx` · `[id].tsx`; `po.test.ts` |
| FR-307 | Lot/expiry tracking + FEFO + "expiring soon" list | ✅ | `app/(tabs)/expiry.tsx` (summary cards + FEFO-ranked rows + rose/amber urgency), `stockRepository.expiryRadar`, `lib/stock.ts` (`expiryUrgency`/`summarizeRadar`/`fefoRank`); stock-outs are lot-attributed via `lot_id` (FEFO lot) on the ledger row |
| FR-308 | Reorder suggestions Min/Max → PO prefill | ✅ | `reorderSuggestion` (M1) + `productRepository.reorderCandidates` + `useReorder`; Restock quick action opens `/po/new?product=&qty=` with the Min/Max qty prefilled |
| FR-316 | Every stock movement = immutable ledger row (sale/refund/receive_po/adjustment/waste/expiry_loss) | ✅ | schema v3 `stock_ledger.reason` (guarded `ALTER TABLE` migration); `applyStockMoveInTx` single in-tx writer (`applySaleInTx` delegates); `AdjustStockDialog` (reason **required**); `stockRepository.applyStockMove` standalone wrapper |
| FR-318 | Pack/case-break: receiving cartons adds N base units | ✅ | `cartonsToBase` + test; PO line for a carton product shows `Cartons (×N)` and stores base units — ledger is always base units |
| FR-319 | FIFO cost layers from PO receive / adjustment (lot-linked) | ✅ | `receivePO` creates one `lot` + one `cost_layer (ref_type='lot', ref_id=lot.id)` per line; `applyStockMoveInTx` adds a layer for inbound adjustments; seed's opening layers lot-linked (verified on-device 11/11); FEFO radar joins layers→lots |
| FR-322 | Dual barcodes: carton barcode sells N base units | ✅ | `useCart` scan resolves `carton_barcode` → adds `cartonSize` base units; product form carries carton size + carton barcode (schema since M1) |

**Product detail (FR-300 surface):** ✅ `app/inventory/[id].tsx` — mobile idiom for the
prototype's 17-column desktop table: list row (name/SKU/stock/status) + rich detail (barcode,
category, unit, cost, price, **margin %**, min/max, velocity, lot batch + expiry, status, last
updated, ledger last-5) with quick actions **Adjust** (reason required) · **Restock** (→PO) ·
**Edit** · **Deactivate/Reactivate**.

**Deferred (logged in `SPEC-DEVIATION.md` DEV-005):** FR-304 stocktake UI (schema
`stocktake`/`stocktake_count` already in place), FR-317 label printing, FR-320 margin-compression
suggestion UI, FR-306 print/share (PDF/WhatsApp) → **M6**. Adjustment PIN-gating → **M4**
(DEV-003 pattern: action functional now, gate bolted on with roles).

**Standing regression:** `npx tsc --noEmit` (0 errors) + `npx jest` (58 tests) green.

## Post-M3 — Multi-currency + configurable tax locale (FR-600, FR-602) (done)

Standalone commit on `main` (not a milestone) — the register previously had no way to
configure anything other than the seed locale (SG / SGD / GST 9% inclusive).

| FR | Requirement | Status | Files / tests |
|----|-------------|--------|---------------|
| FR-600 | TaxEngine configurable per store (rate + inclusive/exclusive); presets are DATA, behavior always via the stored engine id | ✅ | `src/lib/tax.ts` (unchanged — `flat:<label>-<rate>-<mode>` resolution was already generic), `src/lib/currency.ts` (preset data + `buildCustomEngineId` + `taxEngineLabel`), `app/settings.tsx` (Store settings), `outletRepository.updateOutlet`; `tax.test.ts` (MY 10% incl, US 8.25% excl, EU 21% excl, custom 7.5% incl → 698 minor), `currency.test.ts` |
| FR-602 | Currency: integer minor units + ISO code + locale formatting — now a first-class per-store setting | ✅ | `src/lib/currency.ts` (20 curated codes + free-form ISO entry, `Intl`-validated), `src/lib/money.ts` (`formatMoney` zero-decimal display for JPY/KRW/VND/ISK/CLP; storage stays uniform 1/100 major unit for ALL currencies), `app/settings.tsx`, `outletRepository`, `useOutlet` (focus-refetch); `money.test.ts` (MYR/THB/AED/EUR/IDR, zero-decimal, unknown-code fallback), `currency.test.ts` |
| — | Picker correctness: RN `Alert.alert` silently truncates to 3 buttons (`Alert.js:100`) → shared `PickerOverlay` bottom sheet | ✅ | `src/components/PickerOverlay.tsx`; replaces 4 pickers — settings currency + tax, **latent M1 bug** category picker (`app/inventory/edit.tsx`), **latent M3 bug** PO product picker (`app/po/new.tsx`); all 4 verified on-device |

**Behavior notes**
- Presets (none / SG GST 9% incl / MY SST 10% incl / US 8.25% excl / EU 21% excl) are
  *suggestions* carrying a suggested currency+locale; any ISO-4217 code and any 0–40%
  rate (≤2 decimals) works via free-form / custom entry. Nothing in the math path is
  country- or rate-specific (ADR-004).
- Changing the currency reinterprets existing amounts in the new currency (UI warning in
  settings; owner re-prices as needed).
- PIN/role gating for settings changes ships with M4 (DEV-003).

**Device evidence (cs-test AVD, 2026-10-30):** Shift store card
"SGD · Singapore GST 9% — inclusive" → saved MYR + SST 10% → "MYR · Malaysia SST 10% —
inclusive" (focus-refetch); cart cheddar 850 minor → Subtotal MYR 8.50, Tax (10%, incl.)
MYR 0.77, Total MYR 8.50, margin 54%; free-form TWD → "NT$123.45" preview → register in
NT$; JPY zero-decimal → line ¥9, Tax (10%, incl.) ¥1, CHARGE ¥9; full 22-row currency
list scrolls in the overlay; restored to the SG reference locale at the end (Sell shows
the 9% GST row, cart empty). See `MILESTONE-REPORTS.md` (Post-M3).

**Standing regression:** `npx tsc --noEmit` (0 errors) + `npx jest` (77 tests) green.

## M4 — Shifts & Back office
FR-200…FR-204, FR-400, FR-401, FR-403, FR-500, FR-501.

| FR | Requirement | Status | Files / tests |
|----|-------------|--------|---------------|
| FR-200 | Open shift: float; shift = {device, cashier}; one open per device; register locked when closed | ✅ | `src/lib/shift.ts` (`expectedCashMinor`, `zReport`), `src/repositories/shiftRepository.ts` (open/close, one-open guard), `app/(tabs)/shift.tsx` (open w/ float + locked card), `app/(tabs)/index.tsx` (register lock banner + inline Open shift); `shift.test.ts` (drawer math incl. card exclusion, variance sign) |
| FR-201 | Cash in/out during shift with reason | ✅ | `cash_move` table (schema v4), `shiftRepository.recordCashMove`, `app/(tabs)/shift.tsx` (Cash in/out prompts + Cash movements list); `shift.test.ts` (movement aggregation) |
| FR-202 | Close shift: counted → expected vs counted variance → Z-report (sales by method, cash movements, variance) | ✅ | `shiftRepository.closeShift` (persists `z_report_json`), `src/lib/shift.ts:zReport`, `src/components/report/ReportView.tsx` (Z/X sheet), `app/shift/[id].tsx` (closed-shift detail w/ persisted Z-report); **exit test passed on-device** (counted 227.50 vs expected 237.50 → Short −SGD 10.00). Refunds line in Z-report awaits M6 (`refundsMinor` = 0 for now) |
| FR-203 | X-report anytime | ✅ | `shiftRepository.getXReport` (sales by method + cash on hand, non-destructive), `app/(tabs)/shift.tsx` (X-report sheet) |
| FR-204 | Offline shift open/close + sync later | ✅ | All shift reads/writes hit local SQLite only (no network in the path); close is local — outbox op for the closed shift lands with M5 sync (same pattern as M2 sales, FR-502). Verified: full shift day offline (device airplane-mode AVD) |
| FR-400 | Owner dashboard KPIs (net sales, tx, avg basket, gross margin, top SKUs, payment-method split, low-stock / expiring-soon / stockout lists) | ⚠️ partial | `src/repositories/insightsRepository.ts` + `src/lib/kpi.ts` + `app/(tabs)/insights.tsx`: KPI cards (net revenue, COGS, gross profit, ONM %, discounted items, units + tx/avg basket/UPT) ✓; top SKUs via Velocity/ABC top-15 (revenue share) ✓; stockout list via Stockout Forecast ✓; low-stock list on Inventory tab (badge + Low Stock Only filter) ✓; expiring-soon via Expiry Radar (FEFO) ✓. **Caveat: payment-method split is per-shift (X/Z-report "sales by method"), not a daily dashboard tile — deferred, no data-model gap (query exists: `getShiftSalesByMethod`)** |
| FR-401 | Sales history searchable by date/product/cashier + CSV export | ✅ | `insightsRepository.getSalesHistory` (cashier join), `app/(tabs)/insights.tsx` (live search across product/cashier/sale ID + date sort), `src/lib/csv.ts:buildSalesHistoryCsv`; `csv.test.ts`; device-verified (search "Jun" → 1 row) |
| FR-403 | KPI page — full research-doc §4 list | ✅ | `src/lib/kpi.ts` (all extended KPIs: GM %, mark-up %, inv. turnover, days on hand, sell-through, GMROI, shrinkage, stockout rate, expiry waste, fill rate) + `insights.tsx` Extended KPIs card; `kpi.test.ts` (markup 119.42 %, turnover 0.01× on fixture, fill rate). Period selector: Today / Current period (month) / All time. Turnover/GMROI use period-end inventory at cost as the average (documented approximation); stockout rate + expiry waste are snapshot figures |
| FR-500 | Roles: Owner (all) / Cashier (sell) — PIN + role-aware UI | ✅ | `src/lib/roles.ts` (`roleCanAct`, 5 gate actions), `app_user` table + seeded Owner/Cashier (schema v4), `useUsers` hook, cashier switch sheet on Shift tab (no PIN to switch — active user is device-scoped state); role-aware UI: cashier sees the same register, gated actions prompt for owner/manager PIN (single-action unlock, never persisted); **stricter than spec**: spec lets cashiers "close own shift" — we PIN-gate close for cashiers too (defense in depth; owner/manager close without PIN) |
| FR-501 | Manager PIN gates: refunds, order discounts, price edits, stocktake apply, settings | ⚠️ partial | `src/lib/pin.ts` (4–8 digit validate/verify) + `src/lib/sha256.ts` (pure-JS; `s:<salt16>:<hash>` format) + `src/components/PinPrompt.tsx` (keypad, pending <8 digits, definite-fail at 8). Gates live: **discount (line + order), price override, stock adjust, close shift, store settings** — all 5 device-verified (owner direct; cashier → PinPrompt; wrong PIN 9999×2 → "Wrong PIN"; 1234 → action proceeds; gate re-applies on the next action). **Refunds + stocktake-apply gates await M6** (the actions ship in M6; `GATE_ACTION_LABELS` is the extension point) |

**Behavior notes**
- KPI cards are **NET** basis (netSales = Σsubtotal − Σdiscount − Σtax; avgBasket = netSales/tx);
  the P&L is **GROSS money-in** basis (Operating Net Margin = grossMargin/grossSales,
  matching the prototype's P&L structure). The KPI "Operating net margin" tile shows the
  P&L-derived value (both are `src/lib/kpi.ts`, tested).
- Card sales are **excluded from the cash drawer** (terminal capture, ADR-006) — drawer =
  float + cash sales + cash in − cash out; device-verified (drawer unchanged after a card sale).
- PIN unlock is single-action and session-scoped: it never persists, never upgrades the
  active user, and re-appears for the next gated action.
- Seed fixture users: Owner (PIN `1234` — documented test fixture only) + Jun, Cashier (no PIN).
  `ensureDefaultUsers` is idempotent and runs on seed, on v3→v4 migration, and on every
  bootstrap (self-heal).

**Device evidence (cs-test AVD, 2026-10-30)** — full matrix (a)–(l) in
`MILESTONE-REPORTS.md` (M4), incl. the exit test: full offline shift day → close →
counted 227.50 vs expected 237.50 → Z-report variance **Short −SGD 10.00** (matches
counted cash), register re-locks (FR-200), closed shift persists with its Z-report.

**Standing regression:** `npx tsc --noEmit` (0 errors) + `npx jest` (145 tests, 13 suites) green.

## M5 — Cloud & sync
FR-502…FR-506, FR-601, FR-603, FR-604 locale engines (PaymentMethods, BarcodeParser,
receipt template, e-invoicing interface). FR-600/FR-602 done Post-M3.

## M6 — Release hardening
FR-110/FR-111 refunds, FR-315 transfers, FR-313 suppliers UI, FR-314 CSV import/export, FR-115 i18n.
