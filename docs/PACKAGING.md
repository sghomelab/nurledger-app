# PACKAGING — NurLedger (M6, store-submission prep)

Status: **prepared, not queued.** No EAS build or store submission has been
queued for this app; everything below is readiness + the exact runbook for
when Mas gives the GO. (Red line: "ship/prepare" ≠ build GO.)

## 1. App identity

| Field | Value |
|---|---|
| Display name | NurLedger |
| App id / bundle id | `com.nurlogic.nurledger` |
| Version (first store release) | **1.0.0** (set in app.json for both platforms in one commit; do not change it per platform) |
| Android versionCode | 2 for 1.0.0 (set in app.json; EAS `autoIncrement` raises it on later builds). Verify from the built artifact |
| iOS buildNumber | "2" (set in app.json; EAS builds `max(configured, store-max)+1`; verify actual from the IPA `Info.plist`) |
| Platform minimums | Android 7.0+ (API 24, the Expo SDK 58 / RN 0.88 default, measured in the 1.0.0 build; the original spec said Android 10+, supporting older devices is intentional unless you raise `minSdkVersion`), iOS 14+ (spec; verify in the generated project) |
| Deep link scheme | `nurledger://` (dev-client URL) |

## 2. Build profiles (`eas.json`)

| Profile | Purpose | Notes |
|---|---|---|
| `development` | internal dev-client builds | `developmentClient: true`, channel `development` |
| `preview` | internal QA / stakeholder previews | internal distribution, channel `preview` |
| `production` | store builds | `autoIncrement: true`, channel `production` |

