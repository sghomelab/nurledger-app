/**
 * Insights repository (FR-400/FR-401/FR-403). Read-only aggregates over the
 * sale/payment/sale_line/expense/cost_layer tables for the Insights tab.
 * All sales figures are scoped to `status='completed'` and `created_at >= ?`.
 * Math (KPIs, ABC, stockout) is pure — see src/lib/kpi.ts.
 */

import { getDb } from '../db/database';
import { roundDivide } from '../lib/money';
import { refundNetShareMinor, type OpexTotals, type PeriodTotals } from '../lib/kpi';

/**
 * FR-403: the period's headline sales aggregates (sale headers are
 * authoritative). CR-09: refund aggregates are sourced alongside so
 * `computeKpis` can deduct them — money back (gross basis), the VAT-excl.
 * revenue share (net basis), the FIFO COGS of restocked units, and the units
 * that came back. Refunds are period-scoped by `refund.created_at` (when the
 * money came back), NOT by the parent sale's date.
 */
export async function getPeriodTotals(fromMs: number): Promise<Omit<PeriodTotals, 'fromMs'>> {
  const db = await getDb();
  const head = await db.getFirstAsync<{
    tx: number; subtotal: number; discount: number; tax: number; gross: number; cogs: number;
  }>(
    `SELECT COUNT(*) AS tx,
            COALESCE(SUM(subtotal_minor), 0) AS subtotal,
            COALESCE(SUM(discount_minor), 0) AS discount,
            COALESCE(SUM(tax_minor), 0) AS tax,
            COALESCE(SUM(total_minor), 0) AS gross,
            COALESCE(SUM(cogs_minor), 0) AS cogs
     FROM sale WHERE status = 'completed' AND created_at >= ?`,
    [fromMs],
  );

  const unitsRow = await db.getFirstAsync<{ units: number }>(
    `SELECT COALESCE(SUM(sl.qty), 0) AS units
     FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
     WHERE s.status = 'completed' AND s.created_at >= ?`,
    [fromMs],
  );

  // Discounted items = lines carrying a line-level discount, plus lines of a
  // sale whose header discount exceeds the sum of line discounts (i.e. an
  // order-level discount was applied to the whole basket).
  const discRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
     FROM sale_line sl
     JOIN sale s ON s.id = sl.sale_id
     JOIN (SELECT sale_id, SUM(discount_minor) AS line_disc FROM sale_line GROUP BY sale_id) agg
       ON agg.sale_id = sl.sale_id
     WHERE s.status = 'completed' AND s.created_at >= ?
       AND (sl.discount_minor > 0 OR s.discount_minor > agg.line_disc)`,
    [fromMs],
  );

  // CR-09 — refund headers created in the period (money back to customers).
  const refundHead = await db.getFirstAsync<{ n: number; minor: number }>(
    'SELECT COUNT(*) AS n, COALESCE(SUM(amount_minor), 0) AS minor FROM refund WHERE created_at >= ?',
    [fromMs],
  );
  // The VAT-excl. share is prorated PER REFUND against its parent sale's own
  // net/pre-tax ratio (refundNetShareMinor — pure, tested in kpi.test.ts).
  // Period-level proration would skew when the period mixes tax rates
  // (e.g. standard + exempt lines).
  const refundRows = await db.getAllAsync<{ amount: number; preTax: number; net: number }>(
    `SELECT r.amount_minor AS amount,
            s.subtotal_minor - s.discount_minor AS preTax,
            s.subtotal_minor - s.discount_minor - s.tax_minor AS net
       FROM refund r JOIN sale s ON s.id = r.sale_id
      WHERE r.created_at >= ?`,
    [fromMs],
  );
  // Returned units + restock COGS reversal, per refund LINE (the line carries
  // the restock flag; the sale-time COGS lives on the parent sale_line).
  const refundLines = await db.getAllAsync<{
    qty: number; qtyG: number | null; lineQty: number; lineQtyG: number | null;
    cogs: number; restock: number;
  }>(
    `SELECT rl.qty, rl.qty_g AS qtyG, sl.qty AS lineQty, sl.qty_g AS lineQtyG,
            COALESCE(sl.cogs_minor, 0) AS cogs, rl.restock
       FROM refund_line rl
       JOIN refund r ON r.id = rl.refund_id
       JOIN sale_line sl ON sl.id = rl.sale_line_id
      WHERE r.created_at >= ?`,
    [fromMs],
  );
  let refundedUnits = 0;
  let refundedCogsMinor = 0;
  for (const l of refundLines) {
    // Weighed sale lines count as 1 unit; a refunded weighed line counts 1
    // only when (rounded) all of its grams came back — same unit semantics as
    // the sale side.
    refundedUnits +=
      l.lineQtyG != null && l.qtyG != null ? roundDivide(l.qtyG, l.lineQtyG) : l.qty;
    // COGS reverses ONLY when the goods were restocked (they re-entered the
    // FIFO layers at the sale-time cost — reversing keeps the P&L consistent).
    // Prorated by the refunded share of the line (grams for weighed lines).
    if (l.restock === 1) {
      refundedCogsMinor +=
        l.lineQtyG != null && l.qtyG != null
          ? roundDivide(l.cogs * l.qtyG, l.lineQtyG)
          : roundDivide(l.cogs * l.qty, l.lineQty);
    }
  }

  return {
    transactions: head?.tx ?? 0,
    unitsSold: unitsRow?.units ?? 0,
    subtotalMinor: head?.subtotal ?? 0,
    discountMinor: head?.discount ?? 0,
    taxMinor: head?.tax ?? 0,
    grossTotalMinor: head?.gross ?? 0,
    cogsMinor: head?.cogs ?? 0,
    discountedItems: discRow?.n ?? 0,
    refundCount: refundHead?.n ?? 0,
    refundMinor: refundHead?.minor ?? 0,
    refundNetMinor: refundRows.reduce(
      (sum, r) => sum + refundNetShareMinor(r.amount, r.net, r.preTax), 0,
    ),
    refundedUnits,
    refundedCogsMinor,
  };
}

/** Timestamp of the first completed sale (lifetime velocity denominator), or null. */
export async function getFirstSaleAt(): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ ts: number }>(
    "SELECT MIN(created_at) AS ts FROM sale WHERE status = 'completed'",
  );
  return row?.ts ?? null;
}

/**
 * Units received into stock in the period (stock_ledger type='receive_po') —
 * sell-through denominator (research doc §4 / FR-403).
 */
export async function getReceivedUnitsInPeriod(fromMs: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COALESCE(SUM(qty_delta), 0) AS n
     FROM stock_ledger
     WHERE type = 'receive_po' AND qty_delta IS NOT NULL AND created_at >= ?`,
    [fromMs],
  );
  return row?.n ?? 0;
}

