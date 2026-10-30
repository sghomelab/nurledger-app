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

## DEV-003 — Price-override / discount PIN-gating deferred to M4 (2026-10-30)
- **Spec/FR said:** price override (FR-105 order-level, and per-line "Adjust Price") are manager-PIN-gated.
- **Implemented (M2):** the actions are fully functional (per-line price adjust, per-line + order discount) but NOT yet PIN-gated — there is no roles/PIN system in M2.
- **Rationale:** roles + PIN-gating (Store Manager / Shift Lead / Cashier) is a discrete M4 concern (shift + back office). The math and UI path land in M2 so the register is complete; the gate is bolted on in M4 without changing the data model.
- **Acceptance-test impact:** the "manager PIN" clause on FR-105 is satisfied in M4, not M2.

## DEV-004 — Camera scan + weighed items + EAN-13 parse scoped to M5 (2026-10-30)
- **Spec/FR said:** FR-100 camera scan (MLKit), FR-103 weighed items (weight × unit price), FR-104 embedded-weight EAN-13 parse (per-locale BarcodeParser engine).
- **Implemented (M2):** manual barcode entry + keyboard-wedge scan (FR-101/FR-102) + tap-to-add from search — the register is fully usable offline. The camera button is a visible stub (explains the deferral); weighed `qty` is held as base units.
- **Rationale:** camera + scale + locale barcode parsing are hardware/locale engines that land with the M5 engines (TaxEngine / PaymentMethods / BarcodeParser per spec §4.4). Keeping M2 to "scan any way you can already scan" keeps the core loop shippable and testable now.
- **Acceptance-test impact:** the M2 "camera scan <300ms" and "weighed-item path" items re-scope to M5 (Expo `expo-camera` + BarcodeParser); M2 proves the offline core loop end to end.