`appVersionSource: "local"` — versions come from `app.json`, not EAS
auto-versioning. All build profiles set `credentialsSource: "remote"`
(explicitly in eas.json; `remote` is also EAS's default).

## 3. Store-asset readiness

- **Icon:** `assets/icon.png` (1024) + Android adaptive (foreground/background/monochrome) + iOS `icon` from the same `icon.png` — present.
- **Splash:** `assets/splash-icon.png` on `#4F46E5` (indigo-600), `contain` — present.
- **Permissions:** **none special.** No camera (FR-100 deferred — scanner wedge /
  manual entry only), no Bluetooth (FR-109 physical printer deferred — on-screen
  receipt + share-to-file), no location, no storage (share sheet via the system
  `FileProvider`/`UIActivityViewController` — verified working on-device in
  C1/L1/P1). Play Data Safety + App Store privacy labels can therefore claim
  **no data collected by the app itself** (see §5 for the BYO-cloud nuance).
- **Encryption:** `ITSAppUsesNonExemptEncryption: false` already declared
  (HTTPS-only, no custom crypto).
- **Localization:** UI ships English + Bahasa Melayu + Filipino (Tagalog) (FR-115,
  device-local toggle — no store-side localization metadata required for launch;
  all strings are in-app, not in store-listing metadata).

## 4. Store submission runbook (on GO)

1. **Version bump commit first** (Apple version-train rule): `1.0.0` is set
   in `app.json` (`version`, plus the Android `versionCode`; iOS `buildNumber`
   is raised by EAS), committed + pushed. BOTH platforms build from the SAME
   commit.
2. **Check quota** — free-tier credit balance is visible ONLY on the
   expo.dev dashboard (no CLI). If unknown, stop and ask Mas. One hypothesis
   per build.
3. Queue: `eas build --platform android --profile production --non-interactive`
   and `--platform ios` from the same commit.
4. Verify actual build numbers from the artifacts (IPA `Info.plist` / AAB
   manifest), then sync `app.json` to the actuals in a follow-up commit.
5. **Google Play:** shared service account
   `play-store-uploads@ai-agent-497901.iam.gserviceaccount.com` — copy the key
   to `secrets/` (gitignored). **Release-time step (Mas):** the `eas.json`
   android submit profile currently sets only `channel: internal` — set
   `serviceAccountKeyPath` there to that Play service-account JSON key in
   `secrets/` BEFORE running `eas submit --platform android --path <aab>
   --non-interactive`. Verify via Play API (`tools/play_check.py
   com.nurlogic.nurledger`; `halted` = rejected).
   **UI-only, Mas:** Play Console → app creation + content rating +
   data-safety form + privacy-policy URL (`https://nurlogic.ai/privacy` —
   add NurLedger to the privacy worker first).
6. **Apple:** `eas submit --platform ios --path <ipa> --non-interactive` with
   the working ASC key in the eas.json submit config. For a NEW app Mas first
   creates the app in App Store Connect (UI) and provides the `ascAppId`.
   Verify via ASC API + TestFlight — never trust `finished`.
7. Store listings: app name "NurLedger", short description, description,
   keywords, category **Business** (both stores), screenshots (Sell / Inventory / Expiry /
   Insights / Settings, 6.1" portrait).

## 4a. Store-policy items (review 2026-11-06 — see nurledger-store-readiness-review.md)

- **Account deletion:** in-app **Settings → Cloud sync → Delete cloud account…**
  (schema v8 `delete_my_account`; members delete their own sign-in, the owner also
  erases the store's cloud data). Mention this path in the Apple review notes and the
  Play Data-safety "account deletion" answer. Needs cloud schema v8 on the store's
  project (the wizard's upgrade step re-runs the idempotent script).
- **Tablets:** `ios.supportsTablet: true` is kept on purpose (dense screens) — this
  REQUIRES iPad screenshots and an iPad/large-screen layout pass before submission.
- **Session token** now lives in the platform keystore (`expo-secure-store`,
  Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` / Android Keystore); Android backup is
  disabled (`allowBackup=false`) — local data is NOT restored from a device backup, so
  tell users to enable cloud sync or export CSV.
- **Submit config:** `eas.json` now has `submit` profiles; the iOS one still needs the App Store Connect app id (`ascAppId`) once the app exists, and the
  android one has no `serviceAccountKeyPath` yet (release-time step — see runbook step 5). Check the Play
  service account and ASC key before step 5/6 of the runbook.

## 4b. Philippines (first target store, 2026-11-07)

- Tax preset **Philippines VAT 12% — inclusive** (`flat:ph-vat-12-inclusive`, PHP, `en-PH`);
  payment labels Cash / Card / **GCash / Maya** / **QR Ph** (recorded tenders, not
  processed). Rate and VAT-exempt/zero-rated treatment: confirm with the store's accountant.
- **Not a BIR-registered receipting system.** The on-screen receipt is an internal record, not
  a BIR-registered invoice/official receipt. Whether a POS needs BIR registration/permit and
  how e-invoicing applies is unresolved (sources conflict) — the store must confirm with its
  accountant/BIR before relying on the app as its official till. Do not market the app as
  BIR-compliant.
- Philippine Data Privacy Act obligations of the store owner: legal owner to advise.

## 5. Privacy posture (PDPA/GDPR-lite, NFR-9)

- **Offline-first:** all sales/stock live in local SQLite. The network is
  never required for a sale.
- **BYO cloud (ADR-010):** sync goes to the store's OWN free Supabase
  project — the vendor (NurLogic) does not host or access store data. The
  only remote calls are to the store's own Supabase project (REST + JWT).
  A self-hosted Supabase must be reachable over HTTPS; release builds block
  plain http (only local-development addresses are accepted in debug builds).
- **No analytics, no crash reporting, no ad SDKs, no PII collected.**
  Cashier names are user-entered labels, not identifiers, and stay local /
  in the store's own project.
- **Data deletion:** in-app **Delete cloud account…** erases the caller's cloud
  sign-in (and, for the owner, the store's cloud data); "Disconnect" removes the cloud
  link from the device; data export (CSV, FR-314) + local DB reset cover the rest.

## 6. Deferred by design (no store blockers)

- FR-100 camera scanning — scanner-wedge + manual barcode entry cover it.
- FR-109 BT/WiFi printing — on-screen receipt (width-setting aware) +
  shareable label/PO files cover it.
- Loyalty (NFR-9 consent flow) — out of launch scope; nothing collects
  loyalty data yet.
