# Lessons Learnt

A running log of things that bit us and what we changed. Newest first.

## 1.0.0 release (2026-11-09)

### A controlled numeric field with the cursor at index 0 stores 10× the typed value
The shift opening-float field initialized "0.00" with the text
cursor at index 0 — typed digits were **prepended** to the initial
"0", so typed `100` stored `1000.00` (persisted on the shift card as
"Opening float SGD 1,000.00" and propagated into "Expected in
drawer"). It was found on the **production** build during the 1.0.0
smoke test and reported, not patched (money-amount bugs do not ship
and get fixed quietly). **Rules:** every money input gets a test
that types a value and asserts the stored minor units; when a
controlled input shows an initial value, verify where the cursor
lands and whether input replaces or prepends; the bug is
state-dependent (a sibling field behaved correctly in one pass), so
"worked once" is not exoneration — the audit belongs in the fix
commit (`TODO.md` 1.0.1).

### Google Play refuses the FIRST production publish on a draft app — it is a console click
A brand-new Play app is a "draft app": the API only accepts
`status:"draft"` releases on the production track; both `completed`
(full rollout) and `inProgress` (staged) 400 with "Only releases
with status draft may be created on draft app." **Rule:** for a
first release, stage everything via API (binary, listing, images,
draft release), then one console click — "Start rollout to
production." After that the app is "activated" and every future
release is API-automatable. (Same one-time console creation
required for the app record itself — the Play API has no
create-app endpoint; see below.)

### The Play API has no create-app (or app-list) endpoint
Probing 9 package-name variants all returned `404 Package not
found` — the app record had simply never existed, and there is no
`applications.list` to discover it. **Rule:** for a new app, Mas
creates it in Play Console once (Users and permissions → grant the
shared service account), and `tools/play_check.py <package>`
confirming the record exists is the gate before any API work.

### Read Play tracks through an EDIT — direct `tracks/{name}` GETs 404
`GET …/tracks/production` straight off the app resource 404s even
with a valid token and existing release; the working path is
`POST …/edits` → `GET …/edits/{id}/tracks` (what
`tools/play_check.py` does). **Rule:** always edit-scoped for reads;
the edit is disposable.

### Play listing images live under `listings/{lang}/{imageType}`
The phone-screenshot imageType is **`phoneScreenshots`** (not
"phone"), media uploads go to `/upload/…/listings/en-US/
phoneScreenshots` as raw bytes (no base64 body), and the commit
endpoint is `:commit`. Carried over from the Conscious Spending
playbook — it held up unchanged.

### The ASC API version here is NOT the classic recipe — trust `associatedErrors`
On a brand-new ASC app, `POST /reviewSubmissionItems` 409s with the
**authoritative remaining-blocker list** in
`meta.associatedErrors` (pricing, primary category, screenshots,
app-privacy answers, review contact, demo account). Recipe quirks
observed (differ from the workspace AGENTS.md recipe written for an
older API version):
- `ageRatingDeclarations` — **UPDATE only** (create/get forbidden);
  declaration id = the appInfo id; every update requires **all 23
  attributes** (13 string enums + 10 booleans; "violence" is not an
  attribute).
- `appStoreReviewDetails` — top-level resource; create REQUIRES the
  `appStoreVersion` relationship; **every PATCH validates the whole
  entity** (setting `demoAccountRequired:false` alone 409s without
  the contact fields).
- `privacyPolicyUrl` + `subtitle` live on `appInfoLocalizations`;
  `description`/`keywords`/`supportUrl`/`whatsNew` on
  `appStoreVersionLocalizations`; `copyright` on `appStoreVersions`.
- `whatsNew` persistently 409s "cannot be edited at this time" for a
  first version — it is optional for v1, so skip.
- Pricing + primary category are read-only via API → console.
- A placeholder version in PREPARE_FOR_SUBMISSION blocks creating a
  new version (409) — **rename** the placeholder instead.
**Rule:** on a new app, check `associatedErrors` before assuming a
recipe bug; split the work by "API-reachable" vs "console-only" and
say which is which.

### The iPad 13" store slot is `APP_IPAD_PRO_3GEN_129` @ 2064×2752 — not the 12.9" type
The required `IPAD_13_PROFILE` slot is satisfied by set type
`APP_IPAD_PRO_3GEN_129` (accepts **2064×2752**). `APP_IPAD_PRO_129`
(the legacy 12.9" class) **strictly** accepts only 2048×2732 —
2064×2752 on it fails `SPEC_MISMATCH`, and 2048×2732 on it does
**not** clear `IPAD_13_PROFILE`. The enum has no type literally
named "13". iPhone parallel: `APP_IPHONE_67` now strictly wants
**1290×2796** (1284×2778 fails `SPEC_MISMATCH`). **Rule:** know the
type → resolution → slot mapping before capturing; verify the slot
cleared (`associatedErrors` / the required-screenshots list), not
just the upload `COMPLETE`.

### Store screenshots from the production APK on exact-resolution AVDs (zero build credits)
With no Mac/iPhone on the server, the store screenshots were
captured from the **production universal APK** on custom Android
AVDs at the exact App Store display resolutions (RN UI renders
platform-identically), then post-processed: status bar cropped,
Android gesture pill erased (white fill in the center strip), full
width kept, padded to target height with edge-sampled background
color. **Rule:** this is faithful for UI screenshots (not for
platform-specific behaviour); keep the AVD recipe + scripts
reproducible; the app state must be "populated" (real sale recorded
→ populated Insights), never an empty state.

### Ad-hoc taps on emulators: locate targets by pixel analysis, not by eye
Context images are scaled — visual estimates were wrong twice (OK
button, chip row). **Rule:** numpy pixel-color analysis on the real
screencap to find the target coordinates; verify the result via
`uiautomator dump`.

### EAS `configure-build` is hardcoded interactive — patch the ctx flags, don't fight the TTY
For the new app's iOS profile, piping stdin failed (prompts need a
TTY) and `script -qec` hung. Deterministic fix: temporarily patch
`SetUpIosBuildCredentials.js` to
`nonInteractive: true, autoAcceptCredentialReuse: true`, run with
the ASC-key env vars, **revert the patch**. **Rule:** keep this
recipe documented (it is in `memory/2026-11-09.md`) — the same will
be needed for every new NurLogic app.

### EAS auto-picks the WRONG distribution cert for a new app
`eas credentials:configure-build` auto-selected Rutini's
`iPhone Distribution` cert (`3619AB33…`, private key **not held**)
instead of the working `Apple Distribution` cert
(`439934F9…`). The profile looked active; the iOS build would have
failed at signing. **Rule (reaffirmed):** after creating a new
app's profile, verify the embedded cert serial from the profile
blob (openssl cms) — never trust the UI. Only `439934F9…` is ever
used.

### EAS auto-increment: configured 2 → built 3, app.json rewritten
Both platforms were configured at versionCode/buildNumber 2; EAS
built 3 (its `max(configured, store-max)+1` rule, with the internal
submit's vc3 already on the store by then) and rewrote `app.json`
during the build. **Rule (reaffirmed):** commit the version bump
before queuing; verify the ACTUAL numbers from the AAB manifest /
IPA Info.plist; sync app.json to the actuals in a follow-up commit
(`0957853`).

## Development (M1–Post-M6)

### RN `Alert.alert` silently truncates to 3 buttons
`Alert.js:100` does `buttons.slice(0, 3)` — pickers with more
options showed 3 items, reversed, with the rest silently dropped.
Two **latent** bugs (M1 category picker, M3 PO product picker) were
fixed this way. **Rule:** choice lists with >3 options use
`src/components/PickerOverlay.tsx` (bottom sheet, own ScrollView,
definite height) — never `Alert.alert`.

### Categories were local-only and stalled an entire device's pull
A CSV-created category on device A made device B's product upsert
violate `category_id` FK and roll back **the whole pull batch
forever** (stale cursors, every sync tick re-failing). Fixed with
cloud schema v3: categories sync, are pulled FIRST, and
same-name/different-id rows are remapped instead of failing.
**Rule:** every local table that an FK target can point at must be a
synced entity; a cross-device E2E (two real emulators + a real
database) is the only test that found it.

### A SAF URI through a router query string gets percent-decoded → SecurityException
The document-picker URI carried via `router.push` params was decoded
(`document%3A…` → `document:…`); AMS grant lookup is an exact-match
against the encoded string. **Rule:** pass file handles out-of-band
(`src/lib/pickedFile.ts` module state), never through route params.

### `useT` with per-instance state left the root-layout header stale
The header kept the old language until the next navigation. Fix: a
module-level store on `useSyncExternalStore` so **every** mounted
instance re-renders on the same tap. **Rule:** app-wide reactive
state (language, theme) is a module store, not per-component state.

### Money math: store the applied delta, never recompute it
Refunds allocate the sale total across lines by proration with the
last line absorbing the rounding remainder, so a full refund sums to
**exactly** `sale.total_minor`; restock restores the FIFO cost layer
at the sold cost. **Rule (reaffirmed from ADR-004):** integer minor
units end to end; anything that changes another record stores what
it actually did so undo/edit/delete are exact.

### UTC dates on user-facing records are a bug
A 5 AM stocktake stamped its reason with *yesterday's* UTC date.
**Rule:** user-facing timestamps use the local date.

### A test and the code disagreed — a third computation settles it
(General rule, kept from the workspace log: when a test and code
disagree, settle it with an independent computation before changing
either — done here for the FIFO worked example and the refund
proration.)
