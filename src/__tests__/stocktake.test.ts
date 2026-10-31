/**
 * Stocktake math (FR-304) — variance = counted − book, per line; the summary
 * buckets counted lines into gains / shrinkage and nets the variance.
 * Un-counted lines (countedQty null) contribute nothing to the summary.
 */
import { lineVariance, summarizeVariance, type StocktakeLineInput } from '../lib/stocktake';

describe('lineVariance', () => {
  it('counted − book', () => {
    expect(lineVariance({ bookQty: 10, countedQty: 8 })).toBe(-2);
  });

  it('positive when found more than book', () => {
    expect(lineVariance({ bookQty: 4, countedQty: 9 })).toBe(5);
  });

  it('zero when they match', () => {
    expect(lineVariance({ bookQty: 7, countedQty: 7 })).toBe(0);
  });

  it('null when not counted yet', () => {
    expect(lineVariance({ bookQty: 7, countedQty: null })).toBeNull();
  });

  it('negative book (oversold ledger) still computes', () => {
    expect(lineVariance({ bookQty: -3, countedQty: 0 })).toBe(3);
  });
});

describe('summarizeVariance', () => {
  it('empty scope', () => {
    expect(summarizeVariance([])).toEqual({
      total: 0,
      counted: 0,
      gains: 0,
      losses: 0,
      netVariance: 0,
    });
  });

  it('un-counted lines count toward total only', () => {
    expect(summarizeVariance([{ bookQty: 10, countedQty: null }])).toEqual({
      total: 1,
      counted: 0,
      gains: 0,
      losses: 0,
      netVariance: 0,
    });
  });

  it('buckets gains and shrinkage, nets the variance', () => {
    const lines: StocktakeLineInput[] = [
      { bookQty: 10, countedQty: 8 }, // shrinkage −2
      { bookQty: 4, countedQty: 9 }, // gain +5
      { bookQty: 5, countedQty: 5 }, // zero — counted, but neither
      { bookQty: 3, countedQty: 0 }, // shrinkage −3
      { bookQty: 1, countedQty: null }, // not counted
    ];
    expect(summarizeVariance(lines)).toEqual({
      total: 5,
      counted: 4,
      gains: 1,
      losses: 2,
      netVariance: 0, // −2 +5 +0 −3
    });
  });

  it('weighed lines are plain numbers (grams) — same math', () => {
    // 1250 g book, counted 1100 g → −150 g shrinkage.
    expect(summarizeVariance([{ bookQty: 1250, countedQty: 1100 }]).netVariance).toBe(-150);
  });

  it('zero-variance counted lines never count as gain or loss', () => {
    const s = summarizeVariance([{ bookQty: 6, countedQty: 6 }]);
    expect(s.gains).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.counted).toBe(1);
    expect(s.netVariance).toBe(0);
  });
});
