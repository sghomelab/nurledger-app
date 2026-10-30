/**
 * KPI + P&L math (FR-400/FR-403): net-basis KPIs, gross-basis P&L, ABC
 * classification, stockout forecast, period boundaries.
 */

import {
  computeKpis,
  computeStockout,
  computeVelocityAbc,
  lifetimeDays,
  opexTotalMinor,
  periodDays,
  periodStartMs,
  velocityTier,
} from '../lib/kpi';

/** A full day: 2026-10-30T09:15:00 local (arbitrary but fixed). */
function at(hour: number, minute = 0, day = 30, month = 9 /* Oct = 9 0-indexed */): number {
  return new Date(2026, month, day, hour, minute, 0, 0).getTime();
}

const baseTotals = {
  fromMs: 0,
  transactions: 10,
  unitsSold: 25,
  subtotalMinor: 100_000, // gross
  discountMinor: 5_000,
  taxMinor: 9_000,
  grossTotalMinor: 86_000, // money in
  cogsMinor: 50_000,
  discountedItems: 4,
};

const baseExtras = {
  receiptsUnits: 0,
  adjustmentLossMinor: 0,
  expiredValueMinor: 0,
  activeSkuCount: 0,
  zeroStockSkuCount: 0,
  poOrderedUnits: 0,
  poReceivedUnits: 0,
};

describe('period boundaries', () => {
  const now = at(9, 15);

  it('Today starts at local midnight', () => {
    expect(periodStartMs('today', now)).toBe(at(0, 0));
  });

  it('Current Period starts at the 1st of the month', () => {
    expect(periodStartMs('period', now)).toBe(at(0, 0, 1));
  });

  it('All Time starts at 0', () => {
    expect(periodStartMs('all', now)).toBe(0);
  });

  it('periodDays: today=1, period=ceil(days elapsed)', () => {
    expect(periodDays('all', now)).toBe(1);
    expect(periodDays('today', now)).toBe(1);
    const later = new Date(2026, 10, 14, 9, 15).getTime(); // Nov 14
    expect(periodDays('period', later)).toBe(14); // ceil(13.39 days elapsed)
  });

  it('lifetimeDays counts days since the first sale (min 1)', () => {
    expect(lifetimeDays(null, now)).toBe(1);
    expect(lifetimeDays(now, now)).toBe(1);
    const weekAgo = now - 7 * 86_400_000 - 3_600_000;
    expect(lifetimeDays(weekAgo, now)).toBe(8); // ceil(7.25)
  });
});

describe('computeKpis (net basis)', () => {
  const k = computeKpis({
    ...baseTotals,
    opex: { payrollMinor: 10_000, maintenanceMinor: 2_000, otherMinor: 3_000 },
    inventory: { atCostMinor: 12_000, atRetailMinor: 20_000 },
    extras: baseExtras,
  });

  it('net sales = gross − discounts − tax', () => {
    expect(k.netSalesMinor).toBe(100_000 - 5_000 - 9_000); // 86000
  });

  it('gross profit = net sales − COGS; avg basket and UPT derive from it', () => {
    expect(k.grossProfitMinor).toBe(86_000 - 50_000); // 36000
    expect(k.avgBasketMinor).toBe(8_600); // 86000 / 10
    expect(k.upt).toBe(2.5); // 25 / 10
  });

  it('gross margin % is relative to net sales', () => {
    expect(k.grossMarginPct).toBeCloseTo((36_000 / 86_000) * 100, 2);
  });

  it('operating net = gross profit − opex', () => {
    expect(opexTotalMinor({ payrollMinor: 10_000, maintenanceMinor: 2_000, otherMinor: 3_000 })).toBe(15_000);
    expect(k.operatingNetMinor).toBe(36_000 - 15_000);
  });

  it('P&L block is gross (money-in) basis', () => {
    expect(k.grossSalesMinor).toBe(86_000);
    expect(k.plGrossMarginMinor).toBe(86_000 - 50_000); // 36000
    expect(k.opNetMarginPct).toBeCloseTo(((36_000 - 15_000) / 86_000) * 100, 2);
  });
});

