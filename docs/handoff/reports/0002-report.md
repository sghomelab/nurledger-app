# 0002 report — Nurledger 1.0.0 release readiness audit

**Read-only audit on main. No EAS builds, no submits, no store actions were started.**
Audited code state: **main @ `02287b6`** (the release-checklist merge). The docs-only commit containing this report follows it as the pushed main tip.

## Housekeeping (step 1) — done

- `origin/claude/release-checklist` (`d306853`) merged `--no-ff` into main → `02287b6` (adds `docs/RELEASE-CHECKLIST.md`, 118 lines, clean).
- `docs/handoff/` (README + task files + reports dir) brought onto main by cherry-picking the files from `origin/claude/handoff-nurledger` (task allowed merge or cherry-pick; keeps exactly one merge commit).
- One-line handoff pointer added to `AGENTS.md` (`docs/handoff/README.md`).
- `RELEASE-CHECKLIST.md` status line + Section 1 boxes updated for what was verified here; Mas's boxes and later sections left unticked.
- Post-report update: the task file was amended on the branch (`d5f9720`) with Mas's final iPad decision (support ships) — this report's audit table and to-do list now reflect it (checklist §0 iPad box ticked in the same pass).

## Audit results (step 2)

### app.json

| Item | Result | Value found |
|---|---|---|
| `version` | PASS | `1.0.0` (set for both platforms in one commit, `b201059`) |
| Android `versionCode` | PASS | `2` |
| iOS `buildNumber` | PASS | `"2"` |
| Bundle/package id | PASS | `com.nurlogic.nurledger` (both `ios.bundleIdentifier` and `android.package`) |
| `ios.supportsTablet` | REPORT (unchanged) | **`true`** — Mas decided (2026-11-08) to **ship iPad support**; nothing was changed. iPad layout is **unverified on a real iPad** (no Mac). iPad screenshots (**13" and 11"**) are required before App Store review / public release — not needed for TestFlight internal testing |
| `ITSAppUsesNonExemptEncryption` | PASS | `false` (export-compliance answer pre-declared) |
| Permissions (main manifest) | PASS | Minimal Expo set: `INTERNET`, `READ_EXTERNAL_STORAGE` (maxSdk 32), `WRITE_EXTERNAL_STORAGE` (maxSdk 32), `SYSTEM_ALERT_WINDOW`, `VIBRATE` |
| `allowBackup` | PASS | `false` (app.json + AndroidManifest) — device backups can't carry local data/keys |
| Cleartext traffic | PASS | Blocked in release; `usesCleartextTraffic` true only in `debug`/`debugOptimized` manifests |

### eas.json

| Item | Result | Value found |
|---|---|---|
| Build profiles | PASS | `development` (dev client, internal, channel development), `preview` (internal, channel preview), `production` (`autoIncrement: true`, channel `production`); all three `credentialsSource: "remote"`; `cli.appVersionSource: "local"` (versions come from app.json) |
| `submit.production.android` | FAIL (expected — needs Mas) | Only `{"channel": "internal"}`. **Missing `serviceAccountKeyPath`.** Note: the key file already exists on disk at `secrets/google-play-service-account.json` (gitignored, untracked) — only the eas.json wiring is missing, to be committed after Mas grants the service account on the new Play app |
| `submit.production.ios` | FAIL (expected — needs Mas) | Has `ascApiKeyPath`/`ascApiKeyId`/`ascApiKeyIssuerId` (working key `94Y9L28A97`). **Missing `ascAppId`** — requires the app to be created in App Store Connect first |

No values were invented; both gaps are store-console prerequisites.

### Repo hygiene

| Item | Result | Value found |
|---|---|---|
| Tracked node_modules | PASS | `git ls-files \| grep -c node_modules` = 0 |
| Tracked secrets scan | PASS | `git ls-files \| grep -i -E "secret|\.env|\.jks|\.p8|service.?account"` → nothing |
| `secrets/` gitignored | PASS | `.gitignore` line 8: `secrets/` (key file lives there on disk only) |
| Working tree | PASS | Clean after the docs commit (the 4 handoff files are now committed, not stray) |

### Gates on main `02287b6`

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS — 0 errors |
| `npx jest` (default TZ) | PASS — 544/544 |
| `npx jest` (TZ=America/Los_Angeles) | PASS — 544/544 |
| `npm run test:strict` | PASS — 0 skipped |

(Run again on the pushed docs-only tip after commit; code is byte-identical, so results hold.)

### Docs consistency

| Item | Result | Value found |
|---|---|---|
| PACKAGING.md | PASS | 1.0.0 + versionCode 2 (line 13–14), minSdk API 24 (line 16), English + Bahasa Melayu + Filipino (line 43), `credentialsSource: "remote"` wording (line 28), Android `serviceAccountKeyPath` release-time step (lines 64, 93), HTTPS-only BYO Supabase (line 115) |
| USER-GUIDE.md | PASS | Language line lists English, Bahasa Melayu, Filipino (line 268), HTTPS-only Supabase note (line 326), "Adding cashiers and managing PINs" section (line 397) |

### Production profile (config only — no build made)

A `production` build from this commit produces: non-debuggable store build, version **1.0.0**, Android versionCode **2**, iOS build **2** (all from app.json via `appVersionSource: local`), `channel: production`, `credentialsSource: remote`; `autoIncrement: true` raises the numbers automatically on later builds.

## What Mas must still supply or do (exact list)

1. **iPad** (decision recorded 2026-11-08): support ships, `ios.supportsTablet` stays `true`. Before App Store review / public release (not for TestFlight internal): real-iPad device check + **13" and 11" iPad screenshots** (checklist §0 / §8).
2. **Security hygiene** (checklist §2): rotate any Supabase `service_role` key ever pasted into an older build/chat; confirm the dev Supabase project holds no real data; remove/revoke leftover test accounts.
3. **Policy & support pages** (checklist §3, cross-repo `nurlogic-ai`): publish the Nurledger section at `https://nurlogic.ai/privacy`, create `https://nurlogic.ai/support` (website branch `claude/website-deploy-a`, "Deploy A2"), set the **effective date**, legal review, then open both URLs on a phone.
4. **Legal entity**: confirm the registered spelling ("Nurlogic" vs "NurLogic") for consistent use in policy, support page and consoles.
5. **Google Play Console** (checklist §4): create app `com.nurlogic.nurledger` (name, free, Business), privacy URL + support email, content rating, data-safety form, internal testing track + tester emails; grant the shared service account (`play-store-uploads@ai-agent-497901.iam.gserviceaccount.com`) access to the new app — then OpenCode commits `serviceAccountKeyPath` in eas.json (key already in gitignored `secrets/`).
6. **App Store Connect** (checklist §4): create app (bundle `com.nurlogic.nurledger`) and **report the numeric app id** — OpenCode commits it as `ascAppId` in the iOS submit profile; app privacy "Data Not Collected"; internal testing group + testers.
7. **Build credit check**: confirm Expo free-credit balance on the expo.dev dashboard (not visible from CLI). Stop if unknown.
8. **Build GO**: explicit build approval in the current exchange; both platforms from the same commit (checklist §5).

## Main hash

- Audited code state: **`02287b6`** (main before this docs commit; gates and audit above are on this tree).
- After this report: main tip = the docs commit containing these files (pushed).
