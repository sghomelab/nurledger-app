import { formatMoney, formatMoneyBare, roundDivide, percentOf, marginPct } from '../lib/money';

describe('money — integer minor units (ADR-004, NFR-8)', () => {
  it('formats minor units as currency (acceptance: 1290 = $12.90)', () => {
    expect(formatMoney(1290, 'USD')).toContain('12.90');
    expect(formatMoney(0, 'SGD')).toContain('0.00');
    expect(formatMoney(-250, 'SGD')).toContain('-');
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
