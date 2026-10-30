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
