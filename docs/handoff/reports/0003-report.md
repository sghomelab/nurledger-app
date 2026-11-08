# 0003 report — Nurledger 1.0.0 release execution (internal tracks)

Built, verified, smoke-tested, and submitted to internal tracks. **Android is blocked at the Play first-upload gate** (verified: the app record does not exist in Play Console at all — the Play API cannot create apps, so it needs a one-time manual console creation by Mas, same as Rutini/Conscious Spending). **iOS: build 3 (1.0.0) is VALID and attached to version 1.0.0, and every ASC API-settable metadata item is now DONE** (description, keywords, subtitle, privacy + support URLs, copyright, content-rights declaration, full age-rating questionnaire → 4+). The App Store review submission (Mas's "make it live" request) is blocked by exactly **6 console-only items**: pricing (Free), primary category (Business), screenshots (iPhone 6.9" + iPad 13"), app-privacy data-usage answers, review contact name/phone, demo-account flag. Once those clear, submission is a single API call. Internal TestFlight testing does NOT need the review submission — Mas only has to add build 3 to the internal group. Details below.

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

### Android — BLOCKED at first upload (verified: the app record does not exist)
- `eas submit --platform android --path nurledger.aab --non-interactive` scheduled correctly to **Release track: internal**, but failed:
  > "Google Play cannot find the app. Check the package name and upload the first version manually in Play Console."
- `tools/play_check.py com.nurlogic.nurledger` → **`404 Package not found: com.nurlogic.nurledger`**.
- **Why this step exists now (Mas's question):** probed 9 name variants of the package directly against the Play API (`com.nurlogic.nurledger`, `com.nurlogic.nledger`, `com.nurlogic.nurledgerpos`, `com.nurlogic.nurledger.app`, `ai.nurlogic.nurledger`, …) — **all `404 Package not found`**. The app record has never been created. The Play Developer API has **no create-app endpoint** (no `applications.list` either — discovery is impossible via API), so the first app record must be created once in Play Console UI. This is the same one-time step that was done for Rutini and Conscious Spending at their first releases — not a regression.
- **Artifact for Mas to upload once**: `/tmp/opencode/nurledger-artifacts/nurledger.aab` (1.0.0 / versionCode 3). After the app exists + the SA (`play-store-uploads@ai-agent-497901.iam.gserviceaccount.com`) is granted access, `eas submit` (internal track by default) lands it and `tools/play_check.py` verifies.

### iOS — all API-settable metadata DONE; 6 console items remain before submission
- `eas submit --platform ios --path nurledger.ipa --non-interactive` → **EXIT 0**, binary uploaded. Apple finished processing: **build 3 → VALID** (ASC build id `7ae4d0ee-1837-49f0-b9fb-cfa91f52d9ea`).
- EAS's auto version-create did not complete (known gap), so the manual ASC REST recipe was run: the existing placeholder version **"1.0" → PREPARE_FOR_SUBMISSION was renamed to "1.0.0"** and **build 3 was attached** to it. (Creating a brand-new version 409'd while the placeholder existed in preparation state; renaming is the supported path.)
- **Everything settable via the ASC API is now set (verified by re-read):**
  - Version 1.0.0 en-US: full app **description** (POS copy, no over-claims), **keywords** `pos,inventory,offline,stock,retail,grocery,counter,sales,shift,refund` (69 chars), **supportUrl** `https://nurlogic.ai/support`; **copyright** `© 2026 NurLogic` (on the version resource in this API version).
  - App en-US localization: **privacyPolicyUrl** `https://nurlogic.ai/privacy` (page already names NurLedger), **subtitle** "Offline POS & Stock". Both URLs verified live (HTTP 200) before setting.
  - **contentRightsDeclaration** = `DOES_NOT_USE_THIRD_PARTY_CONTENT`.
  - **Age rating** — full 23-attribute questionnaire answered to the lowest tier → computed **`appStoreAgeRating = FOUR_PLUS`**.
  - **appStoreReviewDetails** object created for the version (id `be669ebf-517b-4ef6-937e-51b51819b6f8`); contact fields still empty — the API rejects every partial update until all of contactFirstName/LastName/Phone/Email are present, so this needs Mas's real name + phone (+63 E.164). Email will be `hello@nurlogic.ai`.
  - `whatsNew` is persistently `409 STATE_ERROR "cannot be edited at this time"` in this API version — it is **optional for a first version**, so skipped.
- **Authoritative remaining blocker list** (from `POST /reviewSubmissionItems` 409 `meta.associatedErrors`, re-verified after all metadata was set — all are console-only):
  1. **Pricing** — `APP_PRICING_REQUIRED`. Set **Free** (Price and Availability). Not API-reachable: `appPricePoints` relationship is read-only and the manual-price endpoints are 405/404 in this API version.
  2. **Primary category** — relationship REQUIRED. Set **Business**. `primaryCategory` is read-only via API (GET only); category ids are literal strings (`BUSINESS` exists in `/appCategories`).
  3. **Screenshots** — one **IPAD_13_PROFILE** (13" iPad) and one **IPHONE_DYNAMIC_ISLAND** (6.9" iPhone). Needs real device captures from the TestFlight build — I will not fabricate store screenshots.
  4. **App privacy data-usages answers** — `APP_DATA_USAGES_REQUIRED`. UI-only (the ASC API key 401s on the iris endpoints): App Privacy → answer the data-usage questions → **Publish**.
  5. **Review contact** — contactFirstName/LastName/Email/Phone. Either fill "App Review Information" in the console, or give me name + phone and I'll PATCH it via API.
  6. **Demo account** — demoAccountName/Password required unless `demoAccountRequired=false`. The app has no required login (offline-first, PIN users are in-app roles, no reviewer sign-in) — once the contact fields exist I can set `demoAccountRequired: false` via API; or uncheck "Demo Account" in the console.
- **When all six clear, the submission is one API pass** (no build credits): the review submission shell already exists (id `80d76d18-8bb5-4239-b320-a8efebd29239`, READY_FOR_REVIEW, no items; DELETE is not allowed, so it is reused) → `POST /reviewSubmissionItems` (that submission + version `fb893430-da5f-4587-9441-24683c80094f`) → `PATCH /reviewSubmissions/{id} submitted:true` → verify **WAITING_FOR_REVIEW** via API.
- **Internal TestFlight (the original 0003 deliverable) does not require the review submission.** **Mas: add build 3 (1.0.0) to the Nurledger internal TestFlight group in App Store Connect** (TestFlight tab → Builds → 3 (1.0.0) → "Done Processing" → add to internal group). EAS printed "No complete App Store Connect credentials, skipping TestFlight setup", so group assignment is console-side.

## What Mas must do next

**iOS (App Store Connect) — 6 console items, then I submit with one API call:**
1. **Pricing** → Free (Price and Availability).
2. **Primary category** → Business.
3. **Screenshots** — capture from the TestFlight build: one 6.9" iPhone (Dynamic Island) + one 13" iPad, upload to version 1.0.0.
4. **App Privacy** → answer the data-usage questions → Publish.
5. **App Review Information** — contact name + phone (+63) + email. Either fill it in the console, or send me name + phone and I'll set it via API (email = hello@nurlogic.ai; demo account will be marked "not required" since the app has no login).
6. **Internal TestFlight** — add build 3 (1.0.0) to the internal group (independent of the above).

Then tell me "done" → I run the submission (add version to review submission + submit) → verify WAITING_FOR_REVIEW via API.

**Android (Play Console) — one-time app creation:**
Create app `com.nurlogic.nurledger` (name "NurLedger: Offline POS & Stock"), then grant the service account `play-store-uploads@ai-agent-497901.iam.gserviceaccount.com` access. Then I land `/tmp/opencode/nurledger-artifacts/nurledger.aab` on the internal track via `eas submit` and verify with `tools/play_check.py` (`halted` = rejected). No further manual uploads needed for future versions.

**Testers** — once both are on internal tracks, send the invite links + the **§7 briefing text** (checklist section 7).

## Sign-off note
Do **not** widen beyond internal testers until §8 gates are met (iPad/iOS device checks, native-speaker language review, legal sign-off, store listing, real-device failure paths, support process, tester triage) — and the opening-float ANOMALY above should be fixed in a follow-up version first.