describe('computeKpis — empty period', () => {
  const k = computeKpis({
    fromMs: 0, transactions: 0, unitsSold: 0, subtotalMinor: 0, discountMinor: 0, taxMinor: 0,
    grossTotalMinor: 0, cogsMinor: 0, discountedItems: 0,
    opex: { payrollMinor: 0, maintenanceMinor: 0, otherMinor: 0 },
    inventory: { atCostMinor: 0, atRetailMinor: 0 },
    extras: baseExtras,
  });

  it('reports zeros without divide-by-zero', () => {
    expect(k.netSalesMinor).toBe(0);
    expect(k.avgBasketMinor).toBe(0);
    expect(k.upt).toBe(0);
    expect(k.grossMarginPct).toBe(0);
    expect(k.opNetMarginPct).toBe(0);
  });

  it('extended KPIs are all zero when the period is empty', () => {
    expect(k.markupPct).toBe(0);
    expect(k.inventoryTurnover).toBe(0);
    expect(k.daysOnHand).toBe(0);
    expect(k.sellThroughPct).toBe(0);
    expect(k.gmroi).toBe(0);
    expect(k.shrinkagePct).toBe(0);
    expect(k.stockoutRatePct).toBe(0);
    expect(k.expiryWastePct).toBe(0);
    expect(k.fillRatePct).toBe(0);
  });
});

describe('computeKpis — extended KPIs (research doc §4 / FR-403)', () => {
  const k = computeKpis({
    ...baseTotals,
    opex: { payrollMinor: 10_000, maintenanceMinor: 2_000, otherMinor: 3_000 },
    // Closing inventory at cost 12000 (120.00), retail 20000 (200.00).
    inventory: { atCostMinor: 12_000, atRetailMinor: 20_000 },
    extras: {
      receiptsUnits: 40, // 25 sold / 40 received → 62.5% sell-through
      adjustmentLossMinor: 4_300, // 43.00 shrinkage / 860.00 sales → 5%
      expiredValueMinor: 1_720, // 17.20 expired / 860.00 sales → 2%
      activeSkuCount: 20, // 4 of 20 at zero → 20% stockout rate
      zeroStockSkuCount: 4,
      poOrderedUnits: 100, // 90 received / 100 ordered → 90% fill rate
      poReceivedUnits: 90,
    },
  });

  it('markup % = gross profit ÷ COGS', () => {
    // grossProfit (net basis) = 36000; COGS = 50000 → 72%
    expect(k.markupPct).toBeCloseTo(72, 2);
  });

  it('inventory turnover = COGS ÷ avg inventory (≈ closing at cost)', () => {
    // 50000 / 12000 = 4.166… → 4.17
    expect(k.inventoryTurnover).toBeCloseTo(4.17, 2);
  });

  it('days on hand = 365 ÷ turnover', () => {
    expect(k.daysOnHand).toBeCloseTo(365 / 4.17, 1);
  });

  it('sell-through % = units sold ÷ units received', () => {
    expect(k.sellThroughPct).toBeCloseTo(62.5, 2);
  });

  it('GMROI = P&L gross margin ÷ avg inventory (at cost)', () => {
    // plGrossMargin = 86000 − 50000 = 36000; /12000 = 3.0
    expect(k.gmroi).toBeCloseTo(3.0, 2);
  });

  it('shrinkage % = adjustment loss ÷ gross sales', () => {
    expect(k.shrinkagePct).toBeCloseTo(5, 2);
  });

  it('stockout rate % = zero-stock SKUs ÷ active SKUs (snapshot)', () => {
    expect(k.stockoutRatePct).toBeCloseTo(20, 2);
  });

  it('expiry waste % = expired value ÷ gross sales', () => {
    expect(k.expiryWastePct).toBeCloseTo(2, 2);
  });

  it('fill rate % = received ÷ ordered (POs in period)', () => {
    expect(k.fillRatePct).toBeCloseTo(90, 2);
  });
});

