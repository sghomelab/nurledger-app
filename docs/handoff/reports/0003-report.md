# 0003 report — Nurledger 1.0.0 release execution (internal tracks)

Built, verified, smoke-tested, and submitted to internal tracks. **Android is blocked at the Play first-upload gate** (the app does not exist in Play Console yet — needs a one-time manual console step by Mas). **iOS: build 3 (1.0.0) is VALID in App Store Connect and attached to version 1.0.0**; the App Store review submission is **blocked by the missing store listing** (~35 required items — screenshots, description, pricing, content rating, app-privacy answers, etc., all checklist §4/§8 [Mas] work). Internal TestFlight testing does NOT need the review submission — Mas only has to add build 3 to the internal group. Details below.

## Gate (step 1) — satisfied

Mas's GO contained all three required elements:
- "GO BUILD NURLEDGER" ✅
- (a) ASC numeric app id: **6832286475** ✅
- (b) Google Play app + service account + internal track (Mas confirmed; see the Android first-upload blocker in §Submit — the app record was not yet visible to the Play API) ⚠️
- (c) Expo build-credit balance: **$19** ✅

Internal tracks only — nothing was promoted to closed/open/production.

## What was built

| | |
|---|---|
| **Commit** | `f40d0ce` (submit config wiring: ASC `ascAppId` 6832286475 + working ASC key; Android `serviceAccountKeyPath`) |
| **Android build** | `5d5508e7-e84d-4577-83f8-2f586987ad85` — FINISHED from `f40d0ce` |
| **iOS build** | `0c0adea6-b985-4bfc-9608-e9275d96c845` — FINISHED from `f40d0ce` |
| **Real artifact numbers** | **1.0.0 / versionCode 3 / buildNumber 3** (configured 2 → EAS autoIncrement → 3; verified FROM the artifacts, not the CLI) |
| **app.json sync** | EAS rewrote `app.json` to `buildNumber "3"` / `versionCode 3` during the build; committed as `0957853` |

### How the numbers were verified (from artifacts)
- **AAB** (`nurledger.aab`, 59,997,828 bytes): extracted the new AGP `base/` module; the universal APK's manifest reports `package com.nurlogic.nurledger versionCode=3 versionName=1.0.0`.
- **IPA** (`nurledger.ipa`, 18,260,122 bytes): `Payload/NurLedger.app/Info.plist` → `CFBundleShortVersionString=1.0.0`, `CFBundleVersion=3`, `CFBundleIdentifier=com.nurlogic.nurledger`, `ITSAppUsesNonExemptEncryption=False`.

