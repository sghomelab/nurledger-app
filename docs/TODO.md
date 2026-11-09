# TODO / Roadmap

_Last updated: 2026-11-09 — **1.0.0 submitted to both stores**
(iOS build 3 `WAITING_FOR_REVIEW`; Android vc3 production rollout
started, first-release review pending). Store states are tracked in
`RELEASE-NOTES.md`; this file is what to do next._

## 1.0.1 (next patch)

- [ ] **Fix KNOW-1: opening-float 10× input bug** — the numeric field
      initializes "0.00" with the cursor at index 0, so typed digits
      prepend (typed `100` → stored `1000.00`). Root-cause the
      controlled-input pattern in the shift open dialog
      (`app/(tabs)/shift.tsx`) and fix it so input replaces the
      initial value.
- [ ] **Audit every other controlled numeric field** for the same
      cursor-at-0 / prepend pattern (close-shift counted cash
      behaved differently in one pass — it is state-dependent, so it
      is not exonerated): float, counted cash, product cost/price,
      min/max, PO qty/cost, stocktake counts, discount amounts. Add a
      regression test that fails without the fix.
- [ ] Re-verify both gates (tsc 0, jest green) + a device smoke of
      the shift open/close cycle.
- [ ] Ship only on Mas's build GO (one hypothesis per build; quota
      check on the expo.dev dashboard first).

## Open release gates — before widening beyond internal testers (§8)

1.0.0 went out to internal tracks + public first-release review
while these were still open (documented in `RELEASE-NOTES.md` →
"Not verified before submission"). They must clear before inviting
beyond the first testers:

- [ ] **Real iPad + iPhone device checks** — tablet layout pass
      (`supportsTablet: true` is in the shipped build; iPad
      screenshots are in the store listing), plus the iOS-only paths
      (share sheets, keyboard behaviour, secure-store sign-in
      restore).
- [ ] **Cloud wizard on a hosted Supabase project** — a live run of
      the whole wizard (sign-up → project → script → claim code →
      owner login → sync ON → second device via invite code) on a
      throwaway hosted project; also the free-plan
      pause/wake path.
- [ ] **Real-device failure paths** — flaky network mid-drain,
      server-side rejects mid-batch (rejected-upload quarantine UX),
      pull with a stale local schema (upgrade-script prompt).
- [ ] **Native-speaker review of Filipino + Bahasa Melayu** — both
      dictionaries were written by the developers; a native review
      is the §8 gate.
- [ ] **Legal sign-off** — PH: not a BIR-registered receipting
      system (wording in the guide + store listings), Data Privacy
      Act duties of the store owner; PDPA/GDPR-lite posture (NFR-9)
      of the BYO-cloud design.
- [ ] **Support process + tester triage** — `https://nurlogic.ai/support`
      is live; define who answers and how tester reports (the §7
      briefing text in `docs/handoff/reports/0003-report.md`) get
      triaged.

## v2 (explicitly out of 1.0.0)

- **FR-100 — camera scan** (MLKit / `expo-camera`). The release
  build ships no camera permission by design; keyboard-wedge + typed
  barcodes + scale barcodes cover scanning.
- **FR-109 / FR-604 tail — physical ESC/POS printing + re-print from
  history.** On-screen receipts (58/80mm) + printable label/PO
  files cover printing without hardware.
- **FR-106 — held / parked orders.** The schema exists, there is no
  UI, and it was never built — **decision taken at the 1.0.0 docs
  sync (2026-11-09): parked for v2**, not a v1 gap. (One active
  order at a time is the shipped behaviour.)
- **FR-605 — e-invoicing adapters** (interface scope only).
- **FR-315 — stock transfers between outlets** (schema-ready, no
  v1 UI — v1 is single-outlet).
- **Loyalty** (NFR-9 consent flow) — out of launch scope; nothing
  collects loyalty data yet.

## Engineering debt

- CI for the 544-test suite (currently run on the dev machine).
- `app/(tabs)/insights.tsx` is a large screen; the Payment Mix tile
  is not i18n'd (the Insights tab is outside the M6 i18n sweep by
  convention — English chrome, business-locale data).
