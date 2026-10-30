import {
  applyConsumption,
  consumeFifo,
  daysUntil,
  fefoRank,
  projectStock,
  reorderSuggestion,
  stockStatus,
  type LayerInput,
} from '../lib/stock';

const layer = (id: string, cost: number, qty: number, receivedAt: number): LayerInput => ({
  id,
  unitCostMinor: cost,
  qtyRemaining: qty,
  receivedAt,
});

describe('FIFO cost layers (ADR-003, spec §4.3.1 worked example)', () => {
  it('consumes oldest layer first; COGS exact per layer', () => {
    // Canned milk: 2000 @ $0.50, then 2000 @ $0.60
    const layers = [layer('L1', 50, 2000, 1), layer('L2', 60, 2000, 2)];
    const r = consumeFifo(layers, 1500);
    expect(r.consumed).toEqual([{ layerId: 'L1', qty: 1500, unitCostMinor: 50 }]);
    expect(r.cogsMinor).toBe(75_000); // 1500 × $0.50 = $750
    expect(r.short).toBe(false);
  });

  it('switches to next layer once the oldest sells out', () => {
    const layers = [layer('L1', 50, 2000, 1), layer('L2', 60, 2000, 2)];
    const r = consumeFifo(layers, 2500);
    expect(r.consumed).toEqual([
      { layerId: 'L1', qty: 2000, unitCostMinor: 50 },
      { layerId: 'L2', qty: 500, unitCostMinor: 60 },
    ]);
    expect(r.cogsMinor).toBe(2000 * 50 + 500 * 60); // 100_000 + 30_000
  });

  it('orders by receivedAt then id (deterministic)', () => {
    const layers = [layer('b', 60, 10, 5), layer('a', 50, 10, 5)];
    const r = consumeFifo(layers, 15);
    expect(r.consumed[0]?.layerId).toBe('a');
    expect(r.consumed[1]?.layerId).toBe('b');
  });

  it('flags shortage instead of overselling', () => {
    const layers = [layer('L1', 50, 5, 1)];
    const r = consumeFifo(layers, 7);
    expect(r.short).toBe(true);
    expect(r.shortageQty).toBe(2);
    expect(r.consumed[0]?.qty).toBe(5);
  });

  it('applyConsumption produces correct remaining map', () => {
    const layers = [layer('L1', 50, 2000, 1), layer('L2', 60, 2000, 2)];
    const r = consumeFifo(layers, 2500);
    const rem = applyConsumption(layers, r);
    expect(rem.get('L1')).toBe(0);
    expect(rem.get('L2')).toBe(1500);
  });
});

describe('stock projection & status (ADR-002, prototype chips §4)', () => {
  it('projects on-hand as the sum of ledger deltas', () => {
    expect(projectStock([10, -3, -2])).toBe(5);
    expect(projectStock([0])).toBe(0);
    expect(projectStock([])).toBe(0);
  });

  it('maps status chips: In Stock / Low Stock / Depleted / Sold Out', () => {
    expect(stockStatus(24, 10, true)).toBe('in_stock');
    expect(stockStatus(10, 10, true)).toBe('low_stock'); // at threshold
    expect(stockStatus(8, 10, true)).toBe('low_stock');
    expect(stockStatus(0, 10, true)).toBe('depleted');
    expect(stockStatus(0, 10, false)).toBe('sold_out');
  });
});

describe('reorder & expiry helpers (FR-308, FR-307)', () => {
  it('Min/Max suggestion: max − on-hand when below min, else 0', () => {
    expect(reorderSuggestion(6, 10, 60)).toBe(54);
    expect(reorderSuggestion(2, 15, 45)).toBe(43);
    expect(reorderSuggestion(24, 10, 60)).toBe(0);
    expect(reorderSuggestion(5, 10, 8)).toBe(3); // max < min edge
  });

  it('FEFO ranks earliest expiry first, nulls last', () => {
    const lots = [
      { id: 'x', expiryDate: null, receivedAt: 1 },
      { id: 'y', expiryDate: '2026-11-02', receivedAt: 2 },
      { id: 'z', expiryDate: '2026-10-31', receivedAt: 3 },
    ];
    expect(fefoRank(lots).map((l) => l.id)).toEqual(['z', 'y', 'x']);
  });

  it('daysUntil is inclusive-of-today and negative when expired', () => {
    const now = new Date(2026, 9, 30, 12); // 30 Oct 2026
    expect(daysUntil('2026-10-30', now)).toBe(0);
    expect(daysUntil('2026-10-31', now)).toBe(1);
    expect(daysUntil('2026-10-29', now)).toBe(-1);
  });
});
