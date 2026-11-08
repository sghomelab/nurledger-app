# 0005 — Rename check: "Nurledger" -> "NurLedger" (display name only) — READ-ONLY audit first

Repo: `nurledger-app` (origin/main). Report: `docs/handoff/reports/0005-report.md`.
Context: Mas decided company branding is **NurLogic**, so the product display name becomes **NurLedger** (capital L). Technical identifiers do NOT change. No EAS builds, store actions or website deploys in this task.

## Part A — audit only (change nothing yet). Report file:line for every hit, grouped:
1. **Display name** that users/stores see: `app.json` `name`; Android label and iOS `CFBundleDisplayName` (check the config plugins / `ios` + `android` blocks and any `infoPlist` / `strings` overrides); splash/icon assets that may contain the word as TEXT (look at `assets/icon.png`, `splash-icon.png`, adaptive icons — report whether any image contains lettering; do NOT edit images, just report).
2. **UI strings**: `src/i18n/{en,ms,fil}.ts` and any hardcoded strings in `app/**` and `src/**` (e.g. receipt/outlet fallback `'NURLEDGER'` in `app/(tabs)/index.tsx:479`, onboarding/first-run text, cloud setup copy, About screen, share text). Note all-caps uses separately.
3. **Generated documents/files**: receipt text, labels, purchase orders, Z-report, CSV/PDF headers and exported FILE NAMES (e.g. `nurledger_products_<stamp>.csv` in `app/csv.tsx`). File names stay lowercase and unchanged unless they print the product name inside the content.
4. **Permission / system strings**: any iOS usage-description or Android permission rationale text containing the name; notification channel names; privacy manifest; `ITSAppUsesNonExemptEncryption` block.
5. **Docs**: README, AGENTS.md, CLAUDE.md, docs/*.md (USER-GUIDE, PACKAGING, RELEASE-CHECKLIST, listing/handoff docs). Count hits per file.
6. **Tests**: every test asserting the old spelling (so they can be updated together).
7. **Do-NOT-change list (confirm each exists and is untouched)**: `slug`, `scheme` (`nurledger://` deep links used by tests/devices), bundle id and package `com.nurlogic.nurledger`, repo/folder names, EAS project, URLs (e.g. `/nurledger-guide`), env/config keys, DB names, SecureStore keys, file/folder names, import paths, commit history.
8. **Company name**: every place the company appears (copyright/footers/About/store developer text) and its spelling (NurLogic vs Nurlogic vs nurlogic.ai). Brand = `NurLogic`; domain `nurlogic.ai` and email `hello@nurlogic.ai` stay lowercase.
9. **Other apps/pages that mention Nurledger**: in this repo only; note (do not touch) anything that needs a change in `conscious-spending-app` or the `nurlogic-ai` website (support page, privacy section 11 heading and text, nurledger-guide page, landing page card).
10. **Store limits**: confirm the store name candidates fit: "NurLedger: Offline POS & Stock" (30 chars, limit 30) and subtitle/short description text from `nurledger-store-listing.md` (Mas's workspace) — list any that go over a limit after the change.

## Part B — apply (only after Mas replies "APPLY RENAME" to your Part A report)
- One commit for app strings/docs/tests: display name, UI strings (en/ms/fil kept in parity), docs, tests; leave the Do-NOT-change list untouched. If an image contains the old spelling, STOP and tell Mas (needs a design asset, not a code change).
- Gates: `npx tsc --noEmit` = 0; `npx jest` default TZ and `TZ=America/Los_Angeles`; `npm run test:strict` = 0 skipped; `git grep -n "Nurledger"` shows only intended leftovers (identifiers/URLs/history) with an explanation list.
- Device check on a debug/release build: launcher label, About/first-run text, a receipt and Z-report header, the PIN prompt in each language. Restore the emulator.
- Push to main; report the hash. Website follow-up is a SEPARATE task (Claude writes it).

## Report
`docs/handoff/reports/0005-report.md`: Part A grouped hit list + do-not-change confirmations + risks; after "APPLY RENAME": commit hash, gate results, device evidence, remaining follow-ups (website, store listing text, Play/ASC names).
