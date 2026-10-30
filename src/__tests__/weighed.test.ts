/**
 * Weighed-item math tests (FR-103, ADR-004).
 *
 * Weighed products carry PER-KG rates in priceMinor/costMinor; a line holds
 * qty = 1 + qtyG grams. Price/COGS = round(rate × grams / 1000) — integer
 * minor units, never floats.
 */

import { cogsForWeight, formatWeight, linePriceForWeight, parseWeightToG } from '../lib/weighed';

describe('linePriceForWeight (FR-103: price = weight × unit price)', () => {
  it('rounds per-kg rate × grams to the nearest minor unit', () => {
    // $12.00/kg × 250 g = $3.00
    expect(linePriceForWeight(1200, 250)).toBe(300);
    // $12.00/kg × 1.25 kg = $15.00
    expect(linePriceForWeight(1200, 1250)).toBe(1500);
  });

  it('handles fractional pennies by rounding (no float drift)', () => {
    // $1.00/kg × 333 g = 333/10 = 33.3 → 33
    expect(linePriceForWeight(100, 333)).toBe(33);
    // $3.33/kg × 333 g = 110.889 → 111
    expect(linePriceForWeight(333, 333)).toBe(111);
    // $9.99/kg × 7 g = 6.993 → 7
    expect(linePriceForWeight(999, 7)).toBe(7);
  });

  it('tiny weights round to zero (a 1 g line at $0.10/kg costs nothing)', () => {
    expect(linePriceForWeight(10, 1)).toBe(0);
  });

  it('zero weight → zero (guard against empty scale reads)', () => {
    expect(linePriceForWeight(1200, 0)).toBe(0);
  });
});

describe('cogsForWeight (FR-321 COGS fact, per-kg cost)', () => {
  it('mirrors the price math on the cost rate', () => {
    expect(cogsForWeight(500, 500)).toBe(250); // $5.00/kg × 0.5 kg
    expect(cogsForWeight(999, 1234)).toBe(1233); // 1232.666 → 1233
  });
});

describe('formatWeight (display)', () => {
  it('grams below 1 kg stay in grams', () => {
    expect(formatWeight(250)).toBe('250 g');
    expect(formatWeight(999)).toBe('999 g');
  });
  it('1 kg and up switch to kg', () => {
    expect(formatWeight(1000)).toBe('1 kg');
    expect(formatWeight(1250)).toBe('1.25 kg');
    expect(formatWeight(2500)).toBe('2.5 kg');
  });
});

describe('parseWeightToG (manual kg entry)', () => {
  it('parses kg strings to grams', () => {
    expect(parseWeightToG('0.25')).toBe(250);
    expect(parseWeightToG('1')).toBe(1000);
    expect(parseWeightToG('2.5')).toBe(2500);
    expect(parseWeightToG(' 0.999 ')).toBe(999);
  });
  it('rejects empty, zero, negative and garbage', () => {
    expect(parseWeightToG('')).toBeNull();
    expect(parseWeightToG('0')).toBeNull();
    expect(parseWeightToG('0.000')).toBeNull();
    expect(parseWeightToG('-1')).toBeNull();
    expect(parseWeightToG('abc')).toBeNull();
    expect(parseWeightToG('1.2.3')).toBeNull();
  });
});
