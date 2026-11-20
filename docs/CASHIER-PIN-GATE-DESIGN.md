# Cashier PIN on Sensitive Actions — Design (issue #33, CASHIER-AUTH §6)

**Status:** DRAFT — awaiting review (merge = design approved).
**Target release:** 1.2.1 (the slot reserved for §6).
**Supersedes:** `CASHIER-AUTH-DESIGN.md` §6 "Optional hardening" (needs Mas's GO) —
Mas gave GO on 2026-11-20 with one condition: **a store-level on/off toggle,
owner-only**.

## 1. What and why

When the register runs as a **cashier**, sensitive actions (refunds / voids,
price overrides) are currently unlocked by *any* owner/manager PIN (FR-501,
`PinPrompt`). The person who typed the PIN and the person who is at the
register can be different — the audit log attributes the action to the active
user (the cashier), but the cashier never personally confirmed it.

§6 adds **personal confirmation**: when the store-level switch is **ON**, a
cashier must enter **their own PIN** to confirm a refund or price override.
The action is then provably theirs in the audit log. Owners/managers are never
prompted (they act directly).

**Current behavior (verified in code, 1.2.0):**
- `src/lib/roles.ts` — `roleCanAct`: owner/manager pass every gate; cashier
  fails every gate → `PinPrompt` asks for an **owner/manager PIN**
  (single-action unlock, never persisted).
- Gates: discount, price_override, stock_adjust, close_shift, store_settings,
  refund, stocktake_apply, switch_user, add_user, change_pin.
- X-report (Shift snapshot) is **not gated** for any role — the user guide
  currently claims it is; that line gets corrected in the doc update (D5).
- Audit log: `SecurityEventType` (TEXT column — adding a value needs no
  migration): shift_start/end, user_switch, auto_lock, unlock, pin_set,
  pin_reset, recovery_used, integrity_check.
- Security settings (Store PIN, auto-lock, reset PIN, verify log) live in
  Settings → Security, which the guide already marks **owner only**.

## 2. Proposed design

### The setting (D1)

- `uiSettings`: new boolean **`cashier_pin_on_gates`**, **default OFF** (O1).
  Same pattern as `auto_lock_minutes` — read via `uiSettingsRepository`.
- Settings → Security (owner-only section), new row:
  **"Cashier PIN on refunds & price overrides"** — toggle.
  Caption: *"When on, a cashier must enter their own PIN to confirm a refund
  or price override. The action is logged against that person. Owner and
  manager are never asked."*
- Only the owner's Settings screen shows the Security section → **owner-only
  by construction** (no extra check needed; the section is already gated by
  the same `store_settings` flow as the other rows).

### Behavior when ON (D3)

| At the register | Refund / void | Price override | Everything else |
|---|---|---|---|
| **Owner** | direct (no prompt) | direct | direct |
| **Manager** | direct (no prompt) | direct | direct |
| **Cashier with a PIN** | prompt: **their own PIN only** → confirm | same | unchanged (owner/manager PIN) |
| **Cashier, no PIN set** | **blocked** — "This action needs your own PIN — ask an owner or manager" (O2) | same | unchanged |

- "Void" = full refund (the app has no separate void action) — covered.
- Owner/manager PINs are **rejected** on the cashier prompt (otherwise the
  accountability is hollow). If the owner is at the counter they switch to
  themselves and act directly.
- On success: action proceeds, attributed to the cashier (as today) **plus a
  new audit event `pin_confirm`** (method `pin`, detail = the gate action) —
  the hash chain already makes it tamper-evident.
- The confirmation is **per action** (same as today's single-action unlocks) —
  never persisted, no session caching.

### When OFF (default) — today's behavior exactly

Cashier → owner/manager PIN prompt for refunds/price overrides, as in 1.2.0.
Existing stores see no change until the owner turns the switch on.

## 3. Decision log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Setting | Boolean in `uiSettings` (`cashier_pin_on_gates`), default OFF, owner-only via the existing Security section. | Backward-compatible; matches the auto-lock pattern; no new schema. |
| D2 | Scope | **Refund (incl. void) + price override only.** Discount, stock adjust, stocktake, shift close, settings keep the owner/manager-PIN rule. | Exactly §6's list ("voids / refunds / price overrides"); keeps the change small and testable. (O3 can widen it.) |
| D3 | Who is prompted | Cashiers only, own PIN only; owner/manager act directly; no-PIN cashier is blocked with a clear message. | Accountability is the point — an owner-PIN fallback would defeat it. |
| D4 | Audit | New event type `pin_confirm` (TS union + TEXT column — no migration), logged on each confirmed action. | Tamper-evident proof of personal confirmation. |
| D5 | Docs | New guide section **"Roles: what owners and cashiers can do"** with the permission matrix (below) + FAQ entries; `CASHIER-AUTH-DESIGN.md` §6 marked shipped; **fix the guide's wrong X-report claim** (X-report is not PIN-gated — verified in code); website guide + support page synced. | Mas's request: document the two roles everywhere the guide lives. |
| D6 | Dependencies | None. Reuses `PinPrompt` (new prop: `ownPinOnly`), `uiSettingsRepository`, audit log. | Self-contained feature; no schema migration. |
| D7 | Languages | en + ms + fil (the three shipped languages) for the new strings. | Consistent with the app. |

## 4. The roles matrix (canonical — mirrored into the guide)

| Action | Owner | Manager | Cashier |
|---|---|---|---|
| Sell, edit order, open shift, X-report, cash in/out | ✓ | ✓ | ✓ |
| Discount | ✓ | ✓ | Owner/manager PIN |
| **Price override** | ✓ | ✓ | Owner/manager PIN — **or own PIN when the store switch is ON** |
| **Refund / void** | ✓ | ✓ | Owner/manager PIN — **or own PIN when the store switch is ON** |
| Stock adjust, apply stocktake | ✓ | ✓ | Owner/manager PIN |
| Close shift (Z-report) | ✓ | ✓ | Owner/manager PIN |
| Store settings (incl. this switch) | ✓ | PIN (owner-level) | — |
| Store PIN (set/reset/recovery) | ✓ | — | — |
| Add user / change a PIN | ✓ | add: PIN (owner-level); change: owner PIN only | — |
| Reset all data (danger zone) | ✓ | PIN (owner-level) | — |

Note: "Owner-level PIN" = the Store PIN (or an owner's user PIN). The
Manager role exists for shops that want a second keyholder; for every gate in
1.2.x, manager and owner are treated the same except the rows marked
"owner PIN only" / "—".

## 5. Open items (need Mas's call before build GO)

- **O1 — Default:** new installs and existing stores start with the switch
  **OFF** (owner opts in)? *Default: OFF.* (ON-by-default changes behavior
  for existing shops mid-release.)
- **O2 — Cashier without a PIN:** when the switch is ON and the cashier has no
  PIN, the action is **blocked** with "ask an owner or manager" (they cannot
  borrow an owner/manager PIN for this action). Acceptable? *Default: yes —
  block.*
- **O3 — Scope:** refund + price override only (per §6), or also **discounts**
  while we're at it? *Default: §6 scope only (refund + price override).*
- **O4 — Manager prompting:** managers always act directly (never prompted by
  this switch), even in cashier-only shops where the owner set the switch on
  "for the cashiers". Confirm? *Default: yes — managers exempt.*

## 6. Release plan

- **Target 1.2.1** — the slot already reserved for §6.
- **No EAS build until Mas's explicit GO** (Gate 2). Pre-build question sweep:
  O1–O4 must have explicit answers/deferrals. Both platforms from the same
  commit. Hypothesis: *with the switch ON, a cashier's refund/price override
  requires their own PIN (owner/manager PINs rejected, no-PIN cashier
  blocked), each confirmation is logged as `pin_confirm`, and owners/managers
  are never prompted; with it OFF, 1.2.0 behavior is unchanged.*
- Docs (D5) ship in the same release — guide + FAQ + design docs + website.

## 7. Verification plan

1. **Gates:** `npx tsc --noEmit` = 0 · `npx jest` all green, including new
   cases: gate-decision table (ON/OFF × role × has-PIN), `pin_confirm` event
   written on confirm, owner/manager-PIN rejected on the own-PIN prompt,
   default-OFF regression (1.2.0 behavior byte-identical).
2. **Device (cs-test AVD):**
   - Switch OFF (default): cashier refund prompts for owner/manager PIN — same as 1.2.0.
   - Switch ON: cashier refund → own PIN works; owner PIN rejected; wrong PIN
     rejected; no-PIN cashier → blocked message. Same for price override.
   - Owner/manager never prompted in any state.
   - Settings → Verify audit log shows the `pin_confirm` rows.
   - Language switch to ms/fil → all new strings render.
3. **Docs:** guide matrix matches the code's gate table (grep `GateAction`
   vs the table); X-report line corrected; website byte-identical re-embed +
   live check.
