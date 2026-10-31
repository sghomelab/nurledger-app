/**
 * CSV export builders (M4). The P&L structure is asserted against the
 * prototype-verified layout (PROTOTYPE-REFERENCE §6): REVENUE & DIRECT COSTS →
 * Operating Costs → Operating Net Margin % → INVENTORY ASSET POSITION.
 */

import {
  buildPlCsv,
  buildSalesHistoryCsv,
  buildStockoutCsv,
  buildVelocityAbcCsv,
  csvEscape,
  toCsv,
  toMajor,
  type SalesHistoryCsvRow,
} from '../lib/csv';
import { computeKpis, type StockoutRow, type VelocityAbcRow } from '../lib/kpi';

const kpis = computeKpis({
  fromMs: 0,
  transactions: 10,
  unitsSold: 25,
  subtotalMinor: 100_000,
  discountMinor: 5_000,
  taxMinor: 9_000,
  grossTotalMinor: 86_000,
  cogsMinor: 50_000,
  discountedItems: 4,
  refundCount: 0,
  refundMinor: 0,
  refundNetMinor: 0,
  refundedUnits: 0,
  refundedCogsMinor: 0,
  opex: { payrollMinor: 10_000, maintenanceMinor: 2_000, otherMinor: 3_000 },
  inventory: { atCostMinor: 12_000, atRetailMinor: 20_000 },
  extras: {
    receiptsUnits: 0,
    adjustmentLossMinor: 0,
    expiredValueMinor: 0,
    activeSkuCount: 0,
    zeroStockSkuCount: 0,
    poOrderedUnits: 0,
    poReceivedUnits: 0,
  },
});

describe('csvEscape / toCsv', () => {
  it('quotes fields containing commas, quotes, or newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
    expect(csvEscape(1234)).toBe('1234');
  });

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
  });
});

describe('toMajor', () => {
  it('formats 2-decimal currencies', () => {
    expect(toMajor(12_345, 'SGD')).toBe('123.45');
    expect(toMajor(0, 'SGD')).toBe('0.00');
  });
  it('formats zero-decimal currencies as whole', () => {
    expect(toMajor(12_345, 'JPY')).toBe('123');
    expect(toMajor(12_399, 'JPY')).toBe('124');
  });
});

describe('buildPlCsv (prototype structure)', () => {
  const csv = buildPlCsv(kpis, 'SGD', 'Today');
  const rows = csv.split('\r\n');

  it('opens with the title + REVENUE & DIRECT COSTS block', () => {
    expect(rows[0]).toBe('Financial P&L — Today');
    expect(rows[2]).toBe('REVENUE & DIRECT COSTS');
    expect(rows[3]).toBe('Total Gross Sales,860.00');
    expect(rows[4]).toBe('Cost of Goods Sold,500.00');
    expect(rows[5]).toBe('Gross Margin,360.00');
  });

  it('lists Operating Costs with the three prototype categories', () => {
    expect(rows[6]).toBe('Operating Costs');
    expect(rows[7]).toBe('Staff Payroll,100.00');
    expect(rows[8]).toBe('Maintenance,20.00');
    expect(rows[9]).toBe('Other Operational,30.00');
  });

  it('emits Operating Net Margin % then INVENTORY ASSET POSITION', () => {
    expect(rows[10]).toBe('Operating Net Margin %,24.42%'); // (36000-15000)/86000
    expect(rows[12]).toBe('INVENTORY ASSET POSITION');
    expect(rows[13]).toBe('Current Inventory at Wholesale Cost,120.00');
    expect(rows[14]).toBe('Current Inventory at Retail Value,200.00');
    expect(rows[15]).toBe('Unrealized Potential Margin,80.00');
  });
});

describe('buildVelocityAbcCsv', () => {
  const rows: VelocityAbcRow[] = [
    {
      velocityTier: 'Fast', classification: 'A', name: 'Rice 5kg', sku: 'R5', category: 'Pantry & Staples',
      unitsSold: 50, revenueMinor: 80_000, profitMinor: 20_000, grossMarginPct: 25, revenueSharePct: 67.8, currentStock: 10,
    },
    {
      velocityTier: 'None', classification: 'C', name: 'Jar "Special", Ltd', sku: 'JAM', category: 'Pantry & Staples',
      unitsSold: 0, revenueMinor: 0, profitMinor: 0, grossMarginPct: 0, revenueSharePct: 0, currentStock: 3,
    },
  ];

  const csv = buildVelocityAbcCsv(rows, 'SGD', 'Today');
  const lines = csv.split('\r\n');

  it('has the exact prototype column order', () => {
    expect(lines[1]).toBe(
      'Velocity Tier,Classification,Product Name,SKU,Category,Units Sold,Total Revenue,Total Profit,Gross Margin %,Revenue Share %,Current Stock',
    );
  });

  it('writes each product row and escapes the comma in the name', () => {
    expect(lines[2]).toBe('Fast,A,Rice 5kg,R5,Pantry & Staples,50,800.00,200.00,25.00%,67.80%,10');
    expect(lines[3]).toContain('"Jar ""Special"", Ltd"');
    expect(lines[3]).toBe('None,C,"Jar ""Special"", Ltd",JAM,Pantry & Staples,0,0.00,0.00,0.00%,0.00%,3');
  });
});

describe('buildStockoutCsv', () => {
  const rows: StockoutRow[] = [
    { name: 'Rice', sku: 'R5', category: 'Pantry', currentStock: 10, unitsSold: 40, dailyVelocity: 4, daysUntilStockout: 2 },
    { name: 'Milk', sku: 'MLK', category: 'Fresh', currentStock: 50, unitsSold: 10, dailyVelocity: 1, daysUntilStockout: 50 },
  ];

  const csv = buildStockoutCsv(rows, 'Today');
  const lines = csv.split('\r\n');

  it('has a forecast header + one row per product', () => {
    expect(lines[1]).toBe('Product Name,SKU,Category,Current Stock,Units Sold,Daily Velocity,Days Until Stockout');
    expect(lines[2]).toBe('Rice,R5,Pantry,10,40,4.00,2');
    expect(lines[3]).toBe('Milk,MLK,Fresh,50,10,1.00,50');
  });
});

describe('buildSalesHistoryCsv', () => {
  const rows: SalesHistoryCsvRow[] = [
    {
      createdAt: new Date(2026, 9, 30, 10, 30).getTime(),
      saleId: 'sale-1', cashierName: 'Jun', items: 2, units: 3,
      subtotalMinor: 10_000, discountMinor: 500, taxMinor: 900, totalMinor: 8_600, methods: 'cash+card',
    },
  ];

  const csv = buildSalesHistoryCsv(rows, 'SGD');
  const lines = csv.split('\r\n');

  it('has a header + one row per sale with money in major units', () => {
    expect(lines[1]).toBe('Date,Time,Sale ID,Cashier,Items,Units,Subtotal,Discount,Tax,Total,Payment');
    expect(lines[2]).toContain('sale-1');
    expect(lines[2]).toContain('Jun');
    expect(lines[2]).toContain('100.00');
    expect(lines[2]).toContain('86.00');
    expect(lines[2]).toContain('cash+card');
  });
});
