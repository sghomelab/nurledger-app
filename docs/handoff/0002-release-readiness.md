# 0002 — Nurledger 1.0.0 release readiness (no build, no store actions)

Repo: `nurledger-app`, main is 7c4c063. Report: `docs/handoff/reports/0002-report.md`.
Do NOT start EAS builds, submits or store actions. 0001 (PIN hardening) is done and merged; you may delete the obsolete 0001 file's "to do" status by writing `docs/handoff/reports/0001-report.md` summarising your PIN verification report (gates, checks a-i results, merge hash 7c4c063, emulator note).

1. Docs housekeeping (docs only, one merge, push to main):
   - Merge `origin/claude/release-checklist` (docs/RELEASE-CHECKLIST.md, includes the PIN/support-contact updates) into main.
   - Bring `docs/handoff/README.md` and this folder onto main (merge `origin/claude/handoff-nurledger`, or cherry-pick the README + task files).
   - Add one line to AGENTS.md pointing to `docs/handoff/README.md` (Claude<->OpenCode handoffs go through the repo; reports in `docs/handoff/reports/`).
2. Read-only readiness audit on main (report each as PASS/FAIL with the value found):
   - app.json: version 1.0.0, android versionCode, ios buildNumber, bundle/package id `com.nurlogic.nurledger`, `ios.supportsTablet` current value, `ITSAppUsesNonExemptEncryption`, permissions list minimal, `allowBackup=false`.
   - eas.json: build profiles, submit profiles; list exactly which fields still need Mas's values (iOS `ascAppId`, Android `serviceAccountKeyPath`). Do not invent values.
   - Repo hygiene: no tracked node_modules; `git ls-files | grep -i -E "secret|\.env|\.jks|\.p8|service.?account"` shows nothing unexpected; `secrets/` is gitignored; working tree clean.
   - Gates on main: `npx tsc --noEmit` = 0; `npx jest` in default TZ and `TZ=America/Los_Angeles`; `npm run test:strict` = 0 skipped.
   - docs/PACKAGING.md and USER-GUIDE.md consistent with the above (version, minSdk 24, three languages, HTTPS-only BYO Supabase, PIN section).
   - A release-style Android build is NOT to be made now; just confirm from config what the production profile will produce.
3. Update the status line and the Section 1 boxes of docs/RELEASE-CHECKLIST.md that you have verified (leave Mas's and later sections unticked). Commit docs only.
4. iPad decision: if Mas's message pointing you here contains "SET supportsTablet=false", set `ios.supportsTablet` to false in app.json as its own commit (message: "ios: supportsTablet=false for 1.0 (iPad unverified)"), rerun gates, and note it in the report. Otherwise change nothing and just report the current value.
5. Report: PASS/FAIL table, the exact list of what Mas must still supply or do (consoles, ascAppId, service-account key path, website pages, build credit, GO), and the main hash. Then stop.
