/**
 * PIN storage + SHA-256 (FR-500).
 *
 * Known-answer tests use the standard FIPS 180-2 vectors, so the pure-JS
 * SHA-256 is proven correct before it guards anything.
 */

import { sha256Hex } from '../lib/sha256';
import {
  createPinHash,
  hashPin,
  isValidPin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  verifyPin,
} from '../lib/pin';

describe('sha256Hex (FIPS 180-2 known-answer tests)', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes the 56-char message (two-block padding boundary)', () => {
    // "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('is deterministic and salt-sensitive', () => {
    expect(sha256Hex('1234')).toBe(sha256Hex('1234'));
    expect(sha256Hex('1234')).not.toBe(sha256Hex('1235'));
  });
});

describe('isValidPin', () => {
  it('accepts 4–8 digits', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('0000')).toBe(true);
  });

  it('rejects too short, too long, and non-digit input', () => {
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
    expect(isValidPin(' 1234')).toBe(false);
  });

  it('exposes the length bounds', () => {
    expect(PIN_MIN_LENGTH).toBe(4);
    expect(PIN_MAX_LENGTH).toBe(8);
  });
});

describe('createPinHash / verifyPin', () => {
  it('stores a salted hash, never the raw PIN', () => {
    const stored = createPinHash('1234');
    expect(stored).not.toContain('1234');
    expect(stored).toMatch(/^s:[0-9a-f]{16}:[0-9a-f]{64}$/);
  });

  it('verifies the correct PIN and rejects a wrong one', () => {
    const stored = createPinHash('4321');
    expect(verifyPin(stored, '4321')).toBe(true);
    expect(verifyPin(stored, '4322')).toBe(false);
    expect(verifyPin(stored, '1234')).toBe(false);
  });

  it('two hashes of the same PIN differ (fresh salt) but both verify', () => {
    const a = createPinHash('9999');
    const b = createPinHash('9999');
    expect(a).not.toBe(b);
    expect(verifyPin(a, '9999')).toBe(true);
    expect(verifyPin(b, '9999')).toBe(true);
  });

  it('is deterministic for a fixed salt', () => {
    const salt = '0123456789abcdef';
    expect(hashPin('1234', salt)).toBe(hashPin('1234', salt));
    expect(verifyPin(hashPin('1234', salt), '1234')).toBe(true);
  });

  it('fails safely on null / malformed / short input', () => {
    expect(verifyPin(null, '1234')).toBe(false);
    expect(verifyPin('', '1234')).toBe(false);
    expect(verifyPin('garbage', '1234')).toBe(false);
    expect(verifyPin(createPinHash('1234'), '123')).toBe(false);
  });
});
