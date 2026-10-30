# Nurledger

**Offline-first POS + inventory for small grocery/provision shops — by Nurlogic.ai.**

Every movement flows through an immutable, append-only stock ledger; stock on hand is a
projection of that ledger. The app runs a full day offline — selling, stock decrement,
shifts — and syncs opportunistically (M5).

## Status

| Milestone | Scope | State |
|---|---|---|
| **M1** | Foundation: schema, design tokens, product CRUD, seed (11 products), 5-tab nav | ✅ done |
| M2 | Register: scan → cart → payment → receipt, offline decrement, kill test | next |
| M3 | Inventory & Expiry: adjustments, PO + receive, Expiry Radar, stocktake | |
| M4 | Shifts + Insights: open/close, Z-report, dashboards, CSV exports | |
| M5 | Cloud & sync: Supabase, idempotent outbox, multi-device | |
| M6 | Hardening: refunds, labels, i18n, store packaging | |

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

- `docs/FR-COVERAGE.md` — FR → files/tests, audited per milestone
- `docs/SPEC-DEVIATION.md` — where we deviate from spec, and why
- ADRs: `/home/mars/.hermes/projects/03-nurlogic/nurledger/handoff/ADRs.md` (append-only)
