# NurLedger 1.0.0 — Internal-tester release checklist

Goal: get 1.0.0 to **internal testers only** (Google Play internal testing + TestFlight internal testers). This is not a public store release; the public-release gates are listed in section 8.

Who does what: **[Mas]** needs a person with console/legal access, **[OpenCode]** is repo/build/device work, **[Both]** is shared. Do not start EAS builds or store actions without Mas's GO (see `docs/PACKAGING.md` §4). Items marked **(verify)** are store-console rules that change over time: check the console's own wording before relying on them.

Status line to keep updated: `Last updated: 2026-11-09 · main @ 0957853 (app.json synced to build 3/3) · builds 1.0.0/3 finished from f40d0ce; Android BLOCKED at Play first-upload (app not in Play Console yet); iOS build 3 VALID + attached to version 1.0.0 (internal TF group = Mas in console; App Store review submission blocked by missing listing §4/§8) — see docs/handoff/reports/0003-report.md`

## 0. Decisions already made

- [x] Price: Free, no in-app purchases. Category: Business.
- [x] First user is in the Philippines. App ships English, Bahasa Melayu, Filipino (Malay and Filipino text are machine-drafted and need native review).
- [x] Internal testers first; iOS and iPad are **not verified on a device** (no Mac available). Accepted for internal testing.
- [x] Support contact: **hello@nurlogic.ai**, reply "within 3 working days". Legal entity: **NurLogic** (registered spelling confirmed by Mas 2026-11-08; use it consistently in policy, support page and consoles).
- [x] PIN model hardened (merged to main 7c4c063, device-verified): switching to a manager/owner, adding one, and changing a PIN all need an owner/manager PIN; "Change PIN…" exists; lost owner PIN = Reset all data on that device (Owner PIN returns to the default 1234).
- [x] **iPad:** Mas decided to ship iPad support (`ios.supportsTablet` stays `true`). iPad layout is NOT verified on a device (no Mac), accepted for internal testing. iPad screenshots (13" and 11") are required before any App Store review or public release; TestFlight internal testing does not need them.

## 1. Code and docs are ready  [OpenCode]

- [x] PIN hardening merged (main 7c4c063) with 544/544 tests in two timezones.
- [x] `claude/prerelease-fixes` merged (149095d); OpenCode's 1.0.0 version commit on main (`b201059`); `origin/main` is the commit you intend to build.
- [x] Docs-only follow-up merged (PACKAGING.md: iOS buildNumber, three languages, credentialsSource, Android submit key note, HTTPS-only note) — `300b417`.
- [x] Gates on that exact commit: `npx tsc --noEmit` = 0, `npx jest` passes in two timezones (default and `TZ=America/Los_Angeles`, 544/544), `npm run test:strict` = 0 skipped — verified on `02287b6`.
- [x] `app.json`: `version` 1.0.0, Android `versionCode` 2, iOS `buildNumber` "2"; one commit for both platforms (`b201059`).
- [x] Working tree clean: no stray files, no tracked `node_modules`, no secrets (scan returns nothing; `secrets/` gitignored).
- [x] `ios.supportsTablet` set per the decision in section 0. (`"supportsTablet": true` in `app.json`; unchanged by the 1.0.0 builds.)

## 2. Security hygiene  [Mas]

- [ ] Rotate any Supabase `service_role` key that was ever pasted into an older build or chat.
- [ ] Confirm the test Supabase project (local/dev) holds no real data and is not the project shipped in the app (the app ships no project; users bring their own).
- [ ] Remove or revoke leftover test accounts if any were created against a real project.

## 3. Policy and support pages  [Mas, legal]

Draft text is in `nurledger-privacy-policy-draft.md` (workspace folder). It is a draft and **not legal advice**.

- [ ] Placeholders: entity (NurLogic) and support email (hello@nurlogic.ai) are filled in the drafts; **effective date** is still Mas's to set.
- [ ] Legal owner reviews the policy (including the Philippine Data Privacy Act and Malaysia PDPA questions, and the optional cloud-sync wording).
- [ ] Publish the NurLedger section at `https://nurlogic.ai/privacy` (the privacy worker must include NurLedger).
- [ ] Create `https://nurlogic.ai/support` (built on the `nurlogic-ai` branch `claude/website-deploy-a`, not deployed; ships later as "Deploy A2" after legal review, with the NurLedger privacy section and guide claims). The "forgot PIN" answer assumes the PIN-hardening build.
- [ ] Open both URLs on a phone and confirm they load.

