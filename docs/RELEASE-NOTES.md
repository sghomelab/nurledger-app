# Release Notes — NurLedger

Store releases for the iOS App Store and Google Play. Per-milestone
development history (M1–M6 + Post-M6) lives in `MILESTONE-REPORTS.md`;
FR → file/test mapping lives in `FR-COVERAGE.md`.

---

## 1.0.0 — submitted (2026-11-09): first release

> Status (2026-11-09): **iOS 1.0.0 (build 3) is `WAITING_FOR_REVIEW`
> on App Store Connect; Android 1.0.0 (vc3) production rollout STARTED
> (`status=completed` via Play API, 100%), in Google's first-release
> review — becomes Available when it clears.** Both built 2026-11-09
> from the SAME commit `f40d0ce` (two EAS production builds, the only
> 1.0.0 builds — Mas's GO with all three gate elements: ASC app id,
> Play app + SA, credit balance $19). EAS `5d5508e7-e84d-4577-83f8-2f586987ad85`
> (Android) / `0c0adea6-b985-4bfc-9608-e9275d96c845` (iOS). Real
> artifact numbers verified from the files, not the CLI: AAB
> `versionCode 3` / `versionName 1.0.0`; IPA `CFBundleVersion 3` /
> `1.0.0` (configured 2 → EAS autoIncrement → 3; app.json sync
> committed `0957853`). Gates at build time: tsc 0 errors; jest
> 544/544; full smoke test on the production AAB (below).
>
> - **Android (vc3):** internal track first (verified
>   `status=completed`, not halted), then store presence completed via
>   Play API (title 30c, short 80c + full description 1368c — same
>   copy as iOS, icon 512×512, feature graphic 1024×500, 3 phone
>   screenshots), privacy policy `https://nurlogic.ai/privacy` +
>   website `https://nurlogic.ai` + release notes (445 chars) set in
>   the console, and Mas clicked "Start rollout to production" (the
>   FIRST production publish on a draft app is console-only — Play
>   API refuses it; see `LESSONS-LEARNT.md`). Verified: `production →
>   1.0.0, vc3, status=completed`. The app is now "activated" — all
>   future Android releases are API-automatable.
> - **iOS (build 3):** `eas submit --path nurledger.ipa` → binary
>   VALID in ASC (build `7ae4d0ee-1837-49f0-b9fb-cfa91f52d9ea`);
>   manual ASC REST recipe (EAS's auto version-create did not
>   complete — the existing placeholder version "1.0" was renamed to
>   1.0.0 and build 3 attached; creating a new version 409'd while
>   the placeholder existed in preparation). All API-reachable
>   metadata set + re-read: description, keywords (69c), supportUrl,
>   copyright, privacyPolicyUrl, subtitle "Offline POS & Stock",
>   contentRights, full age-rating questionnaire → 4+,
>   appStoreReviewDetails. Six console-only blockers cleared by Mas
>   (pricing Free, primary category Business, app-privacy data-usage
>   answers, review contact, demo account off, screenshots).
>   Screenshots were captured on the production universal APK on
>   exact-resolution AVDs (iPhone 1290×2796 `APP_IPHONE_67` ×3,
>   iPad 13" 2064×2752 `APP_IPAD_PRO_3GEN_129` ×2) and uploaded via
>   the ASC API. Submitted → verified `WAITING_FOR_REVIEW`. Awaits
>   Apple's review (typically 24–48h); if rejected → Resolution
>   Center reply (web UI only) then API resubmit.

**What's in 1.0.0** — the complete first-release feature set, built
across M1–M6 + Post-M6, each device-verified (see `FR-COVERAGE.md`
for the FR → files/tests audit and `MILESTONE-REPORTS.md` for the
evidence):

- **Register (M2)** — scan (keyboard-wedge/typed, incl. carton
  barcodes) or search; weighed items via scale barcodes (grams,
  per-kg rates); cart with qty/line-discount/order-discount; cash
  (tender/change), card, mobile, QR (reference stub), split payments;
  on-screen receipts; FIFO cost + live margin on every line; stock
  decrements in the same atomic transaction as the sale — **offline**.
- **Inventory (M3/M6)** — product detail (margin %, min/max,
  velocity, lots, ledger tail); stock adjustments with required
  reason; blind/visible stocktake (PIN-gated apply); purchase orders
  with batch receiving → lots + FIFO cost layers, carton break,
  supplier master, PO share; label printing (58mm roll / A4, real
  scannable barcodes); CSV import/export with row-level validation;
  margin-compression warnings with suggested price (never
  auto-applied).
- **Expiry (M3)** — FEFO radar: batches ranked nearest-expiry first,
  colour-coded urgency, expiry-waste totals.
- **Insights (M4/Post-M6)** — KPI cards (net basis) + extended KPIs
  (markup, turnover, GMROI, shrinkage, fill rate…) for Today /
  Current period / All time; Payment Mix tile; top sellers
  (velocity/ABC); stockout forecast; searchable sales history + CSV
  export; refunds start here (line-level qty ≤ sold, reason required,
  per-line restock, PIN-gated; exact full-refund invariant; Z-report
  Refunds line).
- **Shifts (M4)** — open with float (register locked when closed),
  cash in/out with reason, X-report anytime, close → counted vs
  expected → over/short/exact + persisted Z-report; fully offline.
- **Roles & PINs (M4/Post-M6)** — Owner/Manager/Cashier; 7
  PIN-gated actions (discounts, price overrides, stock adjust,
  stocktake apply, refunds, close shift, settings); progressive
  4–8 digit PIN matching (CR-15); salted-hash storage; single-action
  unlocks, never persisted.
- **Cloud sync (M5/M6/Post-M6, optional, OFF by default)** — BYO
  Supabase (ADR-010: the store owns its own free project; the vendor
  never sees the data); idempotent outbox (client UUIDs); pull
  deltas with LWW + audit; stock recomputed server-side, never
  client-merged; two-device convergence proven (9/9 E2E); invite
  codes for extra devices; rejected-upload quarantine; in-app
  **Delete cloud account** (schema v8); lossless
  disconnect/reconnect.
- **Locale engines (Post-M3/M5)** — any ISO currency (zero-decimal
  aware), tax presets (SG GST 9% incl, MY SST 10% incl, EU VAT 21%
  excl, **PH VAT 12% incl**) + custom rates; per-locale payment
  methods (incl. GCash/Maya/QR Ph in en-PH); per-locale scale
  barcodes. Nothing is hardcoded to a country.
- **Languages (M6 + 1.0.0)** — UI in **English, Bahasa Melayu and
  Filipino**, device-local toggle, persisted, compiler-enforced key
  parity.
- **Packaging (M6/1.0.0)** — no special permissions (no camera, no
  Bluetooth); `allowBackup=false`; session token in the platform
  keystore; `ITSAppUsesNonExemptEncryption=false`; tablet support
  (iPad screenshots in the store listing); 544 unit tests.

**Smoke test (production AAB, cs-test AVD, 2026-11-09)** — all
flows from the real release binary: first run + sample data → open
shift → sell (SGD 8.50, 9% GST incl, FIFO margin 54%) → tender
change → refund (reason sheet, restock 21→22) → PIN gates (owner→
cashier no PIN, cashier→owner PIN, wrong PIN rejected) → Insights
consistency → **offline sale with wifi+data disabled** → X-report →
close shift + Z-report (variance 0.00 Exact) → Settings language
(EN/BM/Fil all present). Full detail:
`docs/handoff/reports/0003-report.md`.

### Store "What's new" (Android, 445 chars — read back from the Play API)

```
NurLedger 1.0.0 — offline-first POS & inventory for small grocery stores.

• Fast checkout: barcode scan, cash with auto change, recorded card/QR/e-wallet
• Live stock with FIFO cost & margin, stocktakes, expiry radar
• One-tap refunds with restock + return reasons
• Shifts with X- and Z-reports and cash variance
• PIN-protected owner, manager & cashier roles
• Works with zero internet; optional cloud sync

English · Bahasa Melayu · Filipino
```

(iOS has no "What's new" on a first version — `whatsNew` is
persistently `409` in this ASC API version and is optional for v1.)

### Not verified before submission (stated per spec)

- **Real iPad / iPhone device checks** — store screenshots came from
  exact-resolution Android AVDs (RN UI renders platform-identically);
  hardware verification remains a §8 gate before widening beyond
  internal testers.
- **Cloud setup wizard on a live Supabase project** — verified only
  against a local Supabase instance (two-device E2E, 9/9); the
  hosted-project path (DNS, email confirmation, free-plan pause) is
  untested.
- **Release-build hygiene** (no dev menu, `allowBackup=false`,
  minimal permissions) was passed on a clean 1.0.0 APK in a prior
  task; config unchanged since.

### Known issues

- **KNOW-1 (fix in 1.0.1):** the shift **opening-float** numeric
  field places the cursor at index 0 (before the initial "0" of
  "0.00"), so typed digits **prepend** and a typed value N is stored
  as **10×N** (typed 100 → "1,000.00" persisted on the shift card).
  Reproducible on the production build; state-dependent (the
  close-shift counted-cash field behaved correctly in one pass).
  Money-amount input bug — must be fixed before any real store use.
  Full repro + the audit of other controlled numeric fields:
  `TODO.md`.
