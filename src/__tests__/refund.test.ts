/**
 * Refund math (FR-110) — the amount model is the risky part, so it is pinned
 * here: a FULL refund of the whole sale must sum to EXACTLY sale.total_minor,
 * and a partial refund refunds a rounded share of the line's full value.
 */
import {
  lineFullRefundValues,
  planRefund,
  prorateRefundMinor,
  validateRefundLine,
  type RefundSaleLine,
} from '../lib/refund';

describe('lineFullRefundValues', () => {
  it('single line = the whole sale total', () => {
    expect(lineFullRefundValues([{ lineTotalMinor: 900 }], 999)).toEqual([999]);
  });

  it('splits a total across lines, last line absorbing the remainder', () => {
    // 100 across three equal 1-rupee lines: 3 + 3 + 4 = 10 exactly.
    expect(
      lineFullRefundValues(
        [{ lineTotalMinor: 1 }, { lineTotalMinor: 1 }, { lineTotalMinor: 1 }],
        100,
      ),
    ).toEqual([33, 33, 34]);
  });

  it('is exact when the division is exact', () => {
    expect(
      lineFullRefundValues(
        [{ lineTotalMinor: 100 }, { lineTotalMinor: 200 }, { lineTotalMinor: 300 }],
        600,
      ),
    ).toEqual([100, 200, 300]);
  });

  it('always sums to the sale total (tax share included)', () => {
    const lines = [
      { lineTotalMinor: 890 },
      { lineTotalMinor: 450 },
      { lineTotalMinor: 1234 },
    ];
    const values = lineFullRefundValues(lines, 2889); // e.g. incl. GST
    expect(values.reduce((a, b) => a + b, 0)).toBe(2889);
  });

  it('throws when the sale has no weight', () => {
    expect(() => lineFullRefundValues([{ lineTotalMinor: 0 }], 0)).toThrow();
  });
});

describe('prorateRefundMinor', () => {
  it('full line refund = exactly the line full value', () => {
    expect(prorateRefundMinor(100, 3, 3)).toBe(100);
    expect(prorateRefundMinor(999, 2, 2)).toBe(999);
  });

  it('partial refund = round(full × k / units)', () => {
    expect(prorateRefundMinor(100, 4, 1)).toBe(25);
    expect(prorateRefundMinor(100, 3, 1)).toBe(33);
    expect(prorateRefundMinor(100, 3, 2)).toBe(67);
  });

  it('throws for non-positive units', () => {
    expect(() => prorateRefundMinor(100, 0, 0)).toThrow();
  });
});

describe('validateRefundLine', () => {
  it('rejects zero, negative and fractional units', () => {
    expect(validateRefundLine(100, 2, 0, 0).ok).toBe(false);
    expect(validateRefundLine(100, 2, 0, -1).ok).toBe(false);
    expect(validateRefundLine(100, 2, 0, 1.5).ok).toBe(false);
  });

  it('enforces the already-refunded cap', () => {
    // 2 units sold, 1 already refunded → only 1 remains.
    expect(validateRefundLine(100, 2, 1, 1).ok).toBe(true);
    const over = validateRefundLine(100, 2, 1, 2);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/Only 1 unit remains/);
  });

  it('prices a refund as the incremental share of the line full value', () => {
    // Full line value 100 for 2 units: first unit 50, second 50.
    const first = validateRefundLine(100, 2, 0, 1);
    expect(first).toEqual({ ok: true, amountMinor: 50 });
    const second = validateRefundLine(100, 2, 1, 1);
    expect(second).toEqual({ ok: true, amountMinor: 50 });
  });

  it('33/67 split across two partial refunds of a 3-unit line', () => {
    const first = validateRefundLine(100, 3, 0, 1);
    expect(first).toEqual({ ok: true, amountMinor: 33 });
    const rest = validateRefundLine(100, 3, 1, 2);
    expect(rest).toEqual({ ok: true, amountMinor: 67 });
  });
});

describe('planRefund', () => {
  const lines: RefundSaleLine[] = [
    { id: 'L1', qty: 2, qtyG: null, lineTotalMinor: 800, refundedQty: 0, refundedQtyG: null, unitCostMinor: 600 },
    { id: 'L2', qty: 1, qtyG: null, lineTotalMinor: 400, refundedQty: 0, refundedQtyG: null, unitCostMinor: null },
  ];

  it('full refund of the whole sale sums to EXACTLY the sale total (incl. tax)', () => {
    const plan = planRefund(
      lines,
      1299, // e.g. 1200 + 99 tax
      [
        { saleLineId: 'L1', qty: 2, qtyG: null, restock: true },
        { saleLineId: 'L2', qty: 1, qtyG: null, restock: false },
      ],
      'customer_return',
    );
    expect(plan.totalMinor).toBe(1299);
    // Line full values: round(1299×800/1200)=866, last absorbs → 433.
    expect(plan.lines.map((l) => l.amountMinor)).toEqual([866, 433]);
  });

  it('partial refund prices only the refunded share', () => {
    const plan = planRefund(
      lines,
      1200, // no tax — clean numbers
      [{ saleLineId: 'L1', qty: 1, qtyG: null, restock: true }],
      'wrong_item',
    );
    // L1 full value = 800; 1 of 2 units = 400.
    expect(plan.totalMinor).toBe(400);
  });

  it('prorates weighed lines by grams', () => {
    const weighed: RefundSaleLine[] = [
      { id: 'W1', qty: 0, qtyG: 1000, lineTotalMinor: 890, refundedQty: 0, refundedQtyG: null, unitCostMinor: null },
    ];
    const plan = planRefund(
      weighed,
      890,
      [{ saleLineId: 'W1', qty: 0, qtyG: 250, restock: true }],
      'damaged',
    );
    // 890 × 250/1000 = 222.5 → 223 (round).
    expect(plan.totalMinor).toBe(223);
  });

  it('weighed full-grams refund = exactly the line full value', () => {
    const weighed: RefundSaleLine[] = [
      { id: 'W1', qty: 0, qtyG: 1000, lineTotalMinor: 890, refundedQty: 0, refundedQtyG: 750, unitCostMinor: null },
    ];
    // 750 g already refunded (223 by round(890×750/1000)=668? no: round(890*0.75)=668),
    // remaining 250 g must top the line up to exactly 890.
    const plan = planRefund(
      weighed,
      890,
      [{ saleLineId: 'W1', qty: 0, qtyG: 250, restock: false }],
      'damaged',
    );
    expect(plan.totalMinor).toBe(890 - 668);
  });

  it('rejects over-refunding a line', () => {
    expect(() =>
      planRefund(
        lines,
        1200,
        [{ saleLineId: 'L1', qty: 3, qtyG: null, restock: true }],
        'other',
      ),
    ).toThrow(/Only 2 units remain/);
  });

  it('rejects an unknown sale line', () => {
    expect(() =>
      planRefund(
        lines,
        1200,
        [{ saleLineId: 'NOPE', qty: 1, qtyG: null, restock: true }],
        'other',
      ),
    ).toThrow(/Unknown sale line/);
  });

  it('rejects an empty refund', () => {
    expect(() => planRefund(lines, 1200, [], 'other')).toThrow(/at least one line/);
  });
});
