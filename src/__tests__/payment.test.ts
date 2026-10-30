import { changeDue, evenSplit, isCovered } from '../lib/payment';
import type { PaymentAllocation, PaymentMethodId } from '../types';

/**
 * Payment tender math (FR-107). Integer minor units; split must always sum
 * exactly to the grand total (no penny left behind).
 */

describe('changeDue (FR-107 cash)', () => {
  it('tender over total → change; tender under → 0', () => {
    expect(changeDue(1500, 1000)).toBe(500);
    expect(changeDue(1000, 1000)).toBe(0);
    expect(changeDue(900, 1000)).toBe(0);
  });
});

describe('isCovered', () => {
  const a = (method: PaymentMethodId, amountMinor: number): PaymentAllocation => ({ method, amountMinor });
  it('single method covering the total', () => {
    expect(isCovered([a('cash', 1000)], 1000)).toBe(true);
    expect(isCovered([a('cash', 999)], 1000)).toBe(false);
  });
  it('split across methods sums to the total', () => {
    expect(isCovered([a('cash', 500), a('card', 500)], 1000)).toBe(true);
    expect(isCovered([a('cash', 400), a('card', 400)], 1000)).toBe(false);
  });
});

describe('evenSplit (FR-107) — allocations always sum to the total', () => {
  it('splits evenly when divisible', () => {
    const r = evenSplit(1000, ['cash', 'card']);
    expect(r).toEqual([{ method: 'cash', amountMinor: 500 }, { method: 'card', amountMinor: 500 }]);
  });

  it('distributes the remainder so the sum is exact', () => {
    const r = evenSplit(1001, ['cash', 'card', 'mobile']);
    expect(r.map((x) => x.amountMinor)).toEqual([334, 334, 333]);
    expect(r.reduce((s, x) => s + x.amountMinor, 0)).toBe(1001);
  });

  it('single method takes everything', () => {
    expect(evenSplit(100, ['cash'])).toEqual([{ method: 'cash', amountMinor: 100 }]);
  });

  it('zero total → all zeros', () => {
    const r = evenSplit(0, ['cash', 'card']);
    expect(r.reduce((s, x) => s + x.amountMinor, 0)).toBe(0);
  });

  it('empty methods → empty', () => {
    expect(evenSplit(100, [])).toEqual([]);
  });

  it('sum invariant across many totals/method-counts (no penny lost)', () => {
    const methods: PaymentMethodId[] = ['cash', 'card', 'mobile', 'qr'];
    for (let total = 0; total <= 5000; total += 37) {
      for (let n = 1; n <= methods.length; n++) {
        const r = evenSplit(total, methods.slice(0, n));
        const sum = r.reduce((s, x) => s + x.amountMinor, 0);
        expect(sum).toBe(total);
      }
    }
  });
});
