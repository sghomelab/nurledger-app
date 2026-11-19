# AGENTS.md — NurLedger

Offline-first POS + inventory for small grocery shops. **by NurLogic — nurlogic.ai**

## Non-negotiables (from the build prompt)

- App id `com.nurlogic.nurledger`. Display name **NurLedger**.
- **Offline-first** — the register must never block on the network. All reads/writes hit local SQLite (`expo-sqlite`); sync is an outbox (M5).
- **Money = integer minor units + ISO currency. Never float.** (`src/lib/money.ts`)
- **Immutable stock ledger** (`stock_ledger`) — no UPDATE/DELETE paths, ever. Stock = projection. (ADR-002)
- **FIFO cost layers** — selling prices owner-set & stable; COGS consumed oldest-layer-first. (ADR-003)
- No hardcoded country/tax — locale behavior via engines (TaxEngine/PaymentMethods/BarcodeParser, M5). Reference locale: SG/SGD/GST 9% inclusive.
- Layout/nav follows the KitePOS prototype (ADR-005): 5 tabs **Sell · Inventory · Expiry · Insights · Shift**, Plus Jakarta Sans + JetBrains Mono, indigo-600/emerald-600/amber-500/rose-500/slate.

## Development & Release Process (RULE)

Full spec: `docs/DEV-PROCESS.md`. Reference example: **PR #28**.

- **Feature request with design decisions** → reply with the three gates, then push the request to a **design-doc PR before any code** (`design/<topic>-<issue#>` branch, `docs/<TOPIC>-DESIGN.md` with decisions log, open items, release plan, verification plan). **PR merge = design approved** → then an implementation PR against the doc.
- **No design decisions** (bug fix / hotfix / small change) → work **direct on `main`**.
- **Three gates, three of Mas's say-so's** — (1) Design = merge the PR → (2) Build = explicit build GO in the current conversation → (3) Release = Mas's word. **Merging a PR never triggers a build.** "Ship it" / "release" = prepare and STOP at the queue line.
- **Pre-build question sweep (2026-11-19, after the 1.2.0 §6 incident):** before queueing ANY build, list every open decision item that affects what goes in that build — design-doc open items, scope questions, pending calls — and get Mas's explicit answer or explicit deferral for each **in the current conversation, before the build GO is acted on**. A documented default ("needs GO to include") is NOT a substitute for his explicit deferral. Never queue a build while a scope-relevant question is unanswered — an unanswered question risks a follow-up build, which wastes credits. The question costs nothing; the wasted build doesn't come back.
- **Zero EAS build credits without Mas's explicit build GO in the current exchange.** Both platforms from the same commit; one hypothesis per build.

## Stack

Expo SDK 58 / RN 0.88 / React 19.3 / expo-router / expo-sqlite (ADR-009 supersedes ADR-001's Flutter+Drift; SDK 57→58 upgrade in `afa92bd`). Metro port **8186**.

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

- `docs/DEV-PROCESS.md` — development & release process (RULE — see section above)
- `docs/FR-COVERAGE.md` — update when implementing any FR (audited per milestone)
- `docs/SPEC-DEVIATION.md` — log spec conflicts as DEV-NNN
- Claude ↔ OpenCode handoffs go through the repo — see `docs/handoff/README.md` (tasks in `docs/handoff/`, reports in `docs/handoff/reports/`)
- Spec + handoff: `/home/mars/.hermes/projects/03-nurlogic/nurledger/`
