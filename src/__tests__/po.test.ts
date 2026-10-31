import {
  buildPoText,
  cartonsToBase,
  isFullyReceived,
  planReceive,
  poTotalCostMinor,
  receiveDeltas,
  remainingToReceive,
  type PoDocumentInput,
  type POLineLike,
} from '../lib/po';
import { formatMoney } from '../lib/money';

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

  it('CR-06: receiveDeltas routes weighed lines to grams', () => {
    // Weighed (FR-103): 5,000 g of apples must land in qty_g_delta — a
    // qty_delta of 5000 would be invisible to stock_view.qty_g.
    expect(receiveDeltas(5_000, true)).toEqual({ qtyDelta: 0, qtyGDelta: 5_000 });
  });

  it('CR-06: receiveDeltas keeps base units for non-weighed lines', () => {
    expect(receiveDeltas(12, false)).toEqual({ qtyDelta: 12, qtyGDelta: null });
  });
});

describe('buildPoText (M6, FR-306 print/share)', () => {
  const M = (minor: number) => formatMoney(minor, 'SGD'); // environment-proof money
  const po: PoDocumentInput = {
    supplierName: 'Sheng Siong Wholesale',
    status: 'pending',
    terms: 'NET30',
    createdAt: 1_793_000_000_000,
    receivedAt: null,
    totalCostMinor: 5_000 + 3_750, // S$87.50
    lines: [
      { productId: 'A', qtyOrdered: 10, qtyReceived: 0, unitCostMinor: 500, lotCode: null, expiryDate: null },
      { productId: 'B', qtyOrdered: 3, qtyReceived: 1, unitCostMinor: 1250, lotCode: 'L2', expiryDate: '2027-02-01' },
    ],
  };
  const ref = (id: string) => (id === 'A' ? { name: 'Barista Oat Milk 1L', sku: 'BEV-OAT-03' } : undefined);

  it('renders header fields, per-line extended cost, and total in major units', () => {
    const text = buildPoText(po, 'SGD', ref, 'My Grocer');
    expect(text).toContain('PURCHASE ORDER');
    expect(text).toContain('Store: My Grocer');
    expect(text).toContain('Supplier: Sheng Siong Wholesale');
    expect(text).toContain('Terms: NET30');
    expect(text).toContain('Created: ');
    expect(text).toContain('Status: PENDING');
    // line A: 10 @ 5.00 = 50.00 (major units, symbol environment-dependent)
    expect(text).toContain(`10 @ ${M(500)} = ${M(5_000)}`);
    // line B: 3 @ 12.50 = 37.50
    expect(text).toContain(`3 @ ${M(1_250)} = ${M(3_750)}`);
    expect(text).toContain(`Total: ${M(8_750)} (2 lines, 13 units)`);
  });

  it('resolves product name+sku via productRef and falls back to the raw id', () => {
    const text = buildPoText(po, 'SGD', ref);
    expect(text).toContain('1. Barista Oat Milk 1L (BEV-OAT-03)');
    expect(text).toContain('2. B'); // unknown product → raw productId
    // store line only present when storeName is passed
    expect(text).not.toContain('Store:');
    // not yet received → no "Received:" header line
    expect(text).not.toContain('Received:');
  });

  it('annotates lines with lot / expiry / received progress only when present', () => {
    const text = buildPoText(po, 'SGD', ref);
    expect(text).toContain('lot L2 · exp 2027-02-01 · received 1/3');
    // line A has none of those → its detail line (extended cost) is the only line 1 sub-line
    const aBlock = text.split('1. Barista Oat Milk 1L (BEV-OAT-03)')[1]!.split('2.')[0]!;
    expect(aBlock).toContain(`10 @ ${M(500)} = ${M(5_000)}`);
    expect(aBlock).not.toContain('lot ');
    expect(aBlock).not.toContain('received');
  });

  it('uses the singular "line" for a one-line PO and shows the received date when set', () => {
    const one: PoDocumentInput = {
      ...po,
      lines: [po.lines[0]!],
      totalCostMinor: 5_000,
      receivedAt: 1_793_500_000_000,
    };
    const text = buildPoText(one, 'SGD', ref);
    expect(text).toContain(`Total: ${M(5_000)} (1 line, 10 units)`);
    expect(text).toContain('Received: ');
  });
});
