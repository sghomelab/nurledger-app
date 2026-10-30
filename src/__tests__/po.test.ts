import {
  cartonsToBase,
  isFullyReceived,
  planReceive,
  poTotalCostMinor,
  remainingToReceive,
  type POLineLike,
} from '../lib/po';

const line = (over: Partial<POLineLike> = {}): POLineLike => ({
  qtyOrdered: 0,
  qtyReceived: 0,
  unitCostMinor: 0,
  lotCode: null,
  expiryDate: null,
  ...over,
});

describe('PO math (M3, FR-306/FR-318/FR-322)', () => {
  it('remainingToReceive never goes negative', () => {
    expect(remainingToReceive(line({ qtyOrdered: 12, qtyReceived: 5 }))).toBe(7);
    expect(remainingToReceive(line({ qtyOrdered: 5, qtyReceived: 5 }))).toBe(0);
    expect(remainingToReceive(line({ qtyOrdered: 4, qtyReceived: 9 }))).toBe(0); // over-received
  });

  it('poTotalCostMinor sums qtyOrdered × unitCost (integer minor units)', () => {
    const lines = [
      line({ qtyOrdered: 10, unitCostMinor: 500 }), // 10 × $5.00 = $50.00 → 5_000 minor
      line({ qtyOrdered: 3, unitCostMinor: 1250 }), // 3 × $12.50 = $37.50 → 3_750 minor
    ];
    expect(poTotalCostMinor(lines)).toBe(5_000 + 3_750); // $87.50 in minor
  });

  it('isFullyReceived is true only when every line received ≥ ordered', () => {
    expect(isFullyReceived([line({ qtyOrdered: 10, qtyReceived: 10 })])).toBe(true);
    expect(isFullyReceived([line({ qtyOrdered: 10, qtyReceived: 9 })])).toBe(false);
    expect(
      isFullyReceived([
        line({ qtyOrdered: 10, qtyReceived: 10 }),
        line({ qtyOrdered: 5, qtyReceived: 4 }),
      ]),
    ).toBe(false);
    // over-received line still counts as fully received
    expect(isFullyReceived([line({ qtyOrdered: 10, qtyReceived: 12 })])).toBe(true);
  });

  it('cartonsToBase expands 1 carton = N base units (FR-318)', () => {
    expect(cartonsToBase(3, 12)).toBe(36);
    expect(cartonsToBase(1, 1)).toBe(1);
    expect(cartonsToBase(0, 12)).toBe(0);
    // guards against degenerate sizes
    expect(cartonsToBase(2, 0)).toBe(2); // cartonSize clamps to 1
    expect(cartonsToBase(-1, 12)).toBe(0);
  });

  it('planReceive emits one batch per not-fully-received line at the remaining qty', () => {
    const plan = planReceive([
      { productId: 'A', qtyOrdered: 24, qtyReceived: 0, unitCostMinor: 500, lotCode: 'L1', expiryDate: '2027-01-15' },
      { productId: 'B', qtyOrdered: 10, qtyReceived: 10, unitCostMinor: 300, lotCode: null, expiryDate: null },
      { productId: 'C', qtyOrdered: 8, qtyReceived: 3, unitCostMinor: 750, lotCode: 'L3', expiryDate: '2026-12-01' },
    ]);
    // Fully-received B is skipped; A and C emit remaining qty.
    expect(plan).toEqual([
      { productId: 'A', baseQty: 24, unitCostMinor: 500, lotCode: 'L1', expiryDate: '2027-01-15' },
      { productId: 'C', baseQty: 5, unitCostMinor: 750, lotCode: 'L3', expiryDate: '2026-12-01' },
    ]);
  });

  it('planReceive is idempotent for an already-fully-received PO (empty plan)', () => {
    const plan = planReceive([
      { productId: 'A', qtyOrdered: 10, qtyReceived: 10, unitCostMinor: 500, lotCode: 'L1', expiryDate: null },
    ]);
    expect(plan).toEqual([]);
  });
});