## 4. Store console setup  [Mas]

Google Play Console
- [ ] Create the app (`com.nurlogic.nurledger`), name "NurLedger: Offline POS & Stock", free, category Business.
- [ ] Add the privacy policy URL, support email and contact details (verify which fields are required before an internal-testing release).
- [ ] Content rating questionnaire (expected: lowest tier; answer honestly).
- [ ] Data safety form using the proposed answers in the listing pack, section 7 (optional transmission to a user-configured server; encrypted in transit; deletion available in-app). Have legal confirm the wording. (verify whether internal testing requires it; complete it anyway before widening.)
- [ ] Create the internal testing track and add the tester email list.

App Store Connect
- [ ] Create the app (bundle id `com.nurlogic.nurledger`, name "NurLedger: Offline POS & Stock") and note its numeric app id.
- [ ] Add the app id as `ascAppId` in the iOS submit profile in `eas.json` (OpenCode commits it).
- [ ] App privacy answers: "Data Not Collected" per the listing pack, with the same legal confirmation.
- [ ] Create the internal testing group and add testers (they must be users on the App Store Connect team; internal testing does not need beta app review (verify)).

Both
- [ ] Put the Play service-account JSON key in the gitignored `secrets/` folder and set `serviceAccountKeyPath` in the Android submit profile (OpenCode commits the path, never the key).

## 5. Build  [OpenCode, on Mas's GO]

1. [x] Mas confirms the Expo build credit balance on expo.dev (visible only on the dashboard). Stop if unknown. — **$19** supplied in the 2026-11-08 GO.
2. [x] Both platforms build from the SAME commit — **`f40d0ce`**: Android build `5d5508e7-e84d-4577-83f8-2f586987ad85`, iOS build `0c0adea6-b985-4bfc-9608-e9275d96c845`, both FINISHED.
3. [x] Verify the real numbers from the artifacts (AAB manifest / IPA Info.plist): **1.0.0 / versionCode 3 / buildNumber 3** (configured 2 → EAS autoIncrement → 3). `app.json` synced to the actuals in commit `0957853`.
4. [x] Smoke-test the production Android build (universal APK from the production AAB, versionCode 3) on the `cs-test` AVD per the 0003 spec: first run, load sample data, sell (SGD 8.50, 9% GST incl, FIFO margin 54%), tender/change, **refund** (restock 21 → 22), PIN/user-switch flow, **offline sale** (0 connected networks), X-report, close shift + Z-report (variance 0.00 Exact), Settings > Language (**English / Bahasa Melayu / Filipino** present). Cloud setup wizard **NOT tested** (no throwaway Supabase project available) — see `docs/handoff/reports/0003-report.md`. ⚠️ Opening-float input anomaly found and reported (10× inflation; not patched per spec).
5. [x] Release-build checks already passed on a clean 1.0.0 APK: no dev menu, no logs with record contents, `allowBackup=false`, manifest permissions minimal. Build config unchanged since that pass (version numbers only) → no re-run needed.

## 6. Submit to internal tracks  [OpenCode submits, Mas confirms]

