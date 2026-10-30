/**
 * Shift math (FR-200…FR-204): drawer invariant, variance classes, Z/X report
 * shape. These are the exact numbers the printed Z-report carries.
 */

import {
  buildXReport,
  buildZReport,
  classifyVariance,
  expectedCashMinor,
  varianceMinor,
  type CashMove,
  type CashTotals,
  type SalesByMethod,
} from '../lib/shift';

const NO_MOVES: CashMove[] = [];

describe('expectedCashMinor (drawer invariant)', () => {
  it('float + cash sales + in − out', () => {
    const t: CashTotals = { floatMinor: 10_000, cashSaleMinor: 25_500, cashInMinor: 5_000, cashOutMinor: 1_500 };
    expect(expectedCashMinor(t)).toBe(39_000);
  });

  it('handles zero sales (fresh shift)', () => {
    expect(expectedCashMinor({ floatMinor: 20_000, cashSaleMinor: 0, cashInMinor: 0, cashOutMinor: 0 })).toBe(20_000);
  });

  it('can go below the float when cash out exceeds sales + in', () => {
    const t: CashTotals = { floatMinor: 10_000, cashSaleMinor: 0, cashInMinor: 0, cashOutMinor: 15_000 };
    expect(expectedCashMinor(t)).toBe(-5_000);
  });
});

describe('classifyVariance', () => {
  it('exact at zero', () => {
    expect(classifyVariance(0)).toBe('exact');
  });
  it('over when positive', () => {
    expect(classifyVariance(1)).toBe('over');
    expect(classifyVariance(12_345)).toBe('over');
  });
  it('short when negative', () => {
    expect(classifyVariance(-1)).toBe('short');
    expect(classifyVariance(-9_999)).toBe('short');
  });
});

describe('varianceMinor (counted − expected)', () => {
  it('is counted minus expected', () => {
    const t: CashTotals = { floatMinor: 10_000, cashSaleMinor: 10_000, cashInMinor: 0, cashOutMinor: 0 };
    expect(varianceMinor(20_000, t)).toBe(0);
    expect(varianceMinor(21_000, t)).toBe(1_000);
    expect(varianceMinor(19_000, t)).toBe(-1_000);
  });
});

describe('buildZReport', () => {
  const totals: CashTotals = { floatMinor: 10_000, cashSaleMinor: 40_000, cashInMinor: 5_000, cashOutMinor: 2_000 };
  const byMethod: SalesByMethod = { cash: 40_000, card: 15_000 };
  const moves: CashMove[] = [
    { id: 'm1', type: 'in', amountMinor: 5_000, reason: 'Float top-up', createdAt: 1 },
    { id: 'm2', type: 'out', amountMinor: 2_000, reason: 'Tips out', createdAt: 2 },
  ];

  it('computes expected and variance from the drawer invariant', () => {
    // expected = 10000 + 40000 + 5000 − 2000 = 53000
    const exact = buildZReport({
      shiftId: 's1', deviceId: 'd1', cashierName: 'Jun', openedAt: 100, closedAt: 200,
      salesByMethod: byMethod, cashMoves: moves, totals, countedMinor: 53_000, notes: null,
    });
    expect(exact.expectedMinor).toBe(53_000);
    expect(exact.varianceMinor).toBe(0);
    expect(exact.varianceClass).toBe('exact');
    expect(exact.kind).toBe('Z');
  });

  it('flags over / short and stores the report fields', () => {
    const short = buildZReport({
      shiftId: 's1', deviceId: null, cashierName: null, openedAt: 100, closedAt: 200,
      salesByMethod: {}, cashMoves: NO_MOVES,
      totals: { floatMinor: 10_000, cashSaleMinor: 0, cashInMinor: 0, cashOutMinor: 0 },
      countedMinor: 9_000, notes: 'counted low',
    });
    expect(short.expectedMinor).toBe(10_000);
    expect(short.varianceMinor).toBe(-1_000);
    expect(short.varianceClass).toBe('short');
    expect(short.notes).toBe('counted low');
    // Refunds are 0 until M6 (FR-110/FR-111) — shape is stable.
    expect(short.refundsMinor).toBe(0);

    const over = buildZReport({
      shiftId: 's2', deviceId: null, cashierName: 'Owner', openedAt: 1, closedAt: 2,
      salesByMethod: { cash: 1_000 }, cashMoves: NO_MOVES,
      totals: { floatMinor: 0, cashSaleMinor: 1_000, cashInMinor: 0, cashOutMinor: 0 },
      countedMinor: 1_500, notes: null,
    });
    expect(over.varianceClass).toBe('over');
    expect(over.varianceMinor).toBe(500);
  });
});

describe('buildXReport (interim, no counted/variance)', () => {
  it('snapshots the open shift', () => {
    const totals: CashTotals = { floatMinor: 10_000, cashSaleMinor: 12_000, cashInMinor: 0, cashOutMinor: 1_000 };
    const x = buildXReport('s1', 'Jun', 100, { cash: 12_000 }, totals, 999);
    expect(x.kind).toBe('X');
    expect(x.expectedCashMinor).toBe(21_000);
    expect(x.cashSaleMinor).toBe(12_000);
    expect(x.generatedAt).toBe(999);
    // X has no counted/variance fields.
    expect('varianceMinor' in x).toBe(false);
  });
});