/**
 * Shrinkage value in the period: outbound stock adjustments (type='adjustment',
 * qty_delta < 0) valued at the product's CURRENT cost (documented approximation —
 * the adjustment-time cost is not retained on the ledger row).
 */
export async function getShrinkageValueMinor(fromMs: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(ABS(sl.qty_delta) * p.cost_minor), 0) AS v
     FROM stock_ledger sl
     JOIN product p ON p.id = sl.product_id
     WHERE sl.type = 'adjustment' AND sl.qty_delta IS NOT NULL AND sl.qty_delta < 0
       AND sl.created_at >= ?`,
    [fromMs],
  );
  return row?.v ?? 0;
}

/**
 * Value of inventory sitting in EXPIRED lots (snapshot): cost layers whose
 * referenced lot's expiry_date is before today (local). ISO date strings
 * compare lexicographically — same ordering the FEFO radar uses.
 */
export async function getExpiredInventoryValueMinor(todayLocal: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(cl.qty_remaining * cl.unit_cost_minor), 0) AS v
     FROM cost_layer cl
     JOIN lot l ON l.id = cl.ref_id AND cl.ref_type = 'lot'
     WHERE l.expiry_date IS NOT NULL AND l.expiry_date < ?`,
    [todayLocal],
  );
  return row?.v ?? 0;
}

/** Fill-rate units: ordered vs received on POs created in the period. */
export async function getPoFillUnits(fromMs: number): Promise<{ ordered: number; received: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ ordered: number; received: number }>(
    `SELECT COALESCE(SUM(pl.qty_ordered), 0) AS ordered,
            COALESCE(SUM(pl.qty_received), 0) AS received
     FROM po_line pl
     JOIN purchase_order po ON po.id = pl.po_id
     WHERE po.created_at >= ?`,
    [fromMs],
  );
  return { ordered: row?.ordered ?? 0, received: row?.received ?? 0 };
}

/** Operating expenses by type in the period (P&L "Operating Costs"). */
export async function getOpexTotals(fromMs: number): Promise<OpexTotals> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ type: string; total: number }>(
    'SELECT type, COALESCE(SUM(amount_minor), 0) AS total FROM expense WHERE created_at >= ? GROUP BY type',
    [fromMs],
  );
  const out: OpexTotals = { payrollMinor: 0, maintenanceMinor: 0, otherMinor: 0 };
  for (const r of rows) {
    if (r.type === 'payroll') out.payrollMinor = r.total;
    else if (r.type === 'maintenance') out.maintenanceMinor = r.total;
    else out.otherMinor = r.total;
  }
  return out;
}

