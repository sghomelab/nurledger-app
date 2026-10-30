/**
 * Order repository — persists the active cart (NFR-3).
 *
 * The register holds ONE active order; every mutation rewrites its lines within
 * a transaction so a kill mid-sale leaves the cart intact (exit test: "kill app
 * mid-sale, relaunch — sale and stock intact"). Parked orders land in M3.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../db/database';
import type { CartLine } from '../types';

const ACTIVE_ORDER_ID = 'active';

interface RawLine {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  unit_price_minor: number;
  qty: number;
  qty_g: number | null;
  tax_category: string;
  discount_minor: number;
  cogs_minor: number;
  unit_cost_minor: number | null;
  lot_id: string | null;
  stock_qty: number;
}

function mapLine(r: RawLine): CartLine {
  return {
    key: r.id,
    productId: r.product_id,
    sku: r.sku,
    name: r.name,
    unitPriceMinor: r.unit_price_minor,
    qty: r.qty,
    qtyG: r.qty_g,
    taxCategory: r.tax_category,
    discountMinor: r.discount_minor,
    cogsMinor: r.cogs_minor,
    unitCostMinor: r.unit_cost_minor,
    lotId: r.lot_id,
    stockQty: r.stock_qty,
  };
}

const LINE_COLS = `
  id, product_id, sku, name, unit_price_minor, qty, qty_g, tax_category,
  discount_minor, cogs_minor, unit_cost_minor, lot_id, stock_qty
`;

/** Load the active cart, or null if there is none. */
export async function loadActiveOrder(): Promise<{ orderDiscountMinor: number; lines: CartLine[] } | null> {
  const db = await getDb();
  const order = await db.getFirstAsync<{ order_discount_minor: number }>(
    'SELECT order_discount_minor FROM current_order WHERE id = ?',
    [ACTIVE_ORDER_ID],
  );
  if (!order) return null;
  const rows = await db.getAllAsync<RawLine>(
    `SELECT ${LINE_COLS} FROM current_order_line WHERE order_id = ? ORDER BY position`,
    [ACTIVE_ORDER_ID],
  );
  return { orderDiscountMinor: order.order_discount_minor, lines: rows.map(mapLine) };
}

/**
 * Persist the active cart (upsert header, rewrite lines). Idempotent — the hook
 * calls this after every mutation (NFR-3).
 */
export async function saveActiveOrder(orderDiscountMinor: number, lines: CartLine[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT OR REPLACE INTO current_order (id, order_discount_minor, updated_at) VALUES (?, ?, ?)',
      [ACTIVE_ORDER_ID, orderDiscountMinor, Date.now()],
    );
    await db.runAsync('DELETE FROM current_order_line WHERE order_id = ?', [ACTIVE_ORDER_ID]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      await db.runAsync(
        `INSERT INTO current_order_line
           (id, order_id, product_id, sku, name, unit_price_minor, qty, qty_g, tax_category,
            discount_minor, cogs_minor, unit_cost_minor, lot_id, stock_qty, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.key, ACTIVE_ORDER_ID, l.productId, l.sku, l.name, l.unitPriceMinor, l.qty, l.qtyG ?? null, l.taxCategory,
         l.discountMinor, l.cogsMinor, l.unitCostMinor, l.lotId, l.stockQty, i],
      );
    }
  });
}

/**
 * Clear the active cart WITHOUT opening a transaction — runs the two DELETEs on
 * the caller's connection. Used by `saleRepository.completeSale` inside its own
 * transaction (expo-sqlite `withTransactionAsync` is not nestable; an inner
 * wrapper commits early and breaks the outer one).
 */
export async function clearActiveOrderInTx(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM current_order_line WHERE order_id = ?', [ACTIVE_ORDER_ID]);
  await db.runAsync('DELETE FROM current_order WHERE id = ?', [ACTIVE_ORDER_ID]);
}

/** Standalone clear (own transaction) for callers outside a surrounding txn. */
export async function clearActiveOrder(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(() => clearActiveOrderInTx(db));
}
