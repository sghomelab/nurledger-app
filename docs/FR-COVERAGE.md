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

## M3 — Inventory & Expiry
FR-304 (stocktake), FR-305 (alerts UI), FR-306 (PO + receive), FR-307 (Expiry Radar UI), FR-317 (labels), FR-320 (margin compression).

## M4 — Shifts & Back office
FR-200…FR-204, FR-400, FR-401, FR-402 (done), dashboard KPIs, CSV exports.

## M5 — Cloud & sync
FR-502…FR-506, FR-600…FR-604 engines (TaxEngine reference locale SG/SGD/GST 9%).

## M6 — Release hardening
FR-110/FR-111 refunds, FR-315 transfers, FR-313 suppliers UI, FR-314 CSV import/export, FR-115 i18n.
