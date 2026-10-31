import {
  analyzeMargin,
  applyConsumption,
  cogsIncludingShortage,
  consumeFifo,
  daysUntil,
  expiryUrgency,
  fefoRank,
  projectStock,
  reorderSuggestion,
  stockStatus,
  summarizeRadar,
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

describe('FIFO shortage settlement (CR-07)', () => {
  it('cogsIncludingShortage is a no-op on a full consumption', () => {
    expect(cogsIncludingShortage(100_000, false, 0, 999)).toBe(100_000);
  });

  it('books the unattributable remainder at the fallback (current) cost', () => {
    // Ledger says 10 on hand, but only 5 units have cost layers (drift).
    // A stocktake counts 3 → variance −7 → consumeFifo short by 2.
    const layers = [layer('L1', 50, 5, 1)];
    const r = consumeFifo(layers, 7);
    expect(r.short).toBe(true);
    expect(r.shortageQty).toBe(2);
    expect(r.cogsMinor).toBe(5 * 50); // only the layered 5 at real FIFO cost
    // The 2 phantom units book at the product's current cost (e.g. 80):
    expect(cogsIncludingShortage(r.cogsMinor, r.short, r.shortageQty, 80)).toBe(5 * 50 + 2 * 80);
  });

  it('depleting the layers leaves nothing for the next consumption', () => {
    // After the short stocktake above, the repo zeroes every remaining layer.
    // The ledger now agrees with the count (3), the layers hold 0 — a later
    // sale of 3 consumes short AGAIN but the book and the layers are aligned,
    // and no layer qty can go negative.
    const afterSettle: LayerInput[] = [layer('L1', 50, 0, 1)];
    const r = consumeFifo(afterSettle, 3);
    expect(r.short).toBe(true);
    expect(r.shortageQty).toBe(3);
    expect(r.consumed).toEqual([]);
    expect(cogsIncludingShortage(r.cogsMinor, r.short, r.shortageQty, 80)).toBe(3 * 80);
  });

  it('zero fallback cost leaves the layered COGS untouched', () => {
    const layers = [layer('L1', 50, 2, 1)];
    const r = consumeFifo(layers, 4);
    expect(cogsIncludingShortage(r.cogsMinor, r.short, r.shortageQty, 0)).toBe(2 * 50);
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

describe('expiry urgency & radar summary (M3, FR-307, prototype §5)', () => {
  it('bands by days-left: expired / critical / soon / ok (defaults 7d / 30d)', () => {
    expect(expiryUrgency(-1)).toBe('expired');
    expect(expiryUrgency(0)).toBe('critical'); // today
    expect(expiryUrgency(3)).toBe('critical');
    expect(expiryUrgency(7)).toBe('critical'); // boundary
    expect(expiryUrgency(8)).toBe('soon');
    expect(expiryUrgency(30)).toBe('soon'); // boundary
    expect(expiryUrgency(31)).toBe('ok');
  });

  it('honours custom thresholds', () => {
    expect(expiryUrgency(5, { criticalDays: 3, soonDays: 10 })).toBe('soon');
    expect(expiryUrgency(2, { criticalDays: 3, soonDays: 10 })).toBe('critical');
  });

  it('summarizes Expiring / Expired / Other + expired-waste qty', () => {
    const entries = [
      { qtyRemaining: 4, urgency: 'expired' as const },
      { qtyRemaining: 6, urgency: 'expired' as const },
      { qtyRemaining: 10, urgency: 'critical' as const },
      { qtyRemaining: 8, urgency: 'soon' as const },
      { qtyRemaining: 100, urgency: 'ok' as const },
    ];
    const s = summarizeRadar(entries);
    expect(s.expiredQty).toBe(10); // 4 + 6
    expect(s.expiredWasteQty).toBe(10);
    expect(s.expiringQty).toBe(18); // critical 10 + soon 8
    expect(s.otherQty).toBe(100);
    expect(s.batchCount).toBe(5);
  });
});

describe('analyzeMargin (M6, FR-320 margin compression)', () => {
  it('flags compression when the newest cost rose above the baseline and suggests a reprice', () => {
    // Price set at S$8.00 against a S$5.00 cost → 37.5% → 38% integer margin.
    // New receipt at S$6.00 → margin compresses to 25%.
    const layers = [layer('L1', 500, 500, 1), layer('L2', 600, 500, 2)];
    const a = analyzeMargin(800, layers);
    expect(a.baselineCostMinor).toBe(500);
    expect(a.currentCostMinor).toBe(600);
    expect(a.baselineMarginPct).toBe(38); // 37.5% rounds up (app shows integer %)
    expect(a.currentMarginPct).toBe(25);
    expect(a.compressed).toBe(true);
    // hold 38% at S$6.00 cost → ceil(600 × 100 / (100 − 38)) = ceil(967.74) = 968
    expect(a.suggestedPriceMinor).toBe(968);
  });

  it('does not flag compression when cost held or fell', () => {
    const same = analyzeMargin(800, [layer('L1', 500, 100, 1), layer('L2', 500, 100, 2)]);
    expect(same.compressed).toBe(false);
    expect(same.suggestedPriceMinor).toBeNull();

    const fell = analyzeMargin(800, [layer('L1', 500, 100, 1), layer('L2', 400, 100, 2)]);
    expect(fell.compressed).toBe(false);
    expect(fell.suggestedPriceMinor).toBeNull();
    // margin improved
    expect(fell.currentMarginPct).toBeGreaterThan(fell.baselineMarginPct);
  });

  it('is a no-op with no layers or a non-positive price', () => {
    const noLayers = analyzeMargin(800, []);
    expect(noLayers.compressed).toBe(false);
    expect(noLayers.suggestedPriceMinor).toBeNull();

    const noPrice = analyzeMargin(0, [layer('L1', 500, 100, 1), layer('L2', 600, 100, 2)]);
    expect(noPrice.compressed).toBe(false);
    expect(noPrice.suggestedPriceMinor).toBeNull();
  });

  it('never suggests when the baseline margin is 0% or 100% (no sensible target)', () => {
    // price == baseline cost → 0% baseline margin
    const zero = analyzeMargin(500, [layer('L1', 500, 100, 1), layer('L2', 600, 100, 2)]);
    expect(zero.compressed).toBe(true);
    expect(zero.suggestedPriceMinor).toBeNull();

    // baseline cost 0 → 100% margin (division guard)
    const hundred = analyzeMargin(800, [layer('L1', 0, 100, 1), layer('L2', 600, 100, 2)]);
    expect(hundred.compressed).toBe(true);
    expect(hundred.suggestedPriceMinor).toBeNull();
  });

  it('suggests a price above the current one when cost exceeds the selling price', () => {
    // price S$5.00, baseline cost S$4.00 (20% margin), new cost S$6.00 → negative margin
    const a = analyzeMargin(500, [layer('L1', 400, 100, 1), layer('L2', 600, 100, 2)]);
    expect(a.compressed).toBe(true);
    expect(a.currentMarginPct).toBeLessThan(0);
    // hold 20% at S$6.00 → 600 / 0.80 = 750
    expect(a.suggestedPriceMinor).toBe(750);
    expect(a.suggestedPriceMinor).toBeGreaterThan(500);
  });
});
