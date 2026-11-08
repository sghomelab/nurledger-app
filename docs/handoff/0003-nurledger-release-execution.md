# 0003 — Nurledger 1.0.0: wire submit config, build, verify, submit to INTERNAL tracks

Repo: `nurledger-app` (main 8053f19 or later). Report: `docs/handoff/reports/0003-report.md`. Follows `docs/RELEASE-CHECKLIST.md` sections 5-6.

## Gate (read first)
Do anything in this task ONLY if Mas's message pointing you here contains the phrase "GO BUILD NURLEDGER" AND supplies: (a) the App Store Connect numeric app id, (b) confirmation the Google Play app exists with the service account granted access and an internal testing track, (c) the current Expo build-credit balance. If any is missing, do nothing and reply with what is missing. Internal tracks only: never promote to closed/open testing or production.

## Steps
1. Preflight: `git fetch`; main clean; `npx tsc --noEmit` = 0; `npx jest` in default TZ and `TZ=America/Los_Angeles`; `npm run test:strict` = 0 skipped. No tracked node_modules or secrets.
2. Wire submit config in ONE commit: `ascAppId` (iOS submit profile) = Mas's value; Android `serviceAccountKeyPath` = the existing Play service-account key under the gitignored `secrets/` folder (confirm the path is gitignored; NEVER commit the key). Push to main. Both platforms must build from this exact commit.
3. Build: `eas build --platform android --profile production --non-interactive` and `eas build --platform ios --profile production --non-interactive` (credentials remote). Verify numbers FROM THE ARTIFACTS (AAB manifest, IPA Info.plist): version 1.0.0, versionCode/buildNumber. If they differ from app.json (autoIncrement), sync app.json in a follow-up commit.
4. Smoke-test the production Android build (emulator or phone): first run, Load sample data, sell, refund, close shift + Z-report, Settings > Language shows English/Bahasa Melayu/Filipino, PIN checks (cashier -> manager/owner switch asks for a PIN; Change PIN), offline selling. If a throwaway HTTPS Supabase project is available run the cloud setup wizard, otherwise say it was not tested. Confirm iPad is NOT testable here and say so.
5. Submit to INTERNAL tracks:
   - Android: `eas submit --platform android --path <aab> --non-interactive`. If it fails because the app has never had a first upload (Play requires the first release to be uploaded manually in the console — verify), STOP and report the artifact location so Mas can upload it once in Play Console; continue afterwards. Then run `tools/play_check.py com.nurlogic.nurledger`; `halted` means rejected. Do not trust "finished" alone.
   - iOS: `eas submit --platform ios --path <ipa> --non-interactive`. Wait for processing, answer export compliance if asked (`ITSAppUsesNonExemptEncryption=false`). Check App Store Connect / TestFlight itself, not just the CLI. If assigning to the internal group needs the console, tell Mas exactly which build to assign.
6. Update the status line and Sections 5-6 boxes of `docs/RELEASE-CHECKLIST.md` for what you verified (docs-only commit). Never reuse a versionCode/buildNumber.
7. Stop at any failure and report; do not patch silently.

## Report
`docs/handoff/reports/0003-report.md`: commit built, real artifact numbers, smoke-test results, submit results with store-console evidence, what Mas must do next (testers' invite links; the briefing text is in the checklist section 7).
