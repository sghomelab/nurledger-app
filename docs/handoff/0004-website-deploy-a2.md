# 0004 — Website "Deploy A2": Nurledger pages (repo: nurlogic-ai)

Report: `docs/handoff/reports/0004-report.md` in this repo. Cross-repo task: you work in `nurlogic-ai`.

## Gate (read first)
Do this ONLY if Mas's message pointing you here contains "LEGAL SIGNED OFF NURLEDGER" and states the confirmed legal entity spelling (Nurlogic vs NurLogic) and either a fixed effective date for the Nurledger privacy section or "no fixed date". If any is missing, do nothing and reply with what is missing.

## Steps
1. Branch `claude/website-deploy-a2` from the code that is currently LIVE (`claude/website-deploy-a1` @ 7c2c4b5, worker version 75dbfbff). Apply ONLY the Nurledger items from `claude/website-deploy-a` @ 8b9d4f7: N1 (/support page, worker route, 2 wrangler.toml patterns), N2 (nurledger-guide.html synced with worker), N3 (Nurledger guide claims + support contact), N4 (/privacy section 11). Do NOT touch the Conscious Spending items (already live) or Deploy B.
2. Apply Mas's entity spelling to the new text (section 11, /support) and the effective date decision. Do not change other existing site text.
3. Show Mas the full diff and every changed sentence; wait for his GO before `wrangler deploy`. Verify before: ESM syntax, smoke test of /support, /privacy, /nurledger-guide, /conscious-spending-guide; guide constants equal html sources.
4. After GO: `npx -y wrangler deploy` from `landing/`. Verify live: /support 200 with "within 3 working days" and hello@nurlogic.ai; /privacy contains "Nurledger — App-Specific Privacy"; /nurledger-guide contains "recorded, not processed"; /conscious-spending-guide unchanged (hello@, no admin@). Report the worker version id.
5. Housekeeping so the repo matches what is live: after the deploy, merge the live branches into `main` of nurlogic-ai in order (A1, then A2) and push; `claude/website-deploy-b` stays unmerged until 1.14.0 is live on both stores.
