# Cashier Authentication & Register Lock — Design

Issue: [#26](https://github.com/sghomelab/nurledger-app/issues/26) · Target: **1.2.0**

Status: **proposed — awaiting Mas's review/merge** (design discussed 2026-11-18).

## Problem

Anyone at the counter can act as the logged-in cashier: sales, voids and
refunds are attributed to whoever was last selected, with no proof of identity.
An unattended device is an open register — the original report: *"I can log-in
using previous user and sabotage the sales, if there is no password."*

## Decisions log

| # | Question (Mas) | Decision | Rationale |
|---|---|---|---|
| 1 | Is there a superuser? Who? | **Owner** = first user at setup. Role permanent, not changeable in-app. | Someone must hold the master key; onboarding fixes identity cleanly. |
| 2 | Master store PIN / master key? | **Yes — Store PIN** (owner-only): unlocks register, resets any PIN, opens audit log. | A single secret the owner controls; every use is attributed to the Owner. |
| 3 | What if someone forgets the PIN? | Cashier PIN → owner resets via Store PIN. Store PIN → one-time **recovery code** from setup. | Two-tier: staff mistakes are cheap; the root of trust has exactly one recovery path. |
| 4 | Capture owner's email for recovery? | **No.** Code shown once with **Copy / Print / Email me** (mailto handoff). App stores no address, uses no network. | Offline-first ethos: no NurLogic server exists to send mail; a central secret-store is a bigger target; a device-stored email dies with the device. |
| 5 | Audit log tamper-proof? | **Insert-only** `security_events` (no update/delete code path) + **SHA-256 hash chain** per row + integrity check surfaced in Z-Report; off-device copy via Supabase sync when enabled. | Same discipline as the immutable stock ledger (ADR-002); chain makes any historical edit detectable. |
| 6 | Unattended device? | **Configurable auto-lock:** Never / 1 / 5 / 15 / 30 min (default 5). Any interaction resets the timer. | "We cannot risk someone accessing the device left unattended." |
| 7 | Does timeout end the shift? | **No — it locks the session.** Unlock = proof of identity (any PIN: self / other cashier → user switch / Store PIN → Owner). Shift ends only by explicit Z-close or handover. | A shift is the accounting unit (drawer, X/Z totals); clock-driven shift churn would shred the Z-Report. |

## Design

### 1. Roles

| Role | Who | Can |
|---|---|---|
| **Owner** | First user created at setup; permanent | Everything: manage staff, set/reset any PIN, view audit log, set Store PIN, configure auto-lock |
| **Cashier** | Everyone else (owner adds them) | Sell, restock, view their own shift data |

### 2. PINs

- **Cashier PIN** — optional, 4–6 digits, per staff member in Settings.
  No PIN set = open access (single-operator shops unaffected).
- **Store PIN** — owner-only master key, set during setup.
- **Attribution rule:** a Store-PIN unlock is always attributed to the
  **Owner** — never to the cashier whose PIN was forgotten.

### 3. Forgotten PIN / recovery

- Forgotten **cashier** PIN → owner enters Store PIN → reset (new PIN, or
  clear → open access). Logged event.
- Forgotten **Store PIN** → one-time **recovery code** (shown once at setup,
  with Copy / Print / Email me) sets a new Store PIN. Without it: fresh
  install (data loss) — unless Supabase sync re-syncs data to a new install.

### 4. Immutable audit log

- `security_events` — **insert-only; no update or delete code path exists**
  (repository exposes append only).
- **Hash-chained:** each row stores the SHA-256 of the previous row; editing
  or deleting any old row breaks the chain from that point. Built-in
  integrity check recomputes it; Z-Report shows the last verified state.
- Supabase sync (when enabled) keeps an **off-device** copy.
- Events (timestamped + attributed): shift start/end, user switch,
  auto-lock, unlock (method: PIN / Store PIN), PIN set/reset, integrity
  check, (if enabled) void/refund/price-override confirmations.

### 5. Idle timeout (auto-lock)

- Setting (owner): Never / 1 / 5 / 15 / 30 min, **default 5**.
- Any register interaction resets the timer; on timeout → **lock screen**.
- **Lock ≠ shift end** (see decisions #6/#7). Unlock accepts any PIN:
  - locked cashier's PIN → resumes,
  - another cashier's PIN → register transfers (logged user switch, from/to),
  - Store PIN → register runs as Owner.
- Per-cashier totals stay correct: sales after unlock attribute to whoever
  unlocked.

### 6. Optional hardening (needs Mas's GO to include in 1.2.0)

- Cashier PIN required to confirm **voids / refunds / price overrides**;
  high-value actions can require the Store PIN.

### Out of scope (1.2.x candidates)

- Face ID / fingerprint as a convenience unlock (PINs stay the authority).
- Per-cashier permission levels beyond §6.

## Release plan

- Target **1.2.0** — after the 1.1.0 tester-verification round settles.
- **No EAS builds until Mas's explicit GO** (build credits are not to be
  consumed to demo or validate this design).
- The 1.1.1 hotfix (iOS "(tabs)" back-label, issue #7) **folds into this
  release** — there is no standalone 1.1.1.
- TestFlight release **only when Mas says so**.

## Verification plan (when implemented)

- Unit: hash-chain integrity (tamper row → check fails), PIN gate logic,
  timeout state machine (idle → lock → unlock as A / B / Owner).
- On-device (cs-test AVD): configurable timeout fires; unlock as each
  identity; Z-Report totals unchanged across an auto-lock; audit log shows
  the full chain; integrity check passes.
