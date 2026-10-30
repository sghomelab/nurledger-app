/**
 * Local PIN storage + verification (FR-500, FR-501 — "PIN + optional badge scan";
 * badge scan is not wired, PIN is the auth factor).
 *
 * Storage format on app_user.pin_hash: `s:<saltHex>:<sha256(salt + ':' + pin)Hex>`.
 *
 * Threat model (documented, not implied): a shared in-store kiosk device. The
 * gate is friction that stops a cashier from price-overriding / closing shifts
 * without the owner's PIN — it is NOT a cryptographic vault. The salt defeats
 * precomputed 4-digit PIN tables; SHA-256 is used (pure JS, no native dep).
 */

import { sha256Hex } from './sha256';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/** A valid PIN is 4–8 digits. */
export function isValidPin(input: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(input);
}

/** 16 hex chars of salt (Math.random is adequate for PIN-salt purposes here). */
export function randomSaltHex(): string {
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** Hash a PIN with the given salt → the stored format. */
export function hashPin(pin: string, saltHex: string): string {
  return `s:${saltHex}:${sha256Hex(`${saltHex}:${pin}`)}`;
}

/** Create a fresh salted hash for a new PIN. */
export function createPinHash(pin: string): string {
  return hashPin(pin, randomSaltHex());
}

/** Constant-time-ish compare of a PIN against a stored hash (null/invalid → false). */
export function verifyPin(stored: string | null, pin: string): boolean {
  if (!stored || !isValidPin(pin)) return false;
  const m = /^s:([0-9a-f]{16}):([0-9a-f]{64})$/.exec(stored);
  if (!m) return false;
  const expected = sha256Hex(`${m[1]}:${pin}`);
  // Lengths are fixed, so a plain compare is fine; loop for byte-level parity.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ m[2]!.charCodeAt(i);
  }
  return diff === 0;
}