### Credentials work required before the builds (both platforms had empty/mis-pointed EAS stores)
- **iOS**: the EAS build credential pointed at the wrong distribution cert (`3619AB33…`, which is Rutini's — no private key held). Fixed surgically: set Nurledger's build credential to cert `439934F97A2C6BCE3ECB05A142EBB32C` ("Apple Distribution: Nurlogic"), then re-ran `eas credentials:configure-build -p ios --profile production` (temp non-interactive patch, reverted after) so EAS re-pointed the Apple profile `8RJ7G22R63` → **`6TVZ94D2NN`**. Verified the embedded cert in the profile blob = `439934F9…` via openssl. The `3619AB33` cert was left untouched.
- **Android**: created the full credential chain via EAS GraphQL (store was empty): keystore (SHA-256 `6C:F5:…:B3:05:40` = the Play-registered upload key) → app credentials for `com.nurlogic.nurledger` → DEFAULT build credential.

## Smoke test — production AAB on cs-test AVD (emulator-5554)

Installed the universal APK built from the **production AAB** (versionCode 3). All flows below exercised on the real release binary, not a dev build.

| Flow | Result |
|---|---|
| First run | ✅ Clean setup screen, "Load sample data" option |
| Load sample data | ✅ 11 products, SG/SGD/GST 9% locale |
| Open shift | ✅ (float field — see ANOMALY below) |
| Sell (Aged Vermont White Cheddar 200g ×1) | ✅ SGD 8.50, 9% GST incl 0.70, FIFO margin 54% / SGD 4.60 |
| Tender SGD 10.00 → change | ✅ Change 1.50, receipt issued |
| Shift card | ✅ Cash sales + expected drawer correct |
| **Refund** (Insights → Sales History → sale) | ✅ Restock toggle ON, 6-reason bottom sheet (Customer return), qty 1/1, refunded SGD 8.50, **inventory 21 → 22** |
| **PIN / user switch** | ✅ Owner→Jun (cashier) no PIN; Jun→Owner **requires PIN**; 8 wrong digits → "Wrong PIN"; correct 1234 unlocks (progressive 4–8-digit matching by design, CR-15) |
| Insights (KPIs, P&L, Sales History) | ✅ Net revenue, COGS (FIFO), payment breakdown all consistent |
| **Offline** (wifi + mobile both disabled, 0 connected agents) | ✅ Sale completed with no network — register never blocks (Receipt #5710F2D3) |
| **X-report** | ✅ Snapshot: cash sales 17.00 (gross), expected cash 8.50 (net of refund) |
| **Close shift + Z-report** | ✅ Sales 17.00, Refunds −8.50, Expected 8.50 = Counted 8.50, **Variance 0.00 (Exact)** |
| **Settings → Language** | ✅ **English / Bahasa Melayu / Filipino** all present; "Applies to this device only"; currency SGD + SG GST 9% inclusive intact |

### ⚠️ ANOMALY — opening-float input (reported, NOT patched)
The shift opening-float numeric field places the text cursor at **index 0** (before the initial "0" of "0.00"). Typed digits are **prepended**, so a typed value N is stored as **10×N**:
- Typed `100` → field showed `1000.00`
- Typed `150` → field showed `1500.00` → **shift card persisted "Opening float SGD 1,500.00"** (and it propagated into "Expected in drawer")

Reproducible on the production build. This is a money-amount input bug (affects the opening float; the same controlled-input pattern may affect other numeric fields — the close-shift "counted cash" field behaved differently in one pass, so it is state-dependent). **Not patched here per spec** — flagging for a fix in a follow-up version. (An earlier pass also showed the typed float not registering at all → card showed 0.00, i.e. focus-dependent.)

### Not tested (stated per spec)
- **iPad**: NOT testable here (no Mac / iPad simulator available). iOS/iPad device checks remain a §8 gate before widening.
- **Cloud setup wizard**: NOT tested — no throwaway HTTPS Supabase project available. (The app is offline-first; sync is optional BYO.)
- Release-build hygiene checks (no dev menu, no record logs, `allowBackup=false`, minimal permissions) were already passed on a clean 1.0.0 APK in a prior task and the build config was unchanged, so not re-run.

## Submit to internal tracks (step 5)

### Android — BLOCKED at first upload
- `eas submit --platform android --path nurledger.aab --non-interactive` scheduled correctly to **Release track: internal**, but failed:
  > "Google Play cannot find the app. Check the package name and upload the first version manually in Play Console."
- `tools/play_check.py com.nurlogic.nurledger` → **`404 Package not found: com.nurlogic.nurledger`**. The app record does not exist in Play Console, and a service account **cannot create** an app — the first release must be uploaded once manually in the console.
- **Artifact for Mas to upload once**: `/tmp/opencode/nurledger-artifacts/nurledger.aab` (1.0.0 / versionCode 3). After the app exists + the SA is granted access + an internal track exists, `eas submit` (or a manual upload) can land it on the internal track.

### iOS — build VALID, version 1.0.0 ready; review submission blocked by missing listing
- `eas submit --platform ios --path nurledger.ipa --non-interactive` → **EXIT 0**, binary uploaded. Apple finished processing: **build 3 → VALID** (ASC build id `7ae4d0ee-1837-49f0-b9fb-cfa91f52d9ea`).
- EAS's auto version-create did not complete (known gap), so the manual ASC REST recipe was run: the existing placeholder version **"1.0" → PREPARE_FOR_SUBMISSION was renamed to "1.0.0"** and **build 3 was attached** to it. (Creating a brand-new version 409'd while the placeholder existed in preparation state; renaming is the supported path.)
- **Adding the version to a review submission → 409 with the full blocker list.** The app has **no store listing at all** — every required item is missing:
  - App screenshots (IPAD_13_PROFILE + IPHONE_DYNAMIC_ISLAND types — needs a real device/Mac)
  - `description`, `keywords`, `copyright`, `privacyPolicyUrl`, `supportUrl`
  - **Pricing** not set (Free), **primaryCategory**, `contentRightsDeclaration`
  - **Age-rating questionnaire** (all ~20 attributes unanswered)
  - **App privacy "data usages" answers not published** (UI-only — the ASC API key 401s on the iris endpoints)
  - `appStoreReviewDetail` (review contact) not created
  - (`whatsNew` is also not editable in this state; it is optional for a first version anyway.)
- These are all checklist **§4 (App Store Connect setup) and §8 (store listing)** items — [Mas]/legal console work. Once done, the submission completes in one API pass: an empty review submission shell already exists (id `80d76d18-8bb5-4239-b320-a8efebd29239`, READY_FOR_REVIEW, no items; DELETE is not allowed on this resource, so it is left in place and reused) → `POST /reviewSubmissionItems` (that submission + version `fb893430-da5f-4587-9441-24683c80094f`) → `PATCH /reviewSubmissions/{id} submitted:true` → WAITING_FOR_REVIEW.
- **Internal TestFlight (the actual 0003 deliverable) does not require the review submission.** **Mas: add build 3 (1.0.0) to the Nurledger internal TestFlight group in App Store Connect** (TestFlight tab → Builds → 3 (1.0.0) → "Done Processing" → add to internal group). EAS printed "No complete App Store Connect credentials, skipping TestFlight setup", so group assignment is console-side.

## What Mas must do next

1. **Android (Play Console)** — create the app `com.nurlogic.nurledger` (name "NurLedger: Offline POS & Stock", free, Business), then either upload `/tmp/opencode/nurledger-artifacts/nurledger.aab` manually to the **internal** track once, or (after the app exists) grant the service account access + an internal track so `eas submit` can land it. Run `tools/play_check.py com.nurlogic.nurledger` after — `halted` = rejected.
2. **iOS (App Store Connect)** — build 3 (1.0.0) is VALID and attached to version 1.0.0. **Add build 3 to the internal TestFlight group** (TestFlight tab → Builds). The App Store review submission is blocked until the store listing exists (checklist §4/§8: screenshots, description, pricing, category, content rating, app-privacy answers, review contact, privacy + support URLs) — internal testing works without it.
3. **Testers** — once both are on the internal tracks, send the invite links and the **§7 briefing text** (checklist section 7).

## Sign-off note
Do **not** widen beyond internal testers until §8 gates are met (iPad/iOS device checks, native-speaker language review, legal sign-off, store listing, real-device failure paths, support process, tester triage) — and the opening-float ANOMALY above should be fixed in a follow-up version first.
