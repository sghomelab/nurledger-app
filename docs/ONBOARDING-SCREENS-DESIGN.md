# Onboarding Screens — Design (issue #31)

**Status:** DRAFT — awaiting review (merge = design approved).
**Target release:** 1.3.0 (1.2.1 is reserved for the §6 PIN-gate decision on #26).

## 1. What and why

A first-launch **onboarding screen set** (welcome carousel), shown once on a fresh
install before the existing *Set up your store* choice screen. Most apps show this;
NurLedger currently drops new users straight into the sample-data/empty choice with
no context about what the app is or why it works offline-first.

**Current behavior (verified):**
- `app/_layout.tsx` gates the tabs on `isFirstRunPending(db)` — the `seeded_v1`
  settings flag is absent until the owner picks on `FirstRunScreen`
  (sample data vs empty start; `src/db/firstRun.ts`).
- `FirstRunScreen` (`src/components/FirstRunScreen.tsx`) is the only first-run UI.
- `resetAllData` (Settings → Danger zone) clears the flag → the gate re-shows.

## 2. Proposed flow

```
fresh install / factory reset
        │
        ▼
  OnboardingCarousel (NEW — 3 screens)
  [icon + title + 2–3 lines] · dots · Next / Get started
        │  (Get started)
        ▼
  FirstRunScreen (UNCHANGED — sample vs empty)
        │
        ▼
  the app (tabs rendered)
```

**Screen content (en, translated in D5):**
1. **🏪 Your shop, on one device** — selling, stock, shifts and reports in one
   offline-first app. No internet needed to open, sell or close.
2. **📶 Offline first** — run a full day with no signal. Everything is saved on
   the device; nothing is sent anywhere unless you turn on sync.
3. **☁️ Cloud sync is optional** — your own free Supabase project backs up your
   data and shares it across devices, when you're ready. Off by default — see the
   user guide for the 5–10 minute setup.

## 3. Decision log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Where it lives | Inside the existing first-run gate: while `seeded_v1` is pending, root layout renders `OnboardingCarousel` → (Get started) → `FirstRunScreen`. Component-internal stage state; **no new DB flag**. | Reuses the tested gate contract (`src/db/firstRun.ts`, `firstRun.test.ts`, `firstRunSqlite.test.ts` stay green). Re-appears after factory reset, consistent with the choice screen. |
| D2 | Navigation | **Next** button + dot indicators; "Get started" on the last screen. **No swipe** (no gesture/carousel dependency). | Zero new dependencies; deterministic on tablet; avoids gesture-negotiation bugs (see workspace lessons on responder capture). |
| D3 | Dependencies | None. Pure React component + i18n strings + theme tokens. | Keeps the app lean; matches the "self-contained feature" rule. |
| D4 | Visuals | Brand font (Plus Jakarta Sans), existing palette (indigo primary), one large emoji per screen (🏪 📶 ☁️). No image assets. | No binary assets in the bundle; renders identically on phone/tablet. |
| D5 | Languages | **en + ms + fil from day one** (the three languages the app ships). | Static strings, cheap now; avoids a 1.3.1 for missing translations. |
| D6 | Layout | Full-screen, centered column, max-width ~480, min 44pt tap targets; verified in phone portrait **and** tablet landscape (the POS's primary form factor). | The app is tablet-first. |
| D7 | Copy tone | Plain-language, owner-facing (no "POS"/"outbox" jargon); mirrors the user guide's voice. | Consistency with docs the tester already reads. |

## 4. Open items (need Mas's call before build GO)

- **O1 — Screen count:** 3 screens as drafted, or add a 4th (cashier PINs /
  register-lock safety teaser)? *Default: 3.*
- **O2 — Re-watch from Settings:** add "Watch intro again" (would need a small
  settings flag + re-entering the gate)? *Default: no in 1.3.0.*
- **O3 — Languages:** all three (en/ms/fil) now, or en-only with the rest as a
  follow-up? *Default: all three (D5).*
- **O4 — Factory reset re-show:** the carousel re-appears after
  Settings → Reset all data (part of the gate). Acceptable, or should a reset
  skip straight to the choice screen? *Default: re-show (consistent with today's
  gate).*

## 5. Release plan

- **Target 1.3.0** — not 1.2.1 (reserved for #26 §6).
- **No EAS build until Mas's explicit GO** (Gate 2). Per the pre-build question
  sweep: O1–O4 must have explicit answers/deferrals before any build GO.
- Both platforms from the same commit; one hypothesis: *fresh-install users see
  the 3-screen intro, then the existing choice screen, and never the intro again
  (except after a factory reset).*

## 6. Verification plan

1. **Gates:** `npx tsc --noEmit` = 0 · `npx jest` all green (existing
   `firstRun.test.ts` / `firstRunSqlite.test.ts` untouched and passing; new
   component test for stage advance + "Get started" hand-off).
2. **Device (cs-test AVD, `npx expo run:android`):**
   - Fresh install (clear app data) → carousel shows, 3 screens, dots update,
     Next works, **Get started** → `FirstRunScreen` → pick sample/empty → app.
   - Carousel never re-appears on subsequent launches.
   - **Reset all data** (type-to-confirm) → carousel + choice screen re-appear.
   - Language switch to ms/fil → all intro strings render (no raw keys).
   - Tablet landscape: no clipping, tap targets ≥ 44pt.
3. **Regression:** upgrade path — an existing install (flag already set) never
   sees the carousel.
