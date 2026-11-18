/**
 * Lock-screen unlock resolution (issue #26 design §5) — PURE.
 *
 * The register lock is unlocked by PROOF OF IDENTITY, and any PIN counts:
 *   - the locked user's own PIN  → resume (kind 'resume')
 *   - another user's PIN         → register transfers (kind 'switch', from/to)
 *   - the Store PIN              → the register runs as the OWNER (kind
 *     'store_pin') — attribution rule, design §2: a Store-PIN unlock is
 *     always attributed to the Owner, never to the cashier whose PIN was
 *     forgotten.
 *
 * The React layer (useSecurity) applies the resolution (setActiveUser) and
 * logs the resulting events; this module only DECIDES.
 */

import { verifyPin } from './pin';
import type { AppUser } from '../types';

export type UnlockResolution =
  | { kind: 'resume'; user: AppUser; method: 'pin' }
  | { kind: 'switch'; from: AppUser; to: AppUser; method: 'pin' }
  | { kind: 'store_pin'; user: AppUser; method: 'store_pin' }
  | null;

/**
 * Decide what a PIN entered on the lock screen means.
 *
 * @param pin          the entered digits (already validated to be a PIN shape
 *                     by the prompt — this function simply finds a match)
 * @param current      the user the register was running as when it locked
 *                     (null = no active user, e.g. first launch edge)
 * @param users        ALL active users (including `current`)
 * @param storePinHash the Store PIN hash, or null if the owner has not set one
 *
 * User PINs are checked first (a PIN that is both a cashier PIN and the Store
 * PIN unlocks as that cashier — the Store PIN is the master key for when NO
 * cashier PIN works, and owner-set PINs are never equal by design). The
 * Store PIN resolves to the user with role 'owner' (the first user — design
 * §1); if no owner row exists it cannot resolve (returns null).
 */
export function resolveUnlock(
  pin: string,
  current: AppUser | null,
  users: AppUser[],
  storePinHash: string | null,
): UnlockResolution {
  for (const u of users) {
    if (u.pinHash && verifyPin(u.pinHash, pin)) {
      if (current && u.id === current.id) return { kind: 'resume', user: u, method: 'pin' };
      if (current) return { kind: 'switch', from: current, to: u, method: 'pin' };
      return { kind: 'resume', user: u, method: 'pin' };
    }
  }
  if (storePinHash && verifyPin(storePinHash, pin)) {
    const owner = users.find((u) => u.role === 'owner');
    if (owner) return { kind: 'store_pin', user: owner, method: 'store_pin' };
  }
  return null;
}
