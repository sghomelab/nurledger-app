# PACKAGING — Nurledger (M6, store-submission prep)

Status: **prepared, not queued.** No EAS build or store submission has been
queued for this app; everything below is readiness + the exact runbook for
when Mas gives the GO. (Red line: "ship/prepare" ≠ build GO.)

## 1. App identity

| Field | Value |
|---|---|
| Display name | Nurledger |
| App id / bundle id | `com.nurlogic.nurledger` |
| Version (first store release) | 0.1.0 → **bump to 1.0.0 in app.json before the first store build** (one commit for both platforms) |
| Android versionCode | 1 (EAS `autoIncrement` — will become 2+ on first build) |
| iOS buildNumber | "1" (EAS builds `max(configured, store-max)+1`; verify actual from the IPA `Info.plist`) |
| Platform minimums | Android 10+ (spec), iOS 14+ (spec); SDK 57 / RN 0.86 defaults apply |
| Deep link scheme | `nurledger://` (dev-client URL) |

## 2. Build profiles (`eas.json`)

| Profile | Purpose | Notes |
|---|---|---|
| `development` | internal dev-client builds | `developmentClient: true`, channel `development` |
| `preview` | internal QA / stakeholder previews | internal distribution, channel `preview` |
| `production` | store builds | `autoIncrement: true`, channel `production` |

`appVersionSource: "local"` — versions come from `app.json`, not EAS
auto-versioning. All profiles use `credentialsSource: "remote"`.

## 3. Store-asset readiness

- **Icon:** `assets/icon.png` (1024) + Android adaptive (foreground/background/monochrome) + iOS `icon` from the same `icon.png` — present.
- **Splash:** `assets/splash-icon.png` on `#4F46E5` (indigo-600), `contain` — present.
- **Permissions:** **none special.** No camera (FR-100 deferred — scanner wedge /
  manual entry only), no Bluetooth (FR-110 printer deferred — on-screen receipt
  + share-to-file), no location, no storage (share sheet via the system
  `FileProvider`/`UIActivityViewController` — verified working on-device in
  C1/L1/P1). Play Data Safety + App Store privacy labels can therefore claim
  **no data collected by the app itself** (see §5 for the BYO-cloud nuance).
- **Encryption:** `ITSAppUsesNonExemptEncryption: false` already declared
  (HTTPS-only, no custom crypto).
- **Localization:** UI ships EN + Bahasa Melayu (FR-115, device-local toggle —
  no store-side localization metadata required for launch; Malay strings are
  in-app, not in store-listing metadata).

## 4. Store submission runbook (on GO)

1. **Version bump commit first** (Apple version-train rule): `1.0.0` in
   `app.json` (both `version` and the platform build numbers left to EAS
   auto-increment), committed + pushed. BOTH platforms build from the SAME
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
   to `secrets/` (gitignored), `eas submit --platform android --path <aab>
   --non-interactive`, verify via Play API (`tools/play_check.py
   com.nurlogic.nurledger`; `halted` = rejected).
   **UI-only, Mas:** Play Console → app creation + content rating +
   data-safety form + privacy-policy URL (`https://nurlogic.ai/privacy` —
   add Nurledger to the privacy worker first).
6. **Apple:** `eas submit --platform ios --path <ipa> --non-interactive` with
   the working ASC key in the eas.json submit config. For a NEW app Mas first
   creates the app in App Store Connect (UI) and provides the `ascAppId`.
   Verify via ASC API + TestFlight — never trust `finished`.
7. Store listings: app name "Nurledger", short description, description,
   keywords, category (Shopping), screenshots (Sell / Inventory / Expiry /
   Insights / Settings, 6.1" portrait).

## 5. Privacy posture (PDPA/GDPR-lite, NFR-9)

- **Offline-first:** all sales/stock live in local SQLite. The network is
  never required for a sale.
- **BYO cloud (ADR-010):** sync goes to the store's OWN free Supabase
  project — the vendor (Nurlogic) does not host or access store data. The
  only remote calls are to the store's own Supabase project (REST + JWT).
- **No analytics, no crash reporting, no ad SDKs, no PII collected.**
  Cashier names are user-entered labels, not identifiers, and stay local /
  in the store's own project.
- **Data deletion:** "Disconnect" removes the cloud link from the device;
  data export (CSV, FR-314) + local DB reset cover deletion requests.

## 6. Deferred by design (no store blockers)

- FR-100 camera scanning — scanner-wedge + manual barcode entry cover it.
- FR-110 BT/WiFi printing — on-screen receipt (width-setting aware) +
  shareable label/PO files cover it.
- Loyalty (NFR-9 consent flow) — out of launch scope; nothing collects
  loyalty data yet.