describe('computeVelocityAbc', () => {
  const rows = [
    { productId: 'a', name: 'Rice 5kg', sku: 'R5', category: 'Pantry', unitsSold: 50, revenueMinor: 80_000, cogsMinor: 60_000, currentStock: 10 },
    { productId: 'b', name: 'Milk', sku: 'MLK', category: 'Fresh', unitsSold: 15, revenueMinor: 30_000, cogsMinor: 22_500, currentStock: 4 },
    { productId: 'c', name: 'Soap', sku: 'SOAP', category: 'Care', unitsSold: 2, revenueMinor: 8_000, cogsMinor: 5_000, currentStock: 20 },
    { productId: 'd', name: 'Rare Jam', sku: 'JAM', category: 'Pantry', unitsSold: 0, revenueMinor: 0, cogsMinor: 0, currentStock: 3 },
  ];

  const out = computeVelocityAbc(rows, 10);

  it('ranks by revenue desc', () => {
    expect(out.map((r) => r.sku)).toEqual(['R5', 'MLK', 'SOAP', 'JAM']);
  });

  it('assigns A/B/C by cumulative revenue share (80/95 split)', () => {
    // total = 118000. Rice share 67.8% → A (cum 67.8 ≤ 80).
    // Milk share 25.4% → cum 93.2 → B (≤95). Soap share 6.8% → cum 100 → C. Jam 0 → C.
    expect(out[0]!.classification).toBe('A');
    expect(out[1]!.classification).toBe('B');
    expect(out[2]!.classification).toBe('C');
    expect(out[3]!.classification).toBe('C');
  });

  it('computes profit, margin %, and revenue share', () => {
    const rice = out[0]!;
    expect(rice.profitMinor).toBe(20_000);
    expect(rice.grossMarginPct).toBeCloseTo(25, 2);
    expect(rice.revenueSharePct).toBeCloseTo((80_000 / 118_000) * 100, 2);
  });

  it('velocity tiers from units/day (≥5 Fast, ≥1 Medium, >0 Slow, 0 None)', () => {
    expect(velocityTier(50, 10)).toBe('Fast'); // 5/day
    expect(velocityTier(40, 10)).toBe('Medium'); // 4/day
    expect(velocityTier(15, 10)).toBe('Medium'); // 1.5/day
    expect(velocityTier(2, 10)).toBe('Slow'); // 0.2/day
    expect(velocityTier(0, 10)).toBe('None');
  });
});

describe('computeStockout', () => {
  it('days = stock ÷ (units ÷ days), sorted most-urgent first', () => {
    const out = computeStockout(
      [
        { productId: 'a', name: 'Rice', sku: 'R5', category: 'Pantry', currentStock: 10, unitsSold: 40 },
        { productId: 'b', name: 'Milk', sku: 'MLK', category: 'Fresh', currentStock: 50, unitsSold: 10 },
      ],
      10,
    );
    expect(out.map((r) => r.sku)).toEqual(['R5', 'MLK']); // 2.5d → 2 < 50d → 50
    expect(out[0]!.daysUntilStockout).toBe(2); // floor(10 / 4)
    expect(out[1]!.daysUntilStockout).toBe(50); // floor(50 / 1)
  });

  it('excludes products with no sales in the period', () => {
    const out = computeStockout(
      [{ productId: 'a', name: 'Jam', sku: 'JAM', category: null, currentStock: 5, unitsSold: 0 }],
      10,
    );
    expect(out).toEqual([]);
  });

  it('null category renders as a dash', () => {
    const out = computeStockout(
      [{ productId: 'a', name: 'Jam', sku: 'JAM', category: null, currentStock: 5, unitsSold: 10 }],
      10,
    );
    expect(out[0]!.category).toBe('—');
  });
});
