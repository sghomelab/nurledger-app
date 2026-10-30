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