/** P&L "INVENTORY ASSET POSITION" (current, not period-scoped). */
export async function getInventoryValuation(): Promise<{ atCostMinor: number; atRetailMinor: number }> {
  const db = await getDb();
  const cost = await db.getFirstAsync<{ v: number }>(
    'SELECT COALESCE(SUM(qty_remaining * unit_cost_minor), 0) AS v FROM cost_layer',
  );
  const retail = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(sv.qty * p.price_minor), 0) AS v
     FROM stock_view sv JOIN product p ON p.id = sv.product_id`,
  );
  return { atCostMinor: cost?.v ?? 0, atRetailMinor: retail?.v ?? 0 };
}

/** Per-product sales in the period (Velocity/ABC + stockout inputs). */
export async function getProductSalesInPeriod(fromMs: number): Promise<
  Array<{ productId: string; unitsSold: number; revenueMinor: number; cogsMinor: number }>
> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    product_id: string; units: number; revenue: number; cogs: number;
  }>(
    `SELECT sl.product_id,
            COALESCE(SUM(sl.qty), 0) AS units,
            COALESCE(SUM(sl.line_total_minor), 0) AS revenue,
            COALESCE(SUM(sl.cogs_minor), 0) AS cogs
     FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
     WHERE s.status = 'completed' AND s.created_at >= ?
     GROUP BY sl.product_id`,
    [fromMs],
  );
  return rows.map((r) => ({
    productId: r.product_id,
    unitsSold: r.units,
    revenueMinor: r.revenue,
    cogsMinor: r.cogs,
  }));
}

/** All active products with their current stock (joins zero-sale products). */
export async function getActiveProductStock(): Promise<
  Array<{ productId: string; name: string; sku: string; category: string | null; stockQty: number }>
> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string; name: string; sku: string; category_name: string | null; qty: number;
  }>(
    `SELECT p.id, p.name, p.sku, c.name AS category_name, COALESCE(sv.qty, 0) AS qty
     FROM product p
     LEFT JOIN category c ON c.id = p.category_id
     LEFT JOIN stock_view sv ON sv.product_id = p.id
     WHERE p.active = 1
     ORDER BY p.name ASC`,
  );
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    sku: r.sku,
    category: r.category_name,
    stockQty: r.qty,
  }));
}

export interface SalesHistoryEntry {
  id: string;
  createdAt: number;
  cashierName: string | null;
  products: string | null;
  methods: string | null;
  itemCount: number;
  units: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * FR-401: sales history. `search` matches cashier name, product name, or sale
 * id (case-insensitive); scoped to `created_at >= fromMs`. Capped at `limit`.
 */
export async function getSalesHistory(
  fromMs: number,
  search: string,
  limit = 200,
): Promise<SalesHistoryEntry[]> {
  const db = await getDb();
  const like = `%${search.trim()}%`;
  const rows = await db.getAllAsync<{
    id: string; created_at: number; cashier_name: string | null; products: string | null;
    methods: string | null; items: number; units: number;
    subtotal_minor: number; discount_minor: number; tax_minor: number; total_minor: number;
  }>(
    `SELECT s.id, s.created_at, u.name AS cashier_name,
            (SELECT GROUP_CONCAT(p2.name, ' | ') FROM sale_line sl2
             JOIN product p2 ON p2.id = sl2.product_id WHERE sl2.sale_id = s.id) AS products,
            (SELECT GROUP_CONCAT(pm.method, '+') FROM payment pm WHERE pm.sale_id = s.id) AS methods,
            (SELECT COUNT(*) FROM sale_line sl3 WHERE sl3.sale_id = s.id) AS items,
            (SELECT COALESCE(SUM(sl4.qty), 0) FROM sale_line sl4 WHERE sl4.sale_id = s.id) AS units,
            s.subtotal_minor, s.discount_minor, s.tax_minor, s.total_minor
     FROM sale s
     LEFT JOIN app_user u ON u.id = s.cashier_id
     WHERE s.status = 'completed' AND s.created_at >= ?
       AND (? = '' OR u.name LIKE ?
            OR s.id LIKE ?
            OR EXISTS (SELECT 1 FROM sale_line sl5
                       JOIN product p5 ON p5.id = sl5.product_id
                       WHERE sl5.sale_id = s.id AND p5.name LIKE ?))
     ORDER BY s.created_at DESC
     LIMIT ?`,
    [fromMs, search.trim(), like, like, like, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    cashierName: r.cashier_name,
    products: r.products,
    methods: r.methods,
    itemCount: r.items,
    units: r.units,
    subtotalMinor: r.subtotal_minor,
    discountMinor: r.discount_minor,
    taxMinor: r.tax_minor,
    totalMinor: r.total_minor,
  }));
}
