import { allocateCogs, computeTotals } from '../lib/sale';
import { flatRateTaxEngine } from '../lib/tax';
import { consumeFifo, type LayerInput } from '../lib/stock';
import type { CartLine } from '../types';

/**
 * Cart + sale math (M2 register). Money = integer minor units (ADR-004).
 * Reference locale: SG / SGD / GST 9% inclusive.
 */

const gst = flatRateTaxEngine('flat:sg-gst-9-inclusive', 9, 'inclusive');

const line = (o: Partial<CartLine> = {}): CartLine => ({
  key: 'k',
  productId: 'p1',
  sku: 'SKU-1',
  name: 'Item',
  unitPriceMinor: 1000,
  qty: 1,
  taxCategory: 'standard',
  discountMinor: 0,
  cogsMinor: 0,
  unitCostMinor: null,
  lotId: null,
  stockQty: 99,
  ...o,
  qtyG: o.qtyG ?? null, // normalize: the Partial spread must not leak undefined
});

describe('computeTotals — inclusive reference locale', () => {
  it('single line, no discount: subtotal=total, tax extracted, live margin from FIFO COGS', () => {
    const t = computeTotals([line({ qty: 2, cogsMinor: 1000 })], 0, gst);
    expect(t.subtotalMinor).toBe(2000);
    expect(t.totalMinor).toBe(2000);
    expect(t.discountMinor).toBe(0);
    expect(t.taxMinor).toBe(165); // 2000 × 9/109 = 165.1 → 165
    expect(t.cogsMinor).toBe(1000);
    expect(t.marginPct).toBe(50); // (2000−1000)/2000
    expect(t.unitCount).toBe(2);
  });

  it('order-level discount (FR-105) reduces the total and the taxable base', () => {
    const t = computeTotals([line({ qty: 2, cogsMinor: 1000 })], 500, gst);
    expect(t.totalMinor).toBe(1500); // 2000 − 500
    expect(t.discountMinor).toBe(500);
    expect(t.taxMinor).toBe(124); // (2000−500) × 9/109 = 123.85 → 124
  });

  it('per-line discount (FR-105) reduces that line only', () => {
    const t = computeTotals([line({ unitPriceMinor: 1000, qty: 1, discountMinor: 200, cogsMinor: 400 })], 0, gst);
    expect(t.subtotalMinor).toBe(1000);
    expect(t.lineDiscountMinor).toBe(200);
    expect(t.totalMinor).toBe(800);
    expect(t.taxMinor).toBe(66); // 800 × 9/109 = 65.14 → 66
    expect(t.marginPct).toBe(50); // (800−400)/800
  });

  it('clamps an over-large order discount to the discounted gross (never a negative total)', () => {
    const t = computeTotals([line({ qty: 2, cogsMinor: 1000 })], 5000, gst);
    expect(t.orderDiscountMinor).toBe(2000);
    expect(t.totalMinor).toBe(0);
    expect(t.taxMinor).toBe(0);
  });

  it('groups by tax category for the receipt breakdown (FR-108)', () => {
    const t = computeTotals(
      [line({ key: 'a', taxCategory: 'standard', cogsMinor: 400 }), line({ key: 'b', taxCategory: 'reduced', cogsMinor: 400 })],
      0,
      gst,
    );
    expect(t.totalMinor).toBe(2000);
    expect(t.tax.lines).toHaveLength(2);
    expect(t.tax.lines.map((l) => l.taxMinor).sort()).toEqual([83, 83]);
    expect(t.taxMinor).toBe(166);
  });

  it('empty cart → all zeros, no crash', () => {
    const t = computeTotals([], 0, gst);
    expect(t.subtotalMinor).toBe(0);
    expect(t.totalMinor).toBe(0);
    expect(t.taxMinor).toBe(0);
    expect(t.marginPct).toBe(0);
  });
});

