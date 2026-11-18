# Cashier Authentication & Register Lock — Design

Issue: [#26](https://github.com/sghomelab/nurledger-app/issues/26) · Target: **1.2.0** (after the 1.1.1 hotfix)

Status: **design agreed with Mas (2026-11-18)** — pending his final GO before implementation.

## Problem

Anyone at the counter can act as the logged-in cashier: sales, voids and
refunds are attributed to whoever was last selected, with no proof of identity.
An unattended device is an open register.

## Design

### 1. Roles

| Role | Who | Can |
|---|---|---|
| **Owner** | The first user created at setup. Role is **permanent** — cannot be changed from inside the app. | Everything: manage staff, set/reset any PIN, view the audit log, set Store PIN, configure auto-lock |
| **Cashier** | Everyone else (owner adds them) | Sell, restock, view their own shift data |

### 2. PINs

- **Cashier PIN** — optional, 4–6 digits, set per staff member in Settings.
  No PIN set = open access (single-operator shops are unaffected).
- **Store PIN** — owner-only master key, set during setup:
  - unlocks the register when a cashier's PIN is forgotten,
  - resets any cashier PIN (new PIN or clear → open access),
  - opens the audit log.
- **Attribution rule:** a Store-PIN unlock is always attributed to the
  **Owner** — never to the cashier whose PIN was forgotten. Accountability
  stays intact.

### 3. Forgotten PIN / recovery

- Forgotten **cashier** PIN → owner enters Store PIN → reset that cashier's
  PIN. The reset is a logged event.
- Forgotten **Store PIN** → the one-time **recovery code** generated at setup
  lets the owner set a new Store PIN.
  - The code is shown **once** with **Copy / Print / Email me** actions.
    "Email me" hands a pre-filled message to the device's own mail app —
    the app never stores an email address, never uses the network, never
    retains the code (offline-first ethos: no server can send it anyway, and
    a central secret-store would be a bigger target than the problem).
  - Without the code, the only reset is a fresh install (data loss) — unless
    Supabase sync is on, in which case data re-syncs to the new install.

### 4. Immutable audit log

Same discipline as the immutable stock ledger (ADR-002):

- `security_events` table — **insert-only; no update or delete code path
  exists** in the app (the repository only exposes append).
- **Hash-chained:** each row stores the SHA-256 of the previous row. Editing
  or deleting any old row breaks the chain from that point; a built-in
  integrity check recomputes it, and the Z-Report shows the last verified
  state.
- With Supabase sync enabled the log also lives **off-device** — losing or
  wiping the phone doesn't erase synced history.
- Events (all timestamped + attributed): shift start/end, user switch,
  auto-lock, unlock (with method: PIN / Store PIN), PIN set/reset,
  integrity check, (if enabled) void/refund/price-override confirmations.

### 5. Idle timeout (auto-lock)

- **Setting (owner, in Settings):** Auto-lock after — *Never / 1 / 5 / 15 /
  30 min*. Default: **5 min**.
- Any register interaction (tap, key, scan) resets the timer.
- On timeout the register goes to the **lock screen** (PIN pad).

**Timeout LOCKS the session — it does not end the shift.** Rationale: a shift
is the accounting unit (drawer, X/Z reports, totals); ending it on 5 minutes
of idle would shred the Z-Report with constant shift churn. The drawer stays
open, totals keep accumulating.

**Unlock = proof of identity.** The lock screen accepts any PIN:
- the locked-out cashier's PIN → they resume; or
- another cashier's PIN → the register transfers to them (logged as a
  user switch: from/to + method); or
- the Store PIN → the register runs as the **Owner**.

The shift itself ends **only** by explicit shift close (Z-Report) or handover
— never by the clock.

Per-cashier totals remain correct: sales after unlock attribute to whoever
unlocked.

### 6. Optional hardening (needs Mas's GO to include in 1.2.0)

- Cashier PIN required to confirm **voids / refunds / price overrides**;
  high-value actions can require the Store PIN.

### Out of scope (1.2.x candidates)

- Face ID / fingerprint as a convenience unlock (PINs stay the authority).
- Per-cashier permission levels beyond §6.

## Verification plan (when implemented)

- Unit: hash-chain integrity (tamper row → check fails), PIN gate logic,
  timeout state machine (idle → lock → unlock as A/B/owner).
- On-device (cs-test AVD): configurable timeout fires; unlock as each
  identity; Z-Report totals unchanged across an auto-lock; audit log shows
  the full chain; integrity check passes.