- [ ] Android: `eas submit --platform android --path <aab> --non-interactive`. Confirm the build appears under internal testing and is not halted/rejected (`tools/play_check.py com.nurlogic.nurledger`, `halted` = rejected). Never trust "finished" alone. — **⛔ BLOCKED 2026-11-09:** submit scheduled correctly to the `internal` track, but failed: "Google Play cannot find the app… upload the first version manually in Play Console." Verified the app record does not exist: 9 package-name variants probed against the Play API, all `404 Package not found`; the Play API has no create-app endpoint (same one-time console step Rutini/Conscious Spending needed at first release). **[Mas]:** create the app (§4) + grant the SA access → then `eas submit` lands `/tmp/opencode/nurledger-artifacts/nurledger.aab` (1.0.0 / versionCode 3) on internal.
- [ ] iOS: `eas submit --platform ios --path <ipa> --non-interactive`. Wait for processing, answer export compliance if asked (the app declares `ITSAppUsesNonExemptEncryption = false`), assign the build to the internal group. Check App Store Connect/TestFlight, not just the CLI. — **⏳ PARTIAL 2026-11-09:** binary uploaded (exit 0); **build 3 = VALID** in ASC; placeholder version renamed to **1.0.0** and build attached (manual REST). **All ASC API-settable metadata DONE** (description, keywords, subtitle, privacy/support URLs, copyright, content-rights, age rating → 4+). App Store review submission ("make it live") blocked by exactly **6 console-only items**: pricing Free · primary category Business · screenshots (iPhone 6.9" + iPad 13") · app-privacy data-usage answers · review contact name/phone (+63) · demo-account flag. When clear → one-pass API submit (submission shell `80d76d18-…` ready) → WAITING_FOR_REVIEW. **Internal TestFlight needs no review submission — [Mas]: add build 3 (1.0.0) to the internal TestFlight group in the console.**
- [ ] Testers receive the link / TestFlight invite and can install. (pending both platforms landing on their internal tracks)

## 7. Brief the testers  [Mas]

Send this with the invite:
- This is a 1.0.0 internal build. **iOS and iPad were not tested on a device**; please report anything odd. Android phones and tablets were tested.
- Filipino and Malay translations are drafts; tell us wording that is wrong or awkward.
- Payments (cash, card, GCash, Maya, QR Ph) are **recorded, not processed**. The app is not a BIR-registered receipting or e-invoicing system.
- Cloud sync is optional and needs your own free Supabase project over HTTPS. Without sync, local data is **not** restored from device backups (Android); use CSV export or sync.
- The default Owner PIN is 1234: change it first (Shift tab → Switch → Change PIN…). If the only owner PIN is lost, the way back in is Settings → Reset all data on that device, which erases local data.
- Use "Load sample data" on first run to explore. Do not enter real customer data you cannot afford to lose until the group has used it for a while.
- How to report: the support email, with phone model, Android/iOS version, app language and what you were doing. Do not include secrets or tokens.

What to try: a full day's flow (open shift, several sales including split payment and a weighed item, a refund, stock adjustment, expiry radar, close shift and Z-report), switching languages, the PIN prompt with a cashier and an owner (a cashier switching to a manager/owner must be asked for a PIN; Change PIN…), offline selling then reconnecting, and (if they use sync) adding a second device with an invite code.

## 8. Before widening beyond internal testers

Do not move to closed/open testing or production until these are done:
- [ ] iPad/iOS device checks (Keychain after reboot, privacy manifest in the IPA, ATS) or iOS dropped from the release.
- [ ] Native-speaker review of Malay and Filipino text and store listings.
- [ ] Legal sign-off on the privacy policy, Data-safety/App-privacy answers, and any Philippines-specific wording (BIR/accountant confirmation for local use).
- [ ] Store listing finished: description, keywords, screenshots (phone, Android tablet; iPad only if iPad is supported), feature graphic, "What's new". Claims must match `nurledger-store-listing.md` ("Do NOT claim" list).
- [ ] Real-device failure paths on a real iPhone and real Android (rejected uploads, session expiry, airplane mode).
- [ ] Support process in place: who answers the support email and how fast.
- [ ] Tester feedback triaged; blocking bugs fixed in a new version.

## 9. If something goes wrong

- Bad Android build on internal track: halt/replace it in Play Console; ship a fixed build with a higher versionCode (never reuse a code).
- Bad iOS build: expire the TestFlight build and upload a new buildNumber.
- Version rule: every new upload needs a higher versionCode / buildNumber; a new marketing version must go through the version-bump commit first, then both platforms from the same commit.
- Security issue (suspected key leak, data exposure): stop distribution, escalate to Mas; rotate keys; do not self-remediate silently.

## 10. Sign-off

| Gate | Owner | Done (date) |
|---|---|---|
| Sections 1-2 (code, docs, hygiene) | OpenCode / Mas | |
| Section 3 (policy and support pages live) | Mas / legal | |
| Section 4 (consoles ready) | Mas | |
| Section 5 (builds verified) | OpenCode | 2026-11-09 (1.0.0/3 both platforms; smoke + anomaly in 0003-report) |
| Section 6 (internal tracks live) | OpenCode / Mas | |
| Section 7 (testers briefed) | Mas | |