describe('computeTotals — exclusive tax (PR-2026-11, CR-01)', () => {
  // In EXCLUSIVE mode the tax is a TOP-UP: total = base + tax (the customer
  // pays both). The old code always charged base only — exclusive outlets
  // under-collected tax and receipts showed subtotal + tax ≠ total.
  const vat = flatRateTaxEngine('flat:eu-vat-10-exclusive', 10, 'exclusive');

  it('adds the engine tax on top of the base', () => {
    const t = computeTotals([line({ qty: 1 })], 0, vat);
    expect(t.subtotalMinor).toBe(1000);
    expect(t.taxMinor).toBe(100); // 1000 × 10/100
    expect(t.totalMinor).toBe(1100); // base + tax
  });

  it('order discount reduces the base BEFORE the tax is added', () => {
    const t = computeTotals([line({ qty: 2 })], 500, vat);
    expect(t.totalMinor).toBe(1500 + 150); // (2000−500) + (1500 × 10%)
    expect(t.taxMinor).toBe(150);
  });

  it('per-line discount reduces the base before tax', () => {
    const t = computeTotals([line({ discountMinor: 200 })], 0, vat);
    expect(t.taxMinor).toBe(80); // 800 × 10%
    expect(t.totalMinor).toBe(880);
  });

  it('receipt math stays coherent: subtotal − discounts + tax = total', () => {
    const t = computeTotals(
      [line({ key: 'a', taxCategory: 'standard' }), line({ key: 'b', taxCategory: 'reduced' })],
      300,
      vat,
    );
    expect(t.subtotalMinor - t.discountMinor + t.taxMinor).toBe(t.totalMinor);
  });

  it('a clamped-to-zero base collects no tax and no total', () => {
    const t = computeTotals([line({ qty: 2 })], 5000, vat);
    expect(t.totalMinor).toBe(0);
    expect(t.taxMinor).toBe(0);
  });

  it('inclusive mode is UNCHANGED (regression guard): tax stays inside the total', () => {
    const t = computeTotals([line({ qty: 1 })], 0, gst);
    expect(t.totalMinor).toBe(1000); // NOT 1000 + tax
    expect(t.taxMinor).toBe(83); // 1000 × 9/109 = 82.57 → 83
  });
});

describe('computeTotals — order-discount proration (PR-2026-11, CR-10)', () => {
  const vat = flatRateTaxEngine('flat:eu-vat-10-exclusive', 10, 'exclusive');

  it('a fully line-discounted line takes NO order-discount share', () => {
    // Line A: 1000 with a 1000 line discount (net 0). Line B: 1000.
    // Order discount 200 must land entirely on line B (the only net remaining).
    // Old proration (by pre-discount gross) split it 100/100 and clamped A's
    // share to zero — so B kept 100 of its base as "taxable" that the order
    // discount never actually deducted.
    const t = computeTotals(
      [line({ key: 'a', discountMinor: 1000 }), line({ key: 'b' })],
      200,
      vat,
    );
    expect(t.subtotalMinor).toBe(2000);
    expect(t.lineDiscountMinor).toBe(1000);
    expect(t.totalMinor).toBe(800 + 80); // base 800 + 10%
    expect(t.taxMinor).toBe(80); // taxable = 800 (NOT 900)
  });

  it('with no line discounts, proration is unchanged (gross-weighted)', () => {
    // 1000 + 3000, order discount 400 → shares 100 / 300 exactly.
    const t = computeTotals(
      [line({ key: 'a' }), line({ key: 'b', unitPriceMinor: 3000 })],
      400,
      vat,
    );
    // taxable = (1000−100) + (3000−300) = 3600
    expect(t.taxMinor).toBe(360);
    expect(t.totalMinor).toBe(3600 + 360);
  });
});

describe('allocateCogs — cumulative FIFO across a product\u2019s lines (FR-321)', () => {
  const layers: LayerInput[] = [
    { id: 'L1', unitCostMinor: 50, qtyRemaining: 1000, receivedAt: 1 },
    { id: 'L2', unitCostMinor: 60, qtyRemaining: 1000, receivedAt: 2 },
  ];

  it('consumes oldest layer first across lines; matches a single bulk consume', () => {
    const r = allocateCogs(layers, [{ qty: 600 }, { qty: 600 }], 'LOT-X');
    expect(r).toHaveLength(2);
    const [a, b] = r;
    expect(a).toMatchObject({ cogsMinor: 30_000, unitCostMinor: 50, lotId: 'LOT-X', short: false });
    expect(b).toMatchObject({ cogsMinor: 32_000, short: false }); // line 2: 400×50 + 200×60
    expect(consumeFifo(layers, 1200).cogsMinor).toBe(62_000); // cumulative == bulk
    expect((a?.cogsMinor ?? 0) + (b?.cogsMinor ?? 0)).toBe(62_000);
  });

  it('flags shortage when a later line exceeds remaining layers (oversell guard)', () => {
    const single: LayerInput[] = [{ id: 'L1', unitCostMinor: 50, qtyRemaining: 100, receivedAt: 1 }];
    const r = allocateCogs(single, [{ qty: 80 }, { qty: 40 }], 'LOT-X');
    expect(r).toHaveLength(2);
    const [a, b] = r;
    expect(a).toMatchObject({ short: false, cogsMinor: 4000 }); // 80 × 50
    expect(b).toMatchObject({ short: true, shortageQty: 20, cogsMinor: 1000 }); // only 20 left
  });

  it('no layers → zero COGS + shortage', () => {
    const r = allocateCogs([], [{ qty: 5 }], 'LOT');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cogsMinor: 0, unitCostMinor: null, lotId: null, short: true, shortageQty: 5 });
  });
});
