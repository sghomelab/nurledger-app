# Requirements — NurLedger

The **authoritative spec** lives outside this repo
(`~/.hermes/projects/03-nurlogic/nurledger/spec/
nurledger-requirements-design.md`, with `handoff/PROTOTYPE-REFERENCE.md`
as the layout authority and `handoff/ADRs.md` as append-only
decisions). This file is the in-repo **status** of those
requirements — what 1.0.0 shipped, what was decided at release, and
what is explicitly deferred. FR → file/test detail: `FR-COVERAGE.md`.

## Non-negotiables (from the build prompt — all held in 1.0.0)

- App id `com.nurlogic.nurledger`, display name **NurLedger**.
- **Offline-first** — the register never blocks on the network; all
  reads/writes hit local SQLite; sync is an outbox.
- **Money = integer minor units + ISO currency. Never float.**
- **Immutable stock ledger** — no UPDATE/DELETE paths, ever; stock
  is a projection (ADR-002).
- **FIFO cost layers** — oldest layer consumed first (ADR-003).
- **No hardcoded country/tax** — locale behaviour via engines
  (TaxEngine / PaymentMethods / BarcodeParser).
- KitePOS-faithful layout: 5 tabs (Sell · Inventory · Expiry ·
  Insights · Shift), Plus Jakarta Sans + JetBrains Mono (ADR-005).

## 1.0.0 release status (2026-11-09, submitted to both stores)

**44 of 50 tracked FRs are fully implemented and device-verified;
the remainder are explicit v2 deferrals (below) or schema-only.**
No FR was silently dropped — each deferral is logged in
`SPEC-DEVIATION.md` or decided here.

| Domain | FRs | 1.0.0 status |
|---|---|---|
| Register & checkout | FR-101, 102, 103, 104, 105, 107, 108, 109 | ✅ (FR-109 = on-screen receipt + label print; **physical ESC/POS print + re-print → v2**) |
| Held / parked orders | FR-106 | 🔜 **v2 — decision taken 2026-11-09** (schema exists, no UI, never built; one active order at a time is the shipped behaviour) |
| Camera scan | FR-100 | 🔜 **v2** (no camera permission in the release build by design; keyboard-wedge + typed barcodes + scale barcodes cover scanning) |
| Refunds | FR-110, 111 | ✅ line-level, per-line restock, PIN-gated, exact full-refund invariant, cross-device synced |
| Languages | FR-115 | ✅ **EN + Bahasa Melayu + Filipino** (device-local toggle, persisted, compiler-enforced parity) |
| Shifts | FR-200…204 | ✅ open/close + float, cash in/out, X/Z-reports, fully offline |
| Inventory | FR-300, 302, 303, 304, 305, 306, 307, 308, 313, 314, 316, 317, 318, 319, 320, 321, 322 | ✅ (products, real-time stock, single-outlet-ready schema, stocktake, low-stock, PO + receive, lot/expiry + FEFO, reorder→PO, supplier, CSV, immutable ledger, labels, carton break, FIFO, per-line COGS, dual barcodes, margin compression) |
| Transfers | FR-315 | schema-ready, no v1 UI (v1 is single-outlet) — v2 |
| Back office | FR-400, 401, 403 | ✅ KPIs (net + extended), Payment Mix, top SKUs, sales history + search + CSV |
| Roles & auth | FR-500, 501 | ✅ Owner/Manager/Cashier, 7 PIN gates, progressive 4–8 matching (CR-15), salted-hash storage |
| Sync | FR-502, 503, 504, 505, 506 | ✅ BYO Supabase (ADR-010), idempotent outbox, deltas + LWW + audit, 2-device convergence (9/9 E2E), Supabase Auth for owners, RLS per tenant |
| Locale engines | FR-600, 601, 602, 603, 604 | ✅ any-ISO currency, per-locale payment methods (incl. PH: GCash/Maya/QR Ph), tax presets + custom (incl. **PH VAT 12% incl**), scale barcodes, 58/80mm receipt layout (physical print → v2) |
| E-invoicing | FR-605 | interface scope only — v2 |

### Release-time decisions (2026-11-09)

- **FR-106 → v2.** The only open FR with a schema but no UI and no
  plan — explicitly parked rather than half-shipped.
- **Known issue KNOW-1 (opening-float 10× input) shipped open** —
  reported on the production build during the 1.0.0 smoke test,
  disclosed in `RELEASE-NOTES.md` → Known issues, fix + audit
  committed to 1.0.1 (`TODO.md`).
- **First-release review states** — iOS `WAITING_FOR_REVIEW`,
  Android production rollout started (Google first-release review);
  both verified via store APIs, never the CLI.

### Verification record at submission

- tsc 0 errors; **jest 544/544** (up from 392 at Post-M6 — code
  review remediation + insights work).
- Production-AAB smoke test on AVD: full register day (sell → refund
  → PIN gates → offline sale → X/Z-report) + language check —
  `docs/handoff/reports/0003-report.md`.
- Store screenshots captured at exact App Store resolutions
  (iPhone 1290×2796, iPad 13" 2064×2752) from the production
  universal APK.

## Deferred to v2 (explicit)

- FR-100 camera scan · FR-109/FR-604 tail physical ESC/POS print +
  re-print · FR-106 held/parked orders · FR-605 e-invoicing ·
  FR-315 transfers UI · loyalty (NFR-9 consent flow).
