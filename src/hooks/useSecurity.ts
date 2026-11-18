/**
 * Register security hook (issue #26 design §2/§5) — the app-wide lock state,
 * the idle auto-lock watchdog, and the unlock flow with attribution.
 *
 * Model (mirrors useActiveUser's module-level shared store):
 *  - `locked` is APP-WIDE — one global overlay in app/_layout.tsx, so a lock
 *    on any tab covers the whole register.
 *  - `lastActivity` is a plain module var (NOT reactive): the UI shows no
 *    countdown, only the watchdog reads it, so touching on every button press
 *    must not re-render the tree.
 *
 * Lock ≠ shift end (design #7): locking only hides the register behind the
 * PIN prompt; the open shift / drawer / totals are untouched. Unlock = proof
 * of identity via ANY PIN (see lib/unlock.resolveUnlock):
 *   - the locked user's PIN      → resume
 *   - another user's PIN         → register transfers (logged user_switch)
 *   - the Store PIN              → the register runs as the OWNER
 *
 * The lock is SESSION-scoped (not persisted): a fresh launch starts unlocked
 * and auto-locks after the configured idle timeout.
 *
 * Soft-lock guard (design §2: "No PIN set = open access"): a register with
 * NO unlockable PIN (no user PIN AND no Store PIN) cannot be opened again
 * once locked. Locking is therefore refused in that state — the watchdog
 * stays disarmed and the manual lock button is a no-op until at least one
 * PIN exists (see `anyUnlockable`, refreshed by reloadSecurity()).
 */

import { useCallback, useSyncExternalStore } from 'react';
import { getActiveUser, listActiveUsers, setActiveUser } from '../repositories/userRepository';
import {
  appendSecurityEvent,
  getStorePinHash,
  hasStorePin,
} from '../repositories/securityRepository';
import { getAutoLockMinutes, AUTO_LOCK_DEFAULT } from '../repositories/uiSettingsRepository';
import { resolveUnlock, type UnlockResolution } from '../lib/unlock';
import type { AppUser } from '../types';

export type LockReason = 'idle' | 'manual';

export interface SecurityState {
  /** Whether the register is currently locked (app-wide). */
  locked: boolean;
  /** Why it locked (for the lock screen copy); null when unlocked. */
  lockReason: LockReason | null;
  /** Owner has set a Store PIN (the lock screen offers it as an option). */
  storePinSet: boolean;
  /** The configured auto-lock timeout in minutes (0 = Never). */
  autoLockMinutes: number;
  /** True once reloadSecurity() has run at least once. */
  loaded: boolean;
  /**
   * True when at least one PIN could open a lock — any active user's PIN or
   * the Store PIN. While false, the register is "open access" (design §2)
   * and locking is refused (soft-lock guard).
   */
  anyUnlockable: boolean;
}

