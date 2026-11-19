/**
 * Store PIN (master key) + one-time recovery code (issue #26 design §2/§3).
 *
 * - Store PIN: 4–8 digits, stored as a SALTERD hash (same format as cashier
 *   PINs — pin.ts). The Store PIN is the owner's master key: unlocks the
 *   register when a cashier PIN is forgotten, resets any PIN, opens the
 *   audit log. It is NOT a user PIN — it lives outside `app_user` (secure
 *   KV / keystore backend, see securityRepository).
 * - Recovery code: 12 digits, displayed to the owner ONCE when the Store PIN
 *   is set, stored only as a plain SHA-256 of the digits. Entering it lets
 *   the owner set a NEW Store PIN — it is then consumed (single use).
 *
 * Pure logic — no DB/RN imports.
 */

import { sha256Hex } from './sha256';
import { isValidPin } from './pin';

export const RECOVERY_CODE_DIGITS = 12;

/**
 * Generate a 12-digit recovery code, grouped for humans as XXXX-XXXX-XXXX.
 * Digits from Math.random are adequate (it is a one-time 12-digit secret the
 * owner stores offline — not a long-lived credential).
 */
export function generateRecoveryCode(): string {
  const d: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_DIGITS; i++) {
    d.push(Math.floor(Math.random() * 10).toString());
  }
  return `${d.slice(0, 4).join('')}-${d.slice(4, 8).join('')}-${d.slice(8).join('')}`;
}

/** Strip grouping (dashes/spaces); return bare digits or null if malformed. */
export function recoveryDigits(input: string): string | null {
  const bare = input.replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${RECOVERY_CODE_DIGITS}}$`).test(bare)) return null;
  return bare;
}

/** Storage format: plain sha256 of the bare digits (12 digits need no salt). */
export function hashRecoveryCode(input: string): string | null {
  const bare = recoveryDigits(input);
  return bare ? sha256Hex(`recovery:${bare}`) : null;
}

/** Verify a presented code against a stored hash (constant-time compare, matching pin.ts). */
export function verifyRecoveryCode(input: string, storedHash: string): boolean {
  const h = hashRecoveryCode(input);
  if (h === null) return false;
  let diff = h.length ^ storedHash.length;
  for (let i = 0; i < h.length; i++) {
    diff |= h.charCodeAt(i) ^ (i < storedHash.length ? storedHash.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/** The Store PIN itself reuses cashier-PIN validity rules (4–8 digits). */
export function isValidStorePin(input: string): boolean {
  return isValidPin(input);
}
