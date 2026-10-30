/**
 * CSV export builders (M4 — prototype Analytics exports). Pure string in / out.
 *
 * Structure follows PROTOTYPE-REFERENCE §6 verbatim (the bundle-verified P&L
 * layout and the velocity_abc_analysis.csv column list). Money is written in
 * MAJOR units (zero-decimal currencies whole, others 2dp) — CSVs are data,
 * not display.
 */

import { isZeroDecimal } from './currency';
import type { Kpis, VelocityAbcRow, StockoutRow } from './kpi';

/** Escape a CSV field (RFC 4180 minimal: quote when needed, double quotes). */
export function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

/** Minor units → major-unit CSV number (zero-decimal currencies whole). */
export function toMajor(minor: number, currency: string): string {
  if (isZeroDecimal(currency)) return String(Math.round(minor / 100));
  return (minor / 100).toFixed(2);
}

export function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

/**
 * P&L export (prototype-verified structure):
 *   REVENUE & DIRECT COSTS → Total Gross Sales / COGS / Gross Margin /
 *   Operating Costs (Staff Payroll · Maintenance · Other Operational) →
 *   Operating Net Margin % → INVENTORY ASSET POSITION.
 */
export function buildPlCsv(k: Kpis, currency: string, periodLabel: string): string {
  const rows: (string | number)[][] = [
    [`Financial P&L — ${periodLabel}`],
    [''],
    ['REVENUE & DIRECT COSTS'],
    ['Total Gross Sales', toMajor(k.grossSalesMinor, currency)],
    ['Cost of Goods Sold', toMajor(k.cogsMinor, currency)],
    ['Gross Margin', toMajor(k.plGrossMarginMinor, currency)],
    ['Operating Costs'],
    ['Staff Payroll', toMajor(k.plOpex.payrollMinor, currency)],
    ['Maintenance', toMajor(k.plOpex.maintenanceMinor, currency)],
    ['Other Operational', toMajor(k.plOpex.otherMinor, currency)],
    ['Operating Net Margin %', pct(k.opNetMarginPct)],
    [''],
    ['INVENTORY ASSET POSITION'],
    ['Current Inventory at Wholesale Cost', toMajor(k.inventory.atCostMinor, currency)],
    ['Current Inventory at Retail Value', toMajor(k.inventory.atRetailMinor, currency)],
    ['Unrealized Potential Margin', toMajor(k.inventory.atRetailMinor - k.inventory.atCostMinor, currency)],
  ];
  return toCsv(rows);
}

/**
 * Velocity/ABC export — column list exactly as `velocity_abc_analysis.csv`
 * in the prototype bundle.
 */
export function buildVelocityAbcCsv(rows: VelocityAbcRow[], currency: string, periodLabel: string): string {
  const rowsOut: (string | number)[][] = [
    ['Velocity/ABC Analysis — ' + periodLabel],
    ['Velocity Tier', 'Classification', 'Product Name', 'SKU', 'Category', 'Units Sold', 'Total Revenue', 'Total Profit', 'Gross Margin %', 'Revenue Share %', 'Current Stock'],
  ];
  for (const r of rows) {
    rowsOut.push([
      r.velocityTier,
      r.classification,
      r.name,
      r.sku,
      r.category,
      r.unitsSold,
      toMajor(r.revenueMinor, currency),
      toMajor(r.profitMinor, currency),
      pct(r.grossMarginPct),
      pct(r.revenueSharePct),
      r.currentStock,
    ]);
  }
  return toCsv(rowsOut);
}

/** Stockout forecast export (days-until-stockout at current period velocity). */
export function buildStockoutCsv(rows: StockoutRow[], periodLabel: string): string {
  const rowsOut: (string | number)[][] = [
    ['Stockout Forecast — ' + periodLabel],
    ['Product Name', 'SKU', 'Category', 'Current Stock', 'Units Sold', 'Daily Velocity', 'Days Until Stockout'],
  ];
  for (const r of rows) {
    rowsOut.push([
      r.name,
      r.sku,
      r.category,
      r.currentStock,
      r.unitsSold,
      r.dailyVelocity.toFixed(2),
      r.daysUntilStockout === null ? 'No sales' : r.daysUntilStockout,
    ]);
  }
  return toCsv(rowsOut);
}

export interface SalesHistoryCsvRow {
  createdAt: number;
  saleId: string;
  cashierName: string | null;
  items: number;
  units: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  methods: string | null;
}

/** Sales history export (FR-401) — one row per sale. */
export function buildSalesHistoryCsv(rows: SalesHistoryCsvRow[], currency: string): string {
  const rowsOut: (string | number)[][] = [
    ['Sales History'],
    ['Date', 'Time', 'Sale ID', 'Cashier', 'Items', 'Units', 'Subtotal', 'Discount', 'Tax', 'Total', 'Payment'],
  ];
  for (const r of rows) {
    const d = new Date(r.createdAt);
    rowsOut.push([
      d.toISOString().slice(0, 10),
      d.toISOString().slice(11, 16),
      r.saleId,
      r.cashierName ?? '—',
      r.items,
      r.units,
      toMajor(r.subtotalMinor, currency),
      toMajor(r.discountMinor, currency),
      toMajor(r.taxMinor, currency),
      toMajor(r.totalMinor, currency),
      r.methods ?? '—',
    ]);
  }
  return toCsv(rowsOut);
}
