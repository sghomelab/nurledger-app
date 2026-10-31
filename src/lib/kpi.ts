/**
 * KPI + P&L math (FR-400, FR-403, prototype Analytics panels). Pure, integer
 * minor units in / out (ADR-004); the only floats are derived percentages and
 * UPT (display metrics, never money).
 *
 * Two documented bases (they differ by the tax amount, which is expected):
 *  - KPI CARDS follow the research doc §4 formulas on a NET basis:
 *      Net sales  = gross − discounts − VAT − refunds (VAT-excl. share, CR-09)
 *      Gross profit = net sales − COGS (COGS net of the restocked-refund
 *      reversal, CR-09 — restocked units re-entered the FIFO layers at the
 *      sale-time cost, so reversing them keeps the P&L consistent)
 *  - THE P&L follows the prototype structure on a GROSS (money-in) basis:
 *      Total Gross Sales = Σ sale.total_minor − Σ refunds (money in minus
 *      money back, CR-09)
 *      Operating Net Margin % = (Gross Margin − Operating Costs) / Total Gross Sales
 * Both bases are labeled in the UI; this comment is the source of truth.
 */

import { roundDivide } from './money';
import type { SalesByMethod } from './shift';

export type PeriodId = 'today' | 'period' | 'all';

/** Local start-of-day (ms). */
export function startOfToday(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local start-of-month (ms) — the prototype's "Current Period". */
export function startOfPeriod(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Period start in ms (0 = All Time). */
export function periodStartMs(period: PeriodId, nowMs: number = Date.now()): number {
  if (period === 'today') return startOfToday(nowMs);
  if (period === 'period') return startOfPeriod(nowMs);
  return 0;
}

/**
 * Whole days for velocity math:
 *  - today → 1 (a full trading day, regardless of the clock)
 *  - period → ceiling of days elapsed since month start (min 1)
 *  - all → 1 as a fallback; the hook overrides with days-since-first-sale so
 *    lifetime velocity is meaningful.
 */
export function periodDays(period: PeriodId, nowMs: number = Date.now()): number {
  if (period === 'today' || period === 'all') return 1;
  const from = periodStartMs(period, nowMs);
  return Math.max(1, Math.ceil((nowMs - from) / 86_400_000));
}

/** Days elapsed since the first sale (lifetime velocity denominator), min 1. */
export function lifetimeDays(firstSaleAt: number | null, nowMs: number = Date.now()): number {
  if (!firstSaleAt) return 1;
  return Math.max(1, Math.ceil((nowMs - firstSaleAt) / 86_400_000));
}

/** Aggregated sales for a period (all integer minor units, from the sale headers). */
export interface PeriodTotals {
  fromMs: number;
  transactions: number;
  unitsSold: number;
  /** Σ sale.subtotal_minor (pre-discount gross). */
  subtotalMinor: number;
  /** Σ sale.discount_minor (line + order). */
  discountMinor: number;
  /** Σ sale.tax_minor. */
  taxMinor: number;
  /** Σ sale.total_minor (money in, tax-inclusive). */
  grossTotalMinor: number;
  /** Σ sale.cogs_minor (FIFO at sale time). */
  cogsMinor: number;
  /** sale_lines that carried a discount (line-level or order-level share). */
  discountedItems: number;
  // CR-09 — refunds CREATED in the period (scoped by refund.created_at, the
  // moment the money came back — not the parent sale's date). Deducted from
  // the KPIs in computeKpis.
  /** Count of refund headers created in the period. */
  refundCount: number;
  /** Σ refund.amount_minor (tax-inclusive — money back to the customer). */
  refundMinor: number;
  /** VAT-exclusive share of the refunds (same basis as netSales; per-refund
   *  proration via refundNetShareMinor). */
  refundNetMinor: number;
  /** Units returned (weighed lines count 0/1 by grams, rounded, like sale
   *  units). */
  refundedUnits: number;
  /** Sale-time COGS of RESTOCKED refund lines only (the FIFO reversal). */
  refundedCogsMinor: number;
}

/**
 * CR-09 — the VAT-exclusive share of a tax-inclusive refund, on the
 * KPI-card's net basis (subtotal − discount − tax). A refund refunds a share
 * of what the customer actually paid (incl. tax); the net basis excludes VAT,
 * so only the ex-tax share is deducted. Prorated by the PARENT SALE's own
 * net/pre-tax ratio:
 *   share = refundMinor × (subtotal − discount − tax) / (subtotal − discount)
 * Exact for inclusive tax (the reference locale); integer roundDivide
 * throughout (ADR-004). `preTaxMinor` = 0 → 0 (a zero-total sale refunds 0).
 */
export function refundNetShareMinor(refundMinor: number, netMinor: number, preTaxMinor: number): number {
  return roundDivide(refundMinor * netMinor, preTaxMinor);
}

/**
 * FR-400 payment-method split (the Insights "Payment Mix" tile). Methods with
 * a positive amount, sorted by amount descending (ties keep insertion order),
 * each carrying its share of the period total. Money stays integer minor
 * units end to end (ADR-004) — only `sharePct` is a float, and display-only.
 */
export interface PaymentMixRow {
  method: string;
  amountMinor: number;
  /** 0–100, display only. */
  sharePct: number;
}

export function paymentMix(salesByMethod: SalesByMethod): PaymentMixRow[] {
  const total = Object.values(salesByMethod).reduce((sum, v) => sum + v, 0);
  if (total <= 0) return [];
  return Object.entries(salesByMethod)
    .filter(([, v]) => v > 0)
    .map(([method, amountMinor]) => ({
      method,
      amountMinor,
      sharePct: (amountMinor / total) * 100,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

/** Operating expenses by type (prototype: Staff Payroll / Maintenance / Other). */
export interface OpexTotals {
  payrollMinor: number;
  maintenanceMinor: number;
  otherMinor: number;
}

export function opexTotalMinor(o: OpexTotals): number {
  return o.payrollMinor + o.maintenanceMinor + o.otherMinor;
}

/** Inventory asset position (prototype P&L "INVENTORY ASSET POSITION"). */
export interface InventoryValuation {
  /** Σ cost_layer.qty_remaining × unit_cost_minor. */
  atCostMinor: number;
  /** Σ stock × product.price_minor. */
  atRetailMinor: number;
}

export interface Kpis {
  // KPI cards (net basis — research doc §4)
  netSalesMinor: number;
  transactions: number;
  avgBasketMinor: number;
  /** Units per transaction (float, 2dp — display only). */
  upt: number;
  cogsMinor: number;
  grossProfitMinor: number;
  /** 0 when net sales are 0 (margin undefined). */
  grossMarginPct: number;
  opexMinor: number;
  operatingNetMinor: number;
  unitsSold: number;
  discountedItems: number;
  // P&L (gross basis — prototype structure)
  grossSalesMinor: number;
  plGrossMarginMinor: number;
  /** (plGrossMargin − opex) / grossSales × 100; 0 when gross sales are 0. */
  opNetMarginPct: number;
  plOpex: OpexTotals;
  inventory: InventoryValuation;
  // Extended KPIs (research doc §4 full list — FR-403)
  /** Gross profit ÷ COGS × 100 (supplier negotiation term, ≠ margin). */
  markupPct: number;
  /** COGS ÷ avg inventory (at cost). Avg ≈ period-end inventory (documented approx). */
  inventoryTurnover: number;
  /** 365 ÷ turnover; 0 when turnover is 0. */
  daysOnHand: number;
  /** Units sold ÷ units received in period × 100; 0 when nothing received. */
  sellThroughPct: number;
  /** Gross margin $ (P&L basis) ÷ avg inventory (at cost); 0 when no inventory. */
  gmroi: number;
  /** Shrinkage value (outbound adjustments) ÷ gross sales × 100. */
  shrinkagePct: number;
  /** Snapshot approx: % of active SKUs at zero stock (true stockout rate needs hourly history). */
  stockoutRatePct: number;
  /** Expired-lot value (snapshot) ÷ gross sales × 100. */
  expiryWastePct: number;
  /** Units received ÷ units ordered (POs in period) × 100; 0 when no POs. */
  fillRatePct: number;
}

export interface KpiInput extends PeriodTotals {
  opex: OpexTotals;
  inventory: InventoryValuation;
  /** Extended-KPI inputs (see KpiExtrasInput). */
  extras: KpiExtrasInput;
}

/**
 * Inputs for the extended KPIs (research doc §4). Sourced by
 * insightsRepository: ledger aggregates for the period + current snapshots
 * for the stockout / expiry-waste figures (documented approximations — see
 * the formula comments on Kpis).
 */
export interface KpiExtrasInput {
  /** Units received in the period (stock_ledger type='receive_po'). */
  receiptsUnits: number;
  /** Value of outbound stock adjustments in the period (≈ current product cost). */
  adjustmentLossMinor: number;
  /** Value of inventory sitting in expired lots (snapshot). */
  expiredValueMinor: number;
  /** Active SKU count (snapshot). */
  activeSkuCount: number;
  /** Active SKUs at zero stock (snapshot). */
  zeroStockSkuCount: number;
  /** Units ordered on POs created in the period. */
  poOrderedUnits: number;
  /** Units received on those POs. */
  poReceivedUnits: number;
}

/** Compute every M4 KPI + P&L figure from period aggregates. */
export function computeKpis(input: KpiInput): Kpis {
  const {
    transactions, unitsSold, subtotalMinor, discountMinor, taxMinor, grossTotalMinor,
    cogsMinor, discountedItems, refundMinor, refundNetMinor, refundedUnits, refundedCogsMinor,
  } = input;
  const opex = opexTotalMinor(input.opex);
  const ex = input.extras;

  // CR-09 — refunds created in the period reduce true net performance on both
  // bases: money back (gross), the VAT-excl. revenue share (net), the FIFO
  // COGS of restocked units, and the units that came back. (Transaction count
  // stays the count of completed sales — a refunded sale still happened;
  // per-product ABC/velocity is intentionally NOT refund-adjusted: it ranks
  // demand, and returns are a small flow for a small shop.)
  // Clamped at 0 like the other net figures: a refund of a PRIOR period's sale
  // landing in this period must not produce negative COGS (which would show
  // as phantom profit) — it simply deducts what this period's activity has.
  const netCogsMinor = Math.max(0, cogsMinor - refundedCogsMinor);
  const netUnitsSold = Math.max(0, unitsSold - refundedUnits);
  const netGrossSalesMinor = Math.max(0, grossTotalMinor - refundMinor);

  // Net basis (research doc)
  const netSalesMinor = Math.max(0, subtotalMinor - discountMinor - taxMinor - refundNetMinor);
  const grossProfitMinor = netSalesMinor - netCogsMinor;
  const avgBasketMinor = transactions > 0 ? Math.round(netSalesMinor / transactions) : 0;
  const upt = transactions > 0 ? Math.round((netUnitsSold / transactions) * 100) / 100 : 0;
  const grossMarginPct = netSalesMinor > 0 ? Math.round((grossProfitMinor / netSalesMinor) * 10000) / 100 : 0;
  const operatingNetMinor = grossProfitMinor - opex;

  // P&L basis (prototype: money in, minus money back)
  const grossSalesMinor = netGrossSalesMinor;
  const plGrossMarginMinor = grossSalesMinor - netCogsMinor;
  const plOpexNetMinor = plGrossMarginMinor - opex;
  const opNetMarginPct = grossSalesMinor > 0 ? Math.round((plOpexNetMinor / grossSalesMinor) * 10000) / 100 : 0;

  // Extended KPIs (research doc §4). Avg inventory ≈ period-end value at cost
  // (documented approximation — small shops don't carry hourly inventory
  // snapshots; this keeps turnover/GMROI a stable ratio-of-averages-free KPI).
  const avgInvCostMinor = input.inventory.atCostMinor;
  const markupPct = netCogsMinor > 0 ? Math.round((grossProfitMinor / netCogsMinor) * 10000) / 100 : 0;
  const inventoryTurnover = avgInvCostMinor > 0 ? Math.round((netCogsMinor / avgInvCostMinor) * 100) / 100 : 0;
  const daysOnHand = inventoryTurnover > 0 ? Math.round((365 / inventoryTurnover) * 10) / 10 : 0;
  const sellThroughPct = ex.receiptsUnits > 0 ? Math.round((netUnitsSold / ex.receiptsUnits) * 10000) / 100 : 0;
  const gmroi = avgInvCostMinor > 0 ? Math.round((plGrossMarginMinor / avgInvCostMinor) * 100) / 100 : 0;
  const shrinkagePct = grossSalesMinor > 0 ? Math.round((ex.adjustmentLossMinor / grossSalesMinor) * 10000) / 100 : 0;
  const stockoutRatePct = ex.activeSkuCount > 0 ? Math.round((ex.zeroStockSkuCount / ex.activeSkuCount) * 10000) / 100 : 0;
  const expiryWastePct = grossSalesMinor > 0 ? Math.round((ex.expiredValueMinor / grossSalesMinor) * 10000) / 100 : 0;
  const fillRatePct = ex.poOrderedUnits > 0 ? Math.round((ex.poReceivedUnits / ex.poOrderedUnits) * 10000) / 100 : 0;

  return {
    netSalesMinor,
    transactions,
    avgBasketMinor,
    upt,
    cogsMinor: netCogsMinor,
    grossProfitMinor,
    grossMarginPct,
    opexMinor: opex,
    operatingNetMinor,
    unitsSold: netUnitsSold,
    discountedItems,
    grossSalesMinor,
    plGrossMarginMinor,
    opNetMarginPct,
    plOpex: input.opex,
    inventory: input.inventory,
    markupPct,
    inventoryTurnover,
    daysOnHand,
    sellThroughPct,
    gmroi,
    shrinkagePct,
    stockoutRatePct,
    expiryWastePct,
    fillRatePct,
  };
}

// ---- Velocity / ABC (prototype velocity_abc_analysis.csv) -----------------

export type AbcClass = 'A' | 'B' | 'C';

/** Velocity tier from units/day (documented heuristics, not spec'd). */
export type VelocityTier = 'Fast' | 'Medium' | 'Slow' | 'None';

export function velocityTier(unitsSold: number, days: number): VelocityTier {
  if (unitsSold <= 0) return 'None';
  const perDay = unitsSold / days;
  if (perDay >= 5) return 'Fast';
  if (perDay >= 1) return 'Medium';
  return 'Slow';
}

export interface AbcRowInput {
  productId: string;
  name: string;
  sku: string;
  category: string | null;
  unitsSold: number;
  /** Σ sale_line.line_total_minor for the product in the period. */
  revenueMinor: number;
  /** Σ sale_line.cogs_minor for the product in the period. */
  cogsMinor: number;
  currentStock: number;
}

export interface VelocityAbcRow {
  velocityTier: VelocityTier;
  /** A/B/C from cumulative revenue share: top 80% = A, next 15% = B, rest C. */
  classification: AbcClass;
  name: string;
  sku: string;
  category: string;
  unitsSold: number;
  revenueMinor: number;
  profitMinor: number;
  grossMarginPct: number;
  revenueSharePct: number;
  currentStock: number;
}

/**
 * Rank products by revenue (desc) and assign A/B/C by cumulative revenue share
 * (classic ABC: A ≈ 80%, B ≈ 90–95%, C the tail). Zero-revenue products are C.
 */
export function computeVelocityAbc(rows: AbcRowInput[], days: number): VelocityAbcRow[] {
  const totalRevenue = rows.reduce((s, r) => s + r.revenueMinor, 0);
  const sorted = [...rows].sort((a, b) => b.revenueMinor - a.revenueMinor || a.name.localeCompare(b.name));

  let cumulative = 0;
  return sorted.map((r) => {
    const share = totalRevenue > 0 ? r.revenueMinor / totalRevenue : 0;
    let classification: AbcClass = 'C';
    if (r.revenueMinor > 0) {
      cumulative += share;
      if (cumulative <= 0.8) classification = 'A';
      else if (cumulative <= 0.95) classification = 'B';
      else classification = 'C';
    }
    const profitMinor = r.revenueMinor - r.cogsMinor;
    return {
      velocityTier: velocityTier(r.unitsSold, days),
      classification,
      name: r.name,
      sku: r.sku,
      category: r.category ?? '—',
      unitsSold: r.unitsSold,
      revenueMinor: r.revenueMinor,
      profitMinor,
      grossMarginPct: r.revenueMinor > 0 ? Math.round((profitMinor / r.revenueMinor) * 10000) / 100 : 0,
      revenueSharePct: Math.round(share * 10000) / 100,
      currentStock: r.currentStock,
    };
  });
}

// ---- Stockout forecast (prototype "Days-Until-Stockout") ------------------

export interface StockoutRowInput {
  productId: string;
  name: string;
  sku: string;
  category: string | null;
  currentStock: number;
  unitsSold: number;
}

export interface StockoutRow {
  name: string;
  sku: string;
  category: string;
  currentStock: number;
  unitsSold: number;
  /** units/day over the period (float, 2dp — display only). */
  dailyVelocity: number;
  /** Whole days of stock left at current velocity; null = no sales in period. */
  daysUntilStockout: number | null;
}

/** days = stock ÷ (units ÷ periodDays); null when the product had no sales. */
export function computeStockout(rows: StockoutRowInput[], days: number): StockoutRow[] {
  const out: StockoutRow[] = [];
  for (const r of rows) {
    if (r.unitsSold <= 0) continue;
    const daily = r.unitsSold / days;
    out.push({
      name: r.name,
      sku: r.sku,
      category: r.category ?? '—',
      currentStock: r.currentStock,
      unitsSold: r.unitsSold,
      dailyVelocity: Math.round(daily * 100) / 100,
      daysUntilStockout: Math.floor(r.currentStock / daily),
    });
  }
  // Most urgent first (fewest days), then by name.
  return out.sort((a, b) => (a.daysUntilStockout ?? Infinity) - (b.daysUntilStockout ?? Infinity) || a.name.localeCompare(b.name));
}
