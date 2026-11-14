import {
  formatMoney,
  formatMoneyBare,
  roundDivide,
  percentOf,
  marginPct,
  initialMoneyText,
  parseMoneyToMinor,
} from '../lib/money';

describe('money — integer minor units (ADR-004, NFR-8)', () => {
  it('formats minor units as currency (acceptance: 1290 = $12.90)', () => {
    expect(formatMoney(1290, 'USD')).toContain('12.90');
    expect(formatMoney(0, 'SGD')).toContain('0.00');
    expect(formatMoney(-250, 'SGD')).toContain('-');
  });

  it('formats non-SG currencies (FR-602 — currency is a per-outlet setting, not a constant)', () => {
    expect(formatMoney(1290, 'MYR')).toContain('12.90'); // RM 12.90
    expect(formatMoney(1290, 'THB')).toContain('12.90'); // ฿12.90
    expect(formatMoney(1290, 'AED')).toContain('12.90');
    expect(formatMoney(1290, 'EUR')).toContain('12.90');
    expect(formatMoney(1290, 'IDR')).toContain('12.90');
  });

  it('formats zero-decimal currencies (JPY/KRW/VND) without subunits', () => {
    expect(formatMoney(12350, 'JPY')).toBe('¥124'); // 123.50 → rounds to ¥124
    expect(formatMoney(12345, 'JPY')).toBe('¥123'); // 123.45 → ¥123
    expect(formatMoney(10000, 'KRW')).toBe('₩100');
    expect(formatMoney(5, 'VND')).toBe('₫0'); // 0.05 → ₫0 (display only; storage stays 1/100)
  });

  it('falls back to "CODE x.xx" for unrecognizable currency codes', () => {
    expect(formatMoney(1290, 'ZZ9')).toContain('12.90');
  });

  it('bare formatting has no symbol and keeps 2 decimals', () => {
    expect(formatMoneyBare(5)).toBe('0.05');
    expect(formatMoneyBare(1290)).toBe('12.90');
    expect(formatMoneyBare(-1290)).toBe('-12.90');
  });

  it('roundDivide uses integer math (no float drift)', () => {
    expect(roundDivide(10, 3)).toBe(3); // 3.33 → 3
    expect(roundDivide(11, 3)).toBe(4); // 3.67 → 4
    expect(roundDivide(0, 5)).toBe(0);
    expect(roundDivide(5, 0)).toBe(0); // divide-by-zero guard
    expect(roundDivide(-11, 3)).toBe(-4);
  });

  it('percentOf rounds to nearest minor unit', () => {
    expect(percentOf(1000, 9)).toBe(90); // 9% of $10.00
    expect(percentOf(1234, 9)).toBe(111); // 111.06 → 111
    expect(percentOf(999, 9)).toBe(90); // 89.91 → 90
  });

  it('marginPct is revenue-relative', () => {
    expect(marginPct(1200, 750)).toBe(38); // worked example §4.3.1: 37.5% → 38 rounded
    expect(marginPct(0, 100)).toBe(0); // no-revenue guard
    expect(marginPct(1000, 1000)).toBe(0);
  });
});

describe('initialMoneyText — KNOW-1 regression (opening-float 10× input)', () => {
  it('zero initial value renders EMPTY (placeholder shows), never "0.00"', () => {
    expect(initialMoneyText(0)).toBe('');
  });

  it('non-zero initial value is pre-filled (line-price edit flow)', () => {
    expect(initialMoneyText(1550)).toBe('15.50');
    expect(initialMoneyText(1550)).toBe(formatMoneyBare(1550));
  });

  it('typed digits are the value, not a prepend onto an initial "0"', () => {
    // Old behavior: field initialized "0.00", cursor at index 0 → typing "100"
    // produced "1000.00" (10×, reproducible on the production build).
    // Contract now: zero initial → empty text, so "100" types in as "100".
    const typed = initialMoneyText(0) + '100';
    expect(typed).toBe('100');
    expect(parseMoneyToMinor(typed)).toBe(10_000); // 100.00 — NOT 1000.00
  });

  it('empty field still parses to zero (zero float / zero discount remain legal)', () => {
    expect(parseMoneyToMinor(initialMoneyText(0))).toBe(0);
  });
});
