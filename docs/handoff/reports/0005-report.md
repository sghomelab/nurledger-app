# 0005 report — Rename check "Nurledger" → "NurLedger" (Part A: READ-ONLY audit)

**No rename changes have been made.** This is the Part A audit only; Part B executes after Mas's "APPLY RENAME".
Audited state: `nurledger-app` main @ `fe8a47d`. Note: `app.json` `name` was **already changed to `NurLedger`** in `fe8a47d` (Mas's naming decision, pre-build) — that part is done; everything below is what remains.

Method: `git grep` (tracked files only) for `Nurledger` (title case), `NURLEDGER` (all-caps), `nurledger` (lowercase), `NurLogic|Nurlogic` (company); visual inspection of shipped icon assets; full `app.json` read. Untracked build artifacts under `android/app/build/` were excluded (they regenerate).

## 1. Display name (users/stores see)

| Item | Location | Status |
|---|---|---|
| `app.json` `name` | app.json:3 | **DONE** — already `NurLedger` (fe8a47d). Expo derives the launcher + store display name from this on both platforms |
| iOS `CFBundleDisplayName` / Android `android:label` | app.json (full read) | **No overrides exist** — both fall through to `expo.name`; nothing else to change |
| Info.plist strings | app.json `ios.infoPlist` | Only `ITSAppUsesNonExemptEncryption: false` — no name text |
| `src/components/FirstRunScreen.tsx:52` | `<Text style={styles.appName}>Nurledger</Text>` | **RENAME** (first-run app-name heading) |
| **Images** | `assets/icon.png` (basket + green check), `assets/splash-icon.png` (check bubble), `assets/adaptive-icon-foreground.png` (same art) | **VISUALLY VERIFIED — no lettering in any shipped icon**. Adaptive background/monochrome/favicon are solid colors / same art. No design work needed |
| `icons-proposals/*.png` | 4 AI-generated candidates (tracked) | Not used by the app. Embedded PNG metadata (ComfyUI workflow JSON) contains the lowercase `nurledger-icon/` filename prefix only; generation prompts explicitly exclude text. c3 is an N-monogram candidate (letterform, not the word) — unused |

## 2. UI strings

**i18n — same 3 keys in all three languages (must change in parity):**

| Key | en | ms | fil |
|---|---|---|---|
| `pay.stub` (payment-stub footer on receipts) | en.ts:104 | ms.ts:103 | fil.ts:93 |
| `cloudsetup.note.deployed` | en.ts:267 | ms.ts:266 | fil.ts:225 |
| `cloudsetup.yourProjectHint` | en.ts:293 | ms.ts:292 | fil.ts:245 |

**Hardcoded in code:** `FirstRunScreen.tsx:52` (above, item 1).

**All-caps uses (noted separately — recommendation: LEAVE, they are identifier-style, not the title-case display name):**
- `app/(tabs)/index.tsx:479` — `outletName={cart.outlet?.name ?? 'NURLEDGER'}`: receipt outlet fallback. Already all-caps by design (placeholder outlet name). **Flag: change to `NURLEDGER` is a no-op; leaving as-is.**
- `src/lib/cloud/schemaSql.ts:71` + `src/__tests__/cloudSchema.test.ts:23` + `scripts/fixtures/cloud-schema-v3…v7.sql:4` — `-- NURLEDGER BYO SCHEMA vN` banner in the Supabase paste. Technical banner, all-caps, asserted by test, already deployed into stores' projects as comment-only. **Leave.**

**Code comments only (not user-visible — cosmetic; recommendation: update for consistency, zero risk):**
- `app/cloud-setup.tsx:32`, `src/lib/cloud/supabaseAdapter.ts:5`, `src/types/index.ts:2`

## 3. Generated documents / files

- **Receipts / labels / purchase orders / Z-report:** generated from outlet data; no hardcoded product name found (grep-verified). **Nothing to change.**
- **CSV export file name** `nurledger_products_<stamp>.csv` (`app/csv.tsx:37`): lowercase file name — **stays unchanged** per task rule (file names stay lowercase).
- Schema banner: see item 2 (leave).

## 4. Permission / system strings

**None.** No iOS usage-description strings, no Android permission-rationale text, no notification channels, no privacy-manifest entries — nothing containing the name. The only Info.plist key is `ITSAppUsesNonExemptEncryption` (no text).

## 5. Docs — hits per file, grouped

**Living docs (recommend RENAME):**

| File | Hits | Lines |
|---|---|---|
| `README.md` | 2 | 1, 14 |
| `AGENTS.md` | 2 | 1, 7 (line 7 "Display name **Nurledger**" → must become **NurLedger**) |
| `CLAUDE.md` | 2 | 1, 7 (same) |
| `docs/USER-GUIDE.md` | 21 | 1, 3, 6, 15, 32, 40, 58, 170, 290, 292, 299, 329, 334, 335, 340, 344, 350, 386, 393, 433, 437 |
| `docs/PACKAGING.md` | 4 | 1, 11, 70, 75 |
| `docs/RELEASE-CHECKLIST.md` | 3 | 1, 40, 41 |

Anchor safety: USER-GUIDE TOC link `[Why Nurledger…](#why-nurledger-works-the-way-it-does)` — GitHub anchors are lowercased, so the heading rename to "Why NurLedger…" keeps the **same anchor**. No link breakage.

**Historical records (recommend LEAVE — they record what happened at the time; also contain literal gate phrases that must never be altered):**

| File | Hits |
|---|---|
| `docs/CODE-REVIEW.md` | 2 |
| `docs/FR-COVERAGE.md` | 1 |
| `docs/MILESTONE-REPORTS.md` | 1 |
| `docs/SPEC-DEVIATION.md` | 3 |
| `docs/SYNC-DESIGN.md` | 1 |
| `docs/TABLET.md` | 1 |
| `docs/handoff/0001…0004` task files + `reports/0001…0004` | various — includes the literal protocol strings "GO BUILD NURLEDGER" / "LEGAL SIGNED OFF NURLEDGER" (must stay byte-exact) |

## 6. Tests asserting the old spelling

- `src/__tests__/i18n.test.ts:48` — asserts the **ms** `pay.stub` string containing `Nurledger` → **must update** in the same commit as ms.ts.
- `src/__tests__/cloudSchema.test.ts:23` — asserts the all-caps banner → unchanged (banner stays).
- i18n key-parity test is unaffected as long as en/ms/fil are edited in the same commit.

## 7. Do-NOT-change list — each confirmed present, none touched

| Item | Where | Status |
|---|---|---|
| `slug: "nurledger"` | app.json:4 | ✅ exists, unchanged |
| `scheme: "nurledger"` (deep links `nurledger://…`, used by 0001 device-check notes) | app.json:8 | ✅ |
| Bundle id + package `com.nurlogic.nurledger` | app.json:12, 24 | ✅ |
| Repo name `nurledger-app`; spec folder `/home/mars/.hermes/projects/03-nurlogic/nurledger/` | — | ✅ |
| EAS project (keyed by slug/account) | — | ✅ |
| URL `/nurlogic.ai/nurledger-guide` (website repo) | — | ✅ |
| DB name `nurledger.db` | src/db/database.ts:14 | ✅ |
| ID/SecureStore namespaces `nurledger:seed:v1:`, `nurledger:sync-layer:`, `nurledger:reconcile-layer:` | src/db/seed.ts:27; src/repositories/stockRepository.ts:590, 649 | ✅ |
| Supabase schema functions `nurledger_hash_code`, `nurledger_schema_version`, `nurledger_set_claim` (already deployed in stores' projects) | src/lib/cloud/schemaSql.ts, scripts/fixtures/ | ✅ — **must never change** |
| `package.json` / `package-lock.json` name `"nurledger"` | — | ✅ |
| File/folder names, import paths, commit history | — | ✅ |

## 8. Company name (brand = `NurLogic`; domain `nurlogic.ai` + `hello@nurlogic.ai` stay lowercase)

**Recommend RENAME (living docs):**
- `AGENTS.md:3`, `CLAUDE.md:3`, `README.md:3` — "**Nurlogic.ai.**" is brand+domain mixed; wording decision needed (e.g. "by NurLogic — nurlogic.ai")
- `docs/USER-GUIDE.md:408` — "Nurlogic cannot recover it"
- `docs/PACKAGING.md:113` — "(Nurlogic)"
- `docs/RELEASE-CHECKLIST.md:14` — "Legal entity: **Nurlogic** (Mas to confirm the registered spelling…)" → now confirmed **NurLogic** (2026-11-08); update to record it
- `docs/RELEASE-CHECKLIST.md:38` — "(Nurlogic)"
- `docs/SPEC-DEVIATION.md:7,8` — "Nurlogic mobile stack" / "Nurlogic apps"

**Leave (historical / gate text):** `docs/handoff/reports/0002-report.md:76`, 0004 task + report.
**Verified lowercase-only (no change):** every `nurlogic.ai` / `hello@nurlogic.ai` occurrence is domain/email.

## 9. Other apps / pages (NOTED ONLY — nothing touched)

**nurlogic-ai website (live since A2, 8 Nov 2026) — hit list for the follow-up deploy:**
- `/support`: page title "Nurledger Support — NurLogic" + meta description ("…stock-control app for small shops, by NurLogic")
- `/privacy` section 11: heading "Nurledger — App-Specific Privacy" + intro "Nurledger is a point-of-sale and inventory app…" + body mentions
- `/nurledger-guide`: title, "Why Nurledger works the way it does" section + TOC entry, "Is my data private?" rewrite, claims paragraph, body mentions — **and the worker constant `NURLEDGER_GUIDE_HTML` must be re-synced byte-for-byte with `nurledger-guide.html`**
- `index.html`: landing-page portfolio card
- URL path `/nurledger-guide` and the constant name `NURLEDGER_GUIDE_HTML` stay unchanged.
- Mas's GO "update the site to NurLedger" is on record; per this task the website follow-up is a **separate task** — ask: fold it into APPLY RENAME or wait for the separate task file?
- **conscious-spending-app:** no app-name hits in this repo; the CS guide's lowercase "Nurlogic" is a company-name occurrence (item 8 territory, separate repo).

## 10. Store limits

- **"NurLedger: Offline POS & Stock" = 30 characters = exactly at the 30-char App Store name limit** ✅ (same length as before the rename — nothing overflows).
- `nurledger-store-listing.md` **not found on this machine** (searched workspace-main + .hermes) — subtitle/short-description lengths can't be checked here; the file is in Mas's workspace. Since the rename changes **zero character counts** (Nurledger→NurLedger is 9 chars both ways), no previously-compliant subtitle/short-description (Play ≤80, ASC subtitle ≤30) can newly violate a limit.

## Risks / judgment points for Mas

1. **Scope of "docs":** recommend renaming only *living* docs (README/AGENTS/CLAUDE/USER-GUIDE/PACKAGING/RELEASE-CHECKLIST) and leaving historical records + handoff task/report files byte-exact (they contain literal gate phrases). OK?
2. **All-caps `NURLEDGER` receipt fallback** (index.tsx:479) and the **schema banner** — recommend leave as-is. OK?
3. **Company-name wording** in AGENTS/CLAUDE/README line 3 ("Nurlogic.ai") — propose "by NurLogic — nurlogic.ai". OK?
4. **Website rename:** same APPLY RENAME gate (I have the full hit list + worker re-sync) or a separate task/GO?
5. **Part B gates** (from task): tsc 0; jest both TZs; test:strict 0 skipped; `git grep "Nurledger"` shows only the intended leftovers (historical docs + lowercase identifiers) with an explanation list; device check of launcher label + first-run text + receipt + PIN prompt in all 3 languages on the `cs-test` AVD.

**Nothing has been changed by this audit.** Awaiting Mas's "APPLY RENAME".
