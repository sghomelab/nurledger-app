# 0001 — Verify and merge claude/pin-hardening (Nurledger)

Base: origin/main 149095d; branch `claude/pin-hardening` (ecb4307). Report: `docs/handoff/reports/0001-report.md`.
Do NOT start EAS builds or store actions. Push nothing except the merge to main after all checks pass.

1. `git fetch`; review `git diff origin/main...origin/claude/pin-hardening --stat`. Expected: shift.tsx, PinPrompt.tsx, useShift.ts, roles.ts, userRepository.ts, i18n en/ms/fil, roles.test.ts, docs/USER-GUIDE.md. Flag anything else (esp. tracked node_modules). If USER-GUIDE.md conflicts with the docs commit already on main, keep both changes.
2. Gates: `npx tsc --noEmit` = 0; `npx jest` in default TZ and `TZ=America/Los_Angeles`; `npm run test:strict` = 0 skipped.
3. Device (Android emulator, fresh DB; default Owner PIN 1234, seeded cashier "Jun"). PASS/FAIL + evidence for each:
   a. Cashier -> Shift -> Switch -> Owner: PIN prompt "Switch user"; wrong PIN rejected; 1234 switches.
   b. Owner -> Jun, then Jun -> Owner via PIN; Owner -> anyone needs NO prompt.
   c. As cashier: Add user role Manager -> blocked unless PIN has 4-8 digits ("Owner and manager users need a PIN..."), then owner/manager PIN prompt; wrong PIN creates nothing; correct creates. Role Owner needs the OWNER PIN (manager PIN must not unlock).
   d. Adding a cashier as cashier needs no PIN.
   e. Switch -> "Change PIN…" -> Jun: owner/manager PIN every time, then masked new-PIN sheet (4-8 digits); Save only when valid.
   f. Change Owner PIN to 5678 (needs OWNER PIN). 1234 then fails, 5678 works for a gated action.
   g. Settings -> Reset all data works for Owner and restores Owner PIN 1234.
   h. Repeat a, c, e in Bahasa Melayu and Filipino: no English fragments, no truncation (check long Filipino strings).
   i. USER-GUIDE shows "Adding cashiers and managing PINs" and the Language line lists English, Bahasa Melayu, Filipino.
4. Any failure: stop and report; do not patch silently. All pass: merge --no-ff to main, push, report the new main hash.
5. Restore the emulator to a clean state and say so.
