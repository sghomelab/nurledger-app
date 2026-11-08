# 0004 report — Website "Deploy A2": Nurledger pages (repo: nurlogic-ai)

**Cross-repo task. All work happened in `nurlogic-ai` (the website repo); this report lives here per the task.**
Deployed and live. Worker version: **`05ad1c3e-742a-4761-abb7-f2cb5a925ac0`** (name `raspy-math-274a`, wrangler 4.86.0). Previous live version was `75dbfbff` (deploy A1).

## Gate (step 1) — satisfied

Mas's message contained all three required elements:
- "LEGAL SIGNED OFF NURLEDGER" ✅
- Entity spelling: **NurLogic** (capital L) ✅
- Effective date for the Nurledger privacy section: **today, 8 November 2026** ✅

## What was deployed (N1–N4 only)

Branch `claude/website-deploy-a2` @ **`5817aa0`**, branched from the code that was LIVE (`claude/website-deploy-a1` @ `7c2c4b5` = worker `75dbfbff`). Applied only the Nurledger items from `claude/website-deploy-a` @ `8b9d4f7` — exactly the subset that A1's commit message listed as excluded for a later A2:

| Item | Change |
|---|---|
| N1 | `/support` page (`SUPPORT_HTML` in worker) + worker route (`/support`, `/support.html`) + 2 `wrangler.toml` route patterns |
| N2 | `nurledger-guide.html` synced into the worker's `NURLEDGER_GUIDE_HTML` constant — "Why Nurledger works the way it does" ethos section + TOC entry, Payment Mix KPI bullet |
| N3 | Nurledger guide privacy section — device-first + HTTPS-only sync wording, no ads/analytics/tracking, payments **recorded not processed**, not BIR-registered receipting, "within 3 working days" support link to `/support` |
| N4 | `/privacy` section 11 — "Nurledger — App-Specific Privacy" |

**Diff vs live:** 3 files, +216/−5 (`nurledger-guide.html`, `privacy-worker.js`, `wrangler.toml`). Zero Conscious Spending changes — the CS guide constant is byte-identical to its html file and was untouched. Deploy B (`5ca6918`) not touched.

## Mas's decisions applied (step 2)

- **Entity spelling `NurLogic`** in all new text: 9 occurrences fixed in section 11, the /support page, and the new guide text. Pre-existing site text untouched — one pre-existing lowercase "Nurlogic" inside the Conscious Spending guide (worker line 4468) deliberately left as-is.
- **Effective date:** section 11 now ends: *"This section takes effect on 8 November 2026 and is subject to the policy above."* (Mas's GO said to use the deploy date if it had drifted; deploy happened on 8 November 2026, so the written date was already correct and was kept.)

## Pre-deploy verification (all pass)

- ESM syntax OK (worker imports cleanly under node).
- Node smoke test of the local worker, 5 routes all 200: `/support` + `/support.html` ("within 3 working days", hello@nurlogic.ai, "by NurLogic"), `/privacy` (section 11 + effective date, no lowercase entity in s11), `/nurledger-guide` ("recorded, not processed", `/support` link), `/conscious-spending-guide` (hello@, zero admin@ — unchanged).
- `NURLEDGER_GUIDE_HTML` constant ≡ `nurledger-guide.html` source (minus the file's trailing newline — same convention as before).
- `CONSCIOUS_SPENDING_GUIDE_HTML` constant byte-identical to its html file (untouched).

## Deploy + live verification (step 4)

`npx -y wrangler deploy` from `landing/` after Mas's GO. **Live verification of all four URLs — ALL PASS:**

| URL | Status | Checks |
|---|---|---|
| `https://nurlogic.ai/support` | 200 | "within 3 working days" ✅ · hello@nurlogic.ai ✅ · "by NurLogic" ✅ |
| `https://nurlogic.ai/privacy` | 200 | "Nurledger — App-Specific Privacy" ✅ · "takes effect on 8 November 2026" ✅ · no lowercase entity in s11 ✅ |
| `https://nurlogic.ai/nurledger-guide` | 200 | "recorded, not processed" ✅ · `/support` link ✅ · ethos section ✅ · Payment Mix ✅ |
| `https://nurlogic.ai/conscious-spending-guide` | 200 | unchanged: hello@ ✅ · zero admin@ ✅ |

## Housekeeping (step 5) — done

- `nurlogic-ai` `main`: merged `claude/website-deploy-a1` (`7c2c4b5`) then `claude/website-deploy-a2` (`5817aa0`) — both fast-forwards; pushed `ac15d85` → **`5817aa0`**.
- `claude/website-deploy-b` (`5ca6918`) **NOT merged** (stays unmerged until 1.14.0 is live on both stores) — verified it is not in main.
- `claude/website-deploy-a` (`8b9d4f7`) left as-is (its Nurledger content is now fully in main via A2; its CS content was already in main via A1).

## 0003 status

**Unchanged and gated.** 0003 (release execution) was not started — it requires Mas's "GO BUILD NURLEDGER" plus the ASC numeric app id, Play app/SA/internal-track confirmation, and Expo credit balance. Nothing here affects it.