let shared: SecurityState = {
  locked: false,
  lockReason: null,
  storePinSet: false,
  autoLockMinutes: AUTO_LOCK_DEFAULT,
  loaded: false,
  anyUnlockable: false,
};
const listeners = new Set<() => void>();
function commit(patch: Partial<SecurityState>) {
  shared = { ...shared, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => shared;
const getServerSnapshot = () => shared;

/** Last register interaction (epoch ms). Non-reactive — watchdog-only. */
let lastActivity = Date.now();

/**
 * Pure idle decision (unit-tested): should the watchdog lock NOW?
 * minutes=0 (Never) → always false; otherwise lock once the idle span
 * reaches the configured timeout.
 */
export function shouldAutoLock(nowMs: number, lastActivityMs: number, minutes: number): boolean {
  if (minutes <= 0) return false;
  return nowMs - lastActivityMs >= minutes * 60_000;
}

/** Test-only: reset the non-reactive idle clock (not the reactive store). */
export function __setLastActivityForTests(ms: number) {
  lastActivity = ms;
}
/** Test-only: read the current idle clock. */
export function __getLastActivityForTests() {
  return lastActivity;
}

/** Test-only: snapshot of the reactive store. */
export function __getSecurityStateForTests(): SecurityState {
  return { ...shared };
}

/** Test-only: reset the reactive store to a fresh, unloaded, unlocked state. */
export function __resetSecurityForTests() {
  shared = {
    locked: false,
    lockReason: null,
    storePinSet: false,
    autoLockMinutes: AUTO_LOCK_DEFAULT,
    loaded: false,
    anyUnlockable: false,
  };
  lastActivity = Date.now();
}

/** Any register interaction → reset the idle clock (no re-render). */
export function touch() {
  lastActivity = Date.now();
}

/** Manual lock (owner's "lock" button on the Shift tab). */
export async function lockNow(reason: LockReason = 'manual') {
  if (shared.locked) return;
  // Soft-lock guard: never lock a register that no PIN could open again
  // (only once we KNOW the PIN state — before the first reload, allow it).
  if (shared.loaded && !shared.anyUnlockable) return;
  const actor = await getActiveUser();
  commit({ locked: true, lockReason: reason });
  await appendSecurityEvent({
    user_id: actor?.id ?? null,
    event_type: 'auto_lock',
    method: 'system',
    detail: reason,
  });
}

/**
 * The watchdog tick (driven by a setInterval in app/_layout.tsx). Locks when
 * the idle span exceeds the configured timeout. Cheap: one subtraction.
 */
export function checkIdle() {
  if (shared.locked) return;
  if (!shouldAutoLock(Date.now(), lastActivity, shared.autoLockMinutes)) return;
  void lockNow('idle');
}

/** Load security config (store-PIN presence + auto-lock timeout) once at boot. */
export async function reloadSecurity() {
  const [storePinSet, autoLockMinutes, users] = await Promise.all([
    hasStorePin(),
    getAutoLockMinutes(),
    listActiveUsers(),
  ]);
  // Soft-lock guard: a user PIN or the Store PIN makes locking safe again.
  const anyUnlockable = storePinSet || users.some((u) => u.pinHash != null);
  commit({ storePinSet, autoLockMinutes, anyUnlockable, loaded: true });
}

/**
 * The shared identity proof (design §5): resolve a PIN against every active
 * user + the Store PIN, apply the result (switching the active user when the
 * identity changes), and log the attributed events.
 *
 * @param surface 'lock' — the register is locked; the resolution ALWAYS logs
 *   an 'unlock' event (proof of identity), plus 'user_switch' when the
 *   register transfers. 'switch' — an explicit user switch from the Shift tab;
 *   only a real transfer is logged ('user_switch'); a no-op PIN (the current
 *   user's own) logs nothing.
 */
export type AuthSurface = 'lock' | 'switch';

export async function authenticateRegister(pin: string, surface: AuthSurface): Promise<UnlockResolution> {
  const [current, users, storePinHash] = await Promise.all([
    getActiveUser(),
    listActiveUsers(),
    getStorePinHash(),
  ]);
  const res = resolveUnlock(pin, current, users, storePinHash);
  if (!res) return null;

  // Who the register runs as after this proof (switch → the other user).
  const unlocker = res.kind === 'switch' ? res.to : res.user;
  // Identity changed (switch to another user, or Store-PIN → Owner)?
  const identityChanged = !current || unlocker.id !== current.id;
  if (identityChanged) await setActiveUser(unlocker.id);

  if (surface === 'lock') {
    // Always log the unlock (proof of identity), attributed to the unlocker.
    await appendSecurityEvent({
      user_id: unlocker.id,
      event_type: 'unlock',
      method: res.method,
      from_user_id: identityChanged ? current?.id ?? null : null,
      to_user_id: identityChanged ? unlocker.id : null,
    });
  }
  // The actual handover, when the register now runs as a DIFFERENT identity.
  if (identityChanged && current) {
    await appendSecurityEvent({
      user_id: unlocker.id,
      event_type: 'user_switch',
      method: res.method,
      from_user_id: current.id,
      to_user_id: unlocker.id,
    });
  }
  return res;
}

/**
 * Attempt to unlock with an entered PIN (called by the lock-screen keypad).
 * Returns the resolution (null = wrong PIN — the caller keeps the lock up).
 */
export async function attemptUnlock(pin: string): Promise<UnlockResolution> {
  const res = await authenticateRegister(pin, 'lock');
  if (!res) return null;
  commit({ locked: false, lockReason: null });
  touch();
  return res;
}

/** The app-wide security state (reactive) + the actions the UI needs. */
export function useSecurity() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const reload = useCallback(() => reloadSecurity(), []);
  const touchCb = useCallback(() => touch(), []);
  const lockCb = useCallback((reason?: LockReason) => lockNow(reason), []);
  const unlockCb = useCallback((pin: string) => attemptUnlock(pin), []);
  return { ...state, reload, touch: touchCb, lock: lockCb, attemptUnlock: unlockCb };
}

export type { AppUser };
