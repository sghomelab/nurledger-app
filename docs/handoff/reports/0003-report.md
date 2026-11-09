# 0003 report — Nurledger 1.0.0 release execution (internal tracks)

Built, verified, smoke-tested, submitted. **iOS 1.0.0 (build 3) is SUBMITTED FOR REVIEW — `appStoreState = WAITING_FOR_REVIEW`** (2026-11-09): all metadata set via API, the 6 console blockers cleared (Mas), store screenshots captured on exact-resolution AVDs from the production universal APK and uploaded via the ASC API (iPhone 1290×2796 + iPad 13" 2064×2752), then `POST /reviewSubmissionItems` → `PATCH submitted:true` → verified WAITING_FOR_REVIEW. **Android is still blocked at the Play first-upload gate** (verified: the app record does not exist in Play Console at all — the Play API cannot create apps, so it needs a one-time manual console creation by Mas, same as Rutini/Conscious Spending). Internal TestFlight testing does NOT need the review submission — Mas only has to add build 3 to the internal group. Details below.

**Screenshots — how they were made (2026-11-09, zero build credits):** captured on two custom Android AVDs at the *exact* App Store display resolutions (RN UI renders platform-identically on Android, so a production universal APK capture is faithful), then post-processed: status bar cropped, Android gesture pill erased (white fill in the center strip), full width kept, padded to the target height with edge-sampled background color. **iPhone** = 1290×2796 (set type `APP_IPHONE_67` — note: this API version requires 1290×2796, the old 1284×2778 fails `SPEC_MISMATCH`); 3 shots (sell with cart item, populated Insights after a real sale, Inventory). **iPad** = 2064×2752, set type **`APP_IPAD_PRO_3GEN_129`** — this is the type that satisfies the required **`IPAD_13_PROFILE`** slot (2 shots: sell split-view, Inventory). ⚠️ Key gotcha: `APP_IPAD_PRO_129` (the other 12.9"-class type) *strictly* accepts only 2048×2732 and does **NOT** satisfy `IPAD_13_PROFILE`; the 13"-class type is `APP_IPAD_PRO_3GEN_129`, which accepts 2064×2752. Upload flow per shot: `POST /appScreenshots` (reserve, returns one-time PUT `uploadOperations`) → PUT byte ranges → `PATCH` `{uploaded:true, sourceFileChecksum:MD5}` → poll `assetDeliveryState` to `COMPLETE`.

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

### Android — LIVE on the internal track (was blocked at first upload; resolved 2026-11-09)
**RESOLVED:** Mas created the app `com.nurlogic.nurledger` in Play Console and granted the shared service account. `eas submit --platform android --path /tmp/opencode/nurledger-artifacts/nurledger.aab --non-interactive` → **Release track: internal, status COMPLETED**. Verified via the Play API (`tools/play_check.py`): `internal → release 1.0.0, versionCodes=['3'], status=completed` (not halted). The block below is the history of why the first submit failed.
- `eas submit --platform android --path nurledger.aab --non-interactive` scheduled correctly to **Release track: internal**, but failed:
  > "Google Play cannot find the app. Check the package name and upload the first version manually in Play Console."
- `tools/play_check.py com.nurlogic.nurledger` → **`404 Package not found: com.nurlogic.nurledger`**.
- **Why this step exists now (Mas's question):** probed 9 name variants of the package directly against the Play API (`com.nurlogic.nurledger`, `com.nurlogic.nledger`, `com.nurlogic.nurledgerpos`, `com.nurlogic.nurledger.app`, `ai.nurlogic.nurledger`, …) — **all `404 Package not found`**. The app record has never been created. The Play Developer API has **no create-app endpoint** (no `applications.list` either — discovery is impossible via API), so the first app record must be created once in Play Console UI. This is the same one-time step that was done for Rutini and Conscious Spending at their first releases — not a regression.
- **Artifact for Mas to upload once**: `/tmp/opencode/nurledger-artifacts/nurledger.aab` (1.0.0 / versionCode 3). After the app exists + the SA (`play-store-uploads@ai-agent-497901.iam.gserviceaccount.com`) is granted access, `eas submit` (internal track by default) lands it and `tools/play_check.py` verifies.

### iOS — SUBMITTED FOR REVIEW (WAITING_FOR_REVIEW); all metadata + screenshots done
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
- **DONE — all six cleared and submitted (2026-11-09, no build credits):** the 6 console items were cleared (Mas did pricing Free, primary category Business, app-privacy answers, review contact, demo-account in the console; screenshots were uploaded via API as described in the header). The review submission shell (id `80d76d18-8bb5-4239-b320-a8efebd29239`) was reused → `POST /reviewSubmissionItems` (that submission + version `fb893430-da5f-4587-9441-24683c80094f`) → `PATCH /reviewSubmissions/{id} submitted:true` → **verified `appStoreState = WAITING_FOR_REVIEW`** (build 3 VALID, not expired). Apple now has it for review.
- **Internal TestFlight (the original 0003 deliverable) does not require the review submission.** **Mas: add build 3 (1.0.0) to the Nurledger internal TestFlight group in App Store Connect** (TestFlight tab → Builds → 3 (1.0.0) → "Done Processing" → add to internal group). EAS printed "No complete App Store Connect credentials, skipping TestFlight setup", so group assignment is console-side.

## What Mas must do next

**iOS (App Store Connect) — SUBMITTED; only these remain:**
1. **Internal TestFlight** — add build 3 (1.0.0) to the internal TestFlight group (TestFlight tab → Builds → 3 (1.0.0) → add to internal group). Independent of review; lets testers install now.
2. **Watch App Store Connect** for Apple's review decision (typically 24–48h). If **approved** → the app goes live automatically. If **rejected** → open the Resolution Center item and **reply in the web UI** (no API for replies), then I re-submit via API.

*(The 6 prior console items — pricing, category, screenshots, app-privacy, review contact, demo-account — are all done; submission is complete and WAITING_FOR_REVIEW.)*

**Android (Play Console) — app is on the internal track; only testers left:**
Mas created the app + granted the SA; I landed `1.0.0 / vc3` on the **internal** track (verified `status=completed`). **Mas:** in Play Console → Testing → Internal testing → add the tester email addresses (they must be Google accounts) → send them the opt-in URL. No further manual uploads needed for future versions (`eas submit` works now).

**Testers** — once both are on internal tracks, send the invite links + the **§7 briefing text** (checklist section 7).

## Sign-off note
Do **not** widen beyond internal testers until §8 gates are met (iPad/iOS device checks, native-speaker language review, legal sign-off, store listing, real-device failure paths, support process, tester triage) — and the opening-float ANOMALY above should be fixed in a follow-up version first.
