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
