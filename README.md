# Nurledger

**Offline-first POS + inventory for small grocery/provision shops — by Nurlogic.ai.**

Every movement flows through an immutable, append-only stock ledger; stock on hand is a
projection of that ledger. The app runs a full day offline — selling, stock decrement,
shifts — and syncs opportunistically (M5).

## Why it's built this way (ethos)

- **Offline-first, always.** The register must never wait on the network. Every read and
  write hits local SQLite; a full day of selling, stock decrements and shift close works
  with zero connectivity. Sync is an outbox (M5) that drains when it can.
- **The owner owns the data.** There is no Nurledger backend. Cloud sync is **BYO
  Supabase** (ADR-010 / DEV-006): the store points the app at *its own* free Supabase
  project, so the data lives under the owner's account — the vendor never sees it, and
  deleting the project deletes it. Sync is off by default.
- **Money is exact.** All amounts are integer minor units + ISO currency (ADR-004). No
  floats, no rounding drift; split payments are allocated so the parts always sum to the
  total exactly.
- **Stock is explainable, forever.** The stock ledger (ADR-002) is append-only with no
  UPDATE/DELETE paths, ever. Stock on hand is a *projection* of the ledger, so any number
  can be traced line by line to the movements that produced it (receiving, sales,
  adjustments, stocktakes).
- **Costs are real.** Selling consumes FIFO cost layers (ADR-003), oldest lot first, so
  COGS and gross margin reflect the actual cost of the batches sold — not an average or
  an estimate.
- **Locale is data, not code.** Nothing is hardcoded to a country: currency, tax regime
  (inclusive/exclusive, any rate) and payment methods are per-outlet settings driven by
  locale engines (TaxEngine / PaymentMethods / BarcodeParser). One build, any country.
- **No special permissions.** The release build asks for nothing — no camera, no
  Bluetooth. Scanning is via keyboard-wedge scanners or typed barcodes; printing
  (receipts, labels, POs) is generated files printable on any device.
- **Prototype-faithful.** Layout and navigation follow the KitePOS prototype (ADR-005):
  five tabs (Sell · Inventory · Expiry · Insights · Shift), Plus Jakarta Sans +
  JetBrains Mono, indigo-600/emerald-600/amber-500/rose-500/slate.

## Status

| Milestone | Scope | State |
|---|---|---|
| **M1** | Foundation: schema, design tokens, product CRUD, seed (11 products), 5-tab nav | ✅ done (tag `m1`) |
| **M2** | Register: scan → cart → payment → receipt, offline FIFO decrement, kill survival | ✅ done (tag `m2`) |
| **M3** | Inventory & Expiry: product detail + adjustments (reason required), PO create + receive in batches, FEFO Expiry Radar, reorder→PO, carton break (FR-318/FR-322) | ✅ done (tag `m3`) |
| **Post-M3** | Multi-currency + configurable tax locale (FR-600/FR-602): Store settings screen, any ISO currency (incl. zero-decimal JPY/KRW/VND display), tax presets + custom rate, `PickerOverlay` replacing 4 pickers broken by RN's 3-button Alert limit (incl. 2 latent M1/M3 bugs) | ✅ done (standalone commit) |
| **M4** | Shifts & back office: open/close (float, counted cash, over/short), Z/X-reports, KPI dashboards (net + extended), P&L, Velocity/ABC, stockout forecast, expenses, sales history + search, CSV exports, PIN/role gating (5 gates), cashier switch | ✅ done (tag `m4`) — seeded Owner PIN `1234` is a test fixture; set a real PIN before any real use |
| **M5** | Cloud & sync: **BYO Supabase** (store owns its own backend — ADR-010/DEV-006), idempotent outbox sync (product/stock/sale, LWW + audit), server-side stock recompute, two-device convergence, locale engines (PaymentMethods/Barcode/receipt 58-80mm; Tax + currency done Post-M3), weighed items (scale barcodes, stock in grams), lossless disconnect/reconnect | ✅ done (tag `m5`) — 9/9 two-device E2E tests passed (local Supabase + 2 emulators); design in `docs/SYNC-DESIGN.md`, walkthrough in `docs/USER-GUIDE.md` |
| **M6** | Release hardening: line-level refunds (PIN-gated, per-line restock, cross-device synced), stocktake (blind, PIN-gated apply), label printing (58mm roll / A4, scannable barcodes), supplier master, CSV import/export, PO print/share, margin-compression warnings, i18n EN + Bahasa Melayu, category sync (cloud schema v3 — fixed a real cross-device pull-stall bug), Play/App Store packaging prep | ✅ done (tag `m6`) — refunds verified cross-device (two emulators + BYO Supabase); camera + physical ESC/POS print deferred to v2; **no EAS build queued** (prep only) |
| **Post-M6** | Code review remediation: a full audit of M1–M6 (`docs/CODE-REVIEW.md`) found 15 findings (3 critical / 5 high / 5 medium / 2 low) — all fixed in three phases and closed: **Phase 1 (P0)** `323deac` — CR-01 exclusive tax omitted from sale total, CR-02 cloud RPC timestamps stranded offline sales (`synced_at`), CR-03 out-of-order refund reference created an unrecoverable pull loop, CR-10 order-discount proration, CR-11 delta pagination/ordering; **Phase 2 (P1)** `7213d4a` — CR-04 category remap FK stalls, CR-05 product-pull natural-key collision, CR-06 weighed PO receipts bypassed gram stock, CR-07 shortage adjustments desynced FIFO layers (deplete-all-layers + book shortage at current cost), CR-08 strict shift-stamped drawer math (legacy display figure preserved); **Phase 3 (P2)** `d3dbf1d` — CR-09 refunds in Insights/P&L (both bases, clamped, restock-only COGS reversal), CR-12 tx-wrapped product mutations, CR-13 CSV import planner, CR-14 payment-coverage guard in `completeSale`, CR-15 PIN entry (finding stale — progressive 4–8 matching already existed). Sign-off recorded `ab63cc5` | ✅ done — 15/15 findings closed; both open design decisions (CR-07 option 1, CR-08 strict drawer) **signed off by Mas 2026-10-31**; 316 → 388 tests; live verification caught a silent aliasing bug (see MILESTONE-REPORTS) |

M3→M6 deferrals (DEV-005) all landed in M6: stocktake UI, label printing, margin-compression UI, PO print/share. Remaining deferrals → v2: camera scan (FR-100) and physical ESC/POS print / re-print (FR-109/FR-604 tail) — the release build ships no special permissions. Details: `docs/MILESTONE-REPORTS.md` + `docs/SPEC-DEVIATION.md`.

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
