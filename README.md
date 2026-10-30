# Nurledger

**Offline-first POS + inventory for small grocery/provision shops — by Nurlogic.ai.**

Every movement flows through an immutable, append-only stock ledger; stock on hand is a
projection of that ledger. The app runs a full day offline — selling, stock decrement,
shifts — and syncs opportunistically (M5).

## Status

| Milestone | Scope | State |
|---|---|---|
| **M1** | Foundation: schema, design tokens, product CRUD, seed (11 products), 5-tab nav | ✅ done (tag `m1`) |
| **M2** | Register: scan → cart → payment → receipt, offline FIFO decrement, kill survival | ✅ done (tag `m2`) |
| **M3** | Inventory & Expiry: product detail + adjustments (reason required), PO create + receive in batches, FEFO Expiry Radar, reorder→PO, carton break (FR-318/FR-322) | ✅ done (tag `m3`) |
| **Post-M3** | Multi-currency + configurable tax locale (FR-600/FR-602): Store settings screen, any ISO currency (incl. zero-decimal JPY/KRW/VND display), tax presets + custom rate, `PickerOverlay` replacing 4 pickers broken by RN's 3-button Alert limit (incl. 2 latent M1/M3 bugs) | ✅ done (standalone commit) |
| **M4** | Shifts & back office: open/close (float, counted cash, over/short), Z-report, KPI dashboards, CSV exports + PIN/role gating for adjustments & price overrides | next |
| **M5** | Cloud & sync: Supabase, idempotent outbox sync, server-side stock recompute, multi-device, locale engines (PaymentMethods/Barcode/receipt; Tax + currency done Post-M3) | |
| **M6** | Release hardening: line-level refunds, stocktake UI, label printing, margin UI, PO print/share, i18n, Play/App Store packaging | |

Deferred M3→M6 (DEV-005): stocktake UI, label printing, margin-compression UI, PO print/share.
Adjustment/price PIN-gating → M4 (DEV-003). Details: `docs/MILESTONE-REPORTS.md` + `docs/SPEC-DEVIATION.md`.

Full requirements: `/home/mars/.hermes/projects/03-nurlogic/nurledger/spec/nurledger-requirements-design.md`
(prototype layout authority: `handoff/PROTOTYPE-REFERENCE.md`).

## Stack

- Expo SDK 57 · React Native 0.86 · expo-router · **expo-sqlite** (offline-first, ADR-002)
- Money: integer minor units + ISO currency (ADR-004) · Costing: FIFO layers (ADR-003)
- Design: Plus Jakarta Sans + JetBrains Mono, indigo-600/emerald-600/amber-500/rose-500/slate

## Dev

```bash
npm install
npx tsc --noEmit      # typecheck
npx jest              # unit tests (money, FIFO, stock projection, seed contract)
npx expo start        # Metro (port 8186 for this app)
npx expo run:android  # local emulator build (no EAS credits)
```

## Docs

- `docs/MILESTONE-REPORTS.md` — per-milestone change log + exit-test results (real device output)
- `docs/FR-COVERAGE.md` — FR → files/tests, audited per milestone
- `docs/SPEC-DEVIATION.md` — where we deviate from spec, and why
- ADRs: `/home/mars/.hermes/projects/03-nurlogic/nurledger/handoff/ADRs.md` (append-only)
