# Spec Deviation Log — Nurledger

Feature-conflict rule (BUILD-PROMPT): implement the spec, log it here.

## DEV-001 — Stack: Expo SDK 57 instead of Flutter + Drift (2026-10-30)
- **Spec/ADR-001 said:** Flutter (Android+iOS) + Drift (SQLite) + Supabase, MLKit camera scanning, esc_pos_bluetooth.
- **Implemented:** Expo SDK 57 / React Native 0.86 + expo-router + expo-sqlite (SQLite), per owner direction ("follow Conscious Spending" — the established Nurlogic mobile stack, 2026-10-30 session).
- **Rationale:** owner's live instruction takes precedence over the handoff doc; keeps Nurledger in the same EAS/Expo Go toolchain as all other Nurlogic apps. ADR-009 supersedes the stack portion of ADR-001.
- **Mapping:** Drift → expo-sqlite (same SQLite, same schema) · MLKit camera scan → expo-camera (barcode support, M2) · esc_pos_bluetooth → community ESC/POS module or stub (M5) · Riverpod → plain hooks + repositories · Supabase → unchanged for M5.
- **Acceptance-test impact:** "Flutter app builds clean" item is interpreted as "app builds clean (Expo, Android+iOS)"; Flutter-specific items (MLKit/Vision, PowerSync) re-scoped to their Expo equivalents.

## DEV-002 — Seed products: 11 (not 19) (2026-10-30)
- The live prototype bundle contains 19 products, but PROTOTYPE-REFERENCE §9 (the handoff's canonical seed list) specifies 11 (prod-001…prod-011). Acceptance test M1 says "11 seed products + 6 categories". Seeded exactly the 11; Household category ships empty by design.

## DEV-003 — Price-override / discount PIN-gating deferred to M4 (2026-10-30) — RESOLVED in M4
- **Spec/FR said:** price override (FR-105 order-level, and per-line "Adjust Price") are manager-PIN-gated.
- **Implemented (M2):** the actions are fully functional (per-line price adjust, per-line + order discount) but NOT yet PIN-gated — there is no roles/PIN system in M2.
- **Rationale:** roles + PIN-gating (Store Manager / Shift Lead / Cashier) is a discrete M4 concern (shift + back office). The math and UI path land in M2 so the register is complete; the gate is bolted on in M4 without changing the data model.
- **Acceptance-test impact:** the "manager PIN" clause on FR-105 is satisfied in M4, not M2.
- **Resolution (M4, 2026-10-30):** `src/lib/roles.ts` + `PinPrompt` gate `price_override`, `discount` (line + order), `stock_adjust`, `close_shift`, `store_settings`. Device-verified both paths (owner direct / cashier → PIN, wrong-PIN failure, single-action re-gating).

## DEV-004 — Camera scan + weighed items + EAN-13 parse scoped to M5 (2026-10-30)
- **Spec/FR said:** FR-100 camera scan (MLKit), FR-103 weighed items (weight × unit price), FR-104 embedded-weight EAN-13 parse (per-locale BarcodeParser engine).
- **Implemented (M2):** manual barcode entry + keyboard-wedge scan (FR-101/FR-102) + tap-to-add from search — the register is fully usable offline. The camera button is a visible stub (explains the deferral); weighed `qty` is held as base units.
- **Rationale:** camera + scale + locale barcode parsing are hardware/locale engines that land with the M5 engines (TaxEngine / PaymentMethods / BarcodeParser per spec §4.4). Keeping M2 to "scan any way you can already scan" keeps the core loop shippable and testable now.
- **Acceptance-test impact:** the M2 "camera scan <300ms" and "weighed-item path" items re-scope to M5 (Expo `expo-camera` + BarcodeParser); M2 proves the offline core loop end to end.

## DEV-005 — M3 scope: stocktake UI, label printing, margin-compression UI, PO print/share → M6; adjustment PIN → M4 (2026-10-30) — adjustment PIN RESOLVED in M4
- **Spec/acceptance said (M3):** stocktake blind-count flow → variance report → PIN apply (FR-304); batch label printing (FR-317); margin-compression suggestion UI (FR-320); PO print/share PDF/WhatsApp (FR-306); stock adjustment "applies via PIN".
- **Implemented (M3):** the full data model for all of them already exists (stocktake/stocktake_count tables, carton/lot/expiry schema, cost layers with margin math via `marginPct`) and the inventory surface ships complete for the core loop: product detail with quick actions, stock adjustment with **required reason** writing an immutable `adjustment` ledger row (+ FIFO cost layer for inbound), PO create + receive in batches (one lot + lot-linked cost layer per line), FEFO Expiry Radar, reorder→PO prefill, carton break (FR-318/FR-322).
- **Deferred:** the *presentation* of the four items above → M6 (release hardening: printing surface + stocktake flow + margin UI are UI/printer concerns on top of ready schemas); adjustment PIN-gating → M4 with roles (DEV-003 pattern — the action is functional now, the gate bolts on without a data-model change).
- **Rationale:** keeps M3 to the inventory core loop the register depends on (stock truth, expiry risk, replenishment); the deferred items need no schema work when they land.
- **Acceptance-test impact:** M3's stocktake/label rows are satisfied at M6; "applies via PIN" is satisfied at M4. PO create + receive + FEFO radar + carton break verified on-device in M3.
- **Resolution (M4, 2026-10-30):** stock adjustment "applies via PIN" now live — `AdjustStockDialog` gates `stock_adjust` for cashiers (nested PinPrompt over the dialog, single-action). The four UI items (stocktake flow, label printing, margin-compression UI, PO print/share) remain deferred to M6 as documented.
