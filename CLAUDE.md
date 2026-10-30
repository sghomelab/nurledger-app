# AGENTS.md — Nurledger

Offline-first POS + inventory for small grocery shops. **Nurlogic.ai.**

## Non-negotiables (from the build prompt)

- App id `com.nurlogic.nurledger`. Display name **Nurledger**.
- **Offline-first** — the register must never block on the network. All reads/writes hit local SQLite (`expo-sqlite`); sync is an outbox (M5).
- **Money = integer minor units + ISO currency. Never float.** (`src/lib/money.ts`)
- **Immutable stock ledger** (`stock_ledger`) — no UPDATE/DELETE paths, ever. Stock = projection. (ADR-002)
- **FIFO cost layers** — selling prices owner-set & stable; COGS consumed oldest-layer-first. (ADR-003)
- No hardcoded country/tax — locale behavior via engines (TaxEngine/PaymentMethods/BarcodeParser, M5). Reference locale: SG/SGD/GST 9% inclusive.
- Layout/nav follows the KitePOS prototype (ADR-005): 5 tabs **Sell · Inventory · Expiry · Insights · Shift**, Plus Jakarta Sans + JetBrains Mono, indigo-600/emerald-600/amber-500/rose-500/slate.

## Stack

Expo SDK 57 / RN 0.86 / expo-router / expo-sqlite (ADR-009 supersedes ADR-001's Flutter+Drift). Metro port **8186**.

## Verification (after every code change)

1. `npx tsc --noEmit` — 0 errors
2. `npx jest` — all pass
3. User-flow changes: run on the `cs-test` AVD (`npx expo run:android`, JAVA_HOME=/home/mars/jdk/jdk-21.0.12.1+1, ANDROID_HOME=/home/mars/android-sdk) — **no EAS builds without Mas's explicit GO**
4. Then commit. One commit per milestone, tag `m1`…`m6`.

## Module map

- `src/db/` — schema, bootstrap, first-run seed
- `src/repositories/` — the only modules that touch SQL. `stockRepository` is the only writer of `stock_ledger`
- `src/lib/` — pure testable logic (money, stock math, ids). No imports of DB or RN
- `src/seed/` — prototype fixture data (PROTOTYPE-REFERENCE §9)
- `src/hooks/` — async data hooks over repositories
- `src/components/`, `src/theme/` — shared UI/tokens
- `app/` — expo-router screens only; keep screens thin

## Docs

- `docs/FR-COVERAGE.md` — update when implementing any FR (audited per milestone)
- `docs/SPEC-DEVIATION.md` — log spec conflicts as DEV-NNN
- Spec + handoff: `/home/mars/.hermes/projects/03-nurlogic/nurledger/`
