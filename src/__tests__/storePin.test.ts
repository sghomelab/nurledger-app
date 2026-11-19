/**
 * Store PIN + one-time recovery code (issue #26 design §2/§3).
 * @jest-environment node
 */
import {
  RECOVERY_CODE_DIGITS,
  generateRecoveryCode,
  hashRecoveryCode,
  isValidStorePin,
  recoveryDigits,
  verifyRecoveryCode,
} from '../lib/storePin';

describe('storePin', () => {
  it('generates a 12-digit code grouped as XXXX-XXXX-XXXX', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    expect(recoveryDigits(code)).toHaveLength(RECOVERY_CODE_DIGITS);
  });

  it('recoveryDigits strips dashes/spaces and validates length', () => {
    expect(recoveryDigits('1234-5678-9012')).toBe('123456789012');
    expect(recoveryDigits(' 1234 5678 9012 ')).toBe('123456789012');
    expect(recoveryDigits('12345678901')).toBeNull(); // 11 digits
    expect(recoveryDigits('1234567890123')).toBeNull(); // 13 digits
    expect(recoveryDigits('1234-5678-9O12')).toBeNull(); // non-digit
  });

  it('hashes deterministically (same input → same hash)', () => {
    const a = hashRecoveryCode('1234-5678-9012');
    const b = hashRecoveryCode('123456789012');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes different codes differently', () => {
    expect(hashRecoveryCode('1234-5678-9012')).not.toBe(
      hashRecoveryCode('1234-5678-9013'),
    );
  });

  it('rejects malformed input at the hash layer', () => {
    expect(hashRecoveryCode('short')).toBeNull();
    expect(hashRecoveryCode('')).toBeNull();
    expect(hashRecoveryCode('abcdefghijklmnop')).toBeNull();
  });

  it('verifies the right code and rejects the wrong one', () => {
    const stored = hashRecoveryCode('1234-5678-9012')!;
    expect(verifyRecoveryCode('123456789012', stored)).toBe(true);
    expect(verifyRecoveryCode('1234-5678-9012', stored)).toBe(true); // grouping tolerated
    expect(verifyRecoveryCode('1234-5678-9013', stored)).toBe(false);
    expect(verifyRecoveryCode('garbage', stored)).toBe(false);
  });

  it('store PIN validity reuses the cashier PIN rules (4–8 digits)', () => {
    expect(isValidStorePin('1234')).toBe(true);
    expect(isValidStorePin('12345678')).toBe(true);
    expect(isValidStorePin('123')).toBe(false);
    expect(isValidStorePin('123456789')).toBe(false);
    expect(isValidStorePin('12a4')).toBe(false);
  });
});
