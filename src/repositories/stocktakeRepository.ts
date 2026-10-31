/**
 * stocktakeRepository (FR-304) — the only module that touches stocktake SQL.
 *
 * Flow: create (snapshot the book stock per in-scope product) → count
 * (counted_qty per product, blind or open) → apply (gated 'stocktake_apply':
 * ONE atomic transaction writing an 'adjustment' ledger row per non-zero
 * variance via applyStockMoveInTx + its 'ledger' outbox op, then marking the
 * stocktake applied).
 *
 * Variance is always counted − book, with book = the CURRENT stock_view
 * projection at the moment it is computed (review or apply). The expected_qty
 * snapshot at creation is record/display only — counting while sales happen
 * would otherwise silently skew the applied adjustments.
 *
 * The stocktake header/counts are local (the M6 sync entity set is unchanged);
 * the applied adjustments' EFFECT is what syncs, as 'ledger' ops — the
 * server-side stock ledger is the shared truth (ADR-002).
 */

import { uuidv4 } from '../lib/ids';
import type { StocktakeLineInput } from '../lib/stocktake';
import { getDb } from '../db/database';
import { applyStockMoveInTx } from './stockRepository';
import { enqueueOpInTx } from './outboxRepository';

export type StocktakeScope = 'all' | 'category';

export interface StocktakeRow {
  id: string;
  outletId: string;
  scope: StocktakeScope;
  categoryId: string | null;
  categoryName: string | null;
  blind: boolean;
  startedAt: number;
  completedAt: number | null;
  appliedAt: number | null;
  lineCount: number;
}

export interface StocktakeLineRow extends StocktakeLineInput {
  productId: string;
  name: string;
  sku: string;
  isWeighed: boolean;
  countedQty: number | null;
  /** Book stock snapshotted when the stocktake was created (record only). */
  expectedQty: number | null;
}

export interface StocktakeDetail {
  header: StocktakeRow;
  lines: StocktakeLineRow[];
}

const HEADER_SELECT = `
  SELECT st.id, st.outlet_id AS outletId, st.scope, st.category_id AS categoryId,
         c.name AS categoryName, st.blind AS blind, st.started_at AS startedAt,
         st.completed_at AS completedAt, st.applied_at AS appliedAt,
         (SELECT COUNT(*) FROM stocktake_count sc WHERE sc.stocktake_id = st.id) AS lineCount
    FROM stocktake st
    LEFT JOIN category c ON c.id = st.category_id`;

function mapRow(r: Record<string, unknown>): StocktakeRow {
  return {
    id: String(r['id']),
    outletId: String(r['outletId']),
    scope: r['scope'] as StocktakeScope,
    categoryId: r['categoryId'] ? String(r['categoryId']) : null,
    categoryName: r['categoryName'] ? String(r['categoryName']) : null,
    blind: !!r['blind'],
    startedAt: Number(r['startedAt']),
    completedAt: r['completedAt'] != null ? Number(r['completedAt']) : null,
    appliedAt: r['appliedAt'] != null ? Number(r['appliedAt']) : null,
    lineCount: Number(r['lineCount']),
  };
}

/** All stocktakes, newest first (for the Inventory → Stocktake list). */
export async function listStocktakes(): Promise<StocktakeRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `${HEADER_SELECT} ORDER BY st.started_at DESC, st.id DESC`,
  );
  return rows.map(mapRow);
}

/** Header + in-scope lines with book stock (live projection) and counts. */
export async function getStocktakeDetail(stocktakeId: string): Promise<StocktakeDetail | null> {
  const db = await getDb();
  const header = await db.getFirstAsync<Record<string, unknown>>(
    `${HEADER_SELECT} WHERE st.id = ?`,
    [stocktakeId],
  );
  if (!header) return null;

  const rows = await db.getAllAsync<{
    product_id: string; name: string; sku: string; is_weighed: number;
    counted_qty: number | null; expected_qty: number | null; book_qty: number;
  }>(
    `SELECT sc.product_id, p.name, p.sku, p.is_weighed, sc.counted_qty, sc.expected_qty,
            CASE WHEN p.is_weighed = 1 THEN COALESCE(sv.qty_g, 0)
                 ELSE COALESCE(sv.qty, 0) END AS book_qty
       FROM stocktake_count sc
       JOIN product p ON p.id = sc.product_id
       LEFT JOIN stock_view sv ON sv.product_id = sc.product_id
      WHERE sc.stocktake_id = ?
      ORDER BY p.name`,
    [stocktakeId],
  );

  const lines: StocktakeLineRow[] = rows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    sku: r.sku,
    isWeighed: r.is_weighed === 1,
    bookQty: r.book_qty,
    countedQty: r.counted_qty,
    expectedQty: r.expected_qty,
  }));
  return { header: mapRow(header), lines };
}

/**
 * Start a stocktake for a scope (all products, or one category) and snapshot
 * the book stock per product (expected_qty). Returns the new stocktake id.
 */
export async function createStocktake(opts: {
  scope: StocktakeScope;
  categoryId?: string | null;
  blind: boolean;
}): Promise<string> {
  const db = await getDb();
  const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outlet) throw new Error('No outlet — DB not seeded');

  const id = uuidv4();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO stocktake (id, outlet_id, scope, category_id, blind, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, outlet.id, opts.scope, opts.scope === 'category' ? opts.categoryId ?? null : null,
       opts.blind ? 1 : 0, now],
    );
    const rows = await db.getAllAsync<{ id: string; book_qty: number }>(
      `SELECT p.id,
              CASE WHEN p.is_weighed = 1 THEN COALESCE(sv.qty_g, 0)
                   ELSE COALESCE(sv.qty, 0) END AS book_qty
         FROM product p
         LEFT JOIN stock_view sv ON sv.product_id = p.id
        WHERE p.active = 1
          AND (? = 'all' OR p.category_id = ?)`,
      [opts.scope, opts.scope === 'category' ? opts.categoryId ?? null : null],
    );
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO stocktake_count (id, stocktake_id, product_id, counted_qty, expected_qty)
         VALUES (?, ?, ?, NULL, ?)`,
        [uuidv4(), id, r.id, r.book_qty],
      );
    }
  });
  return id;
}

/** Persist (or clear, with null) a product's count. */
export async function saveCount(stocktakeId: string, productId: string, countedQty: number | null): Promise<void> {
  const db = await getDb();
  // createStocktake snapshots exactly one row per in-scope product, so the
  // row exists — plain UPDATE (clearing uses NULL).
  const n = await db.runAsync(
    'UPDATE stocktake_count SET counted_qty = ? WHERE stocktake_id = ? AND product_id = ?',
    [countedQty, stocktakeId, productId],
  );
  if (n.changes === 0) {
    // Defensive: product added to scope after creation — insert a fresh row
    // (expected_qty = live book, best effort).
    const book = await db.getFirstAsync<{ q: number }>(
      `SELECT CASE WHEN (SELECT is_weighed FROM product WHERE id = ?) = 1
                  THEN COALESCE((SELECT qty_g FROM stock_view WHERE product_id = ?), 0)
                  ELSE COALESCE((SELECT qty FROM stock_view WHERE product_id = ?), 0) END AS q`,
      [productId, productId, productId],
    );
    await db.runAsync(
      'INSERT INTO stocktake_count (id, stocktake_id, product_id, counted_qty, expected_qty) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), stocktakeId, productId, countedQty, book?.q ?? 0],
    );
  }
}

export interface ApplyResult {
  appliedLines: number;
  appliedAt: number;
}

/**
 * Apply the counted variances: one 'adjustment' ledger row per non-zero
 * variance (reason "Stocktake YYYY-MM-DD"), each with its 'ledger' outbox op,
 * then mark the stocktake applied. Atomic — all or nothing.
 * Variance is computed against the LIVE book (stock_view) at apply time.
 */
export async function applyStocktake(stocktakeId: string): Promise<ApplyResult> {
  const db = await getDb();
  const box: { r?: ApplyResult } = {};
  await db.withTransactionAsync(async () => {
    const st = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM stocktake WHERE id = ? AND applied_at IS NULL',
      [stocktakeId],
    );
    if (!st) throw new Error('Stocktake not found or already applied');

    const rows = await db.getAllAsync<{
      product_id: string; is_weighed: number; counted_qty: number; book_qty: number;
    }>(
      `SELECT sc.product_id, p.is_weighed, sc.counted_qty,
              CASE WHEN p.is_weighed = 1 THEN COALESCE(sv.qty_g, 0)
                   ELSE COALESCE(sv.qty, 0) END AS book_qty
         FROM stocktake_count sc
         JOIN product p ON p.id = sc.product_id
         LEFT JOIN stock_view sv ON sv.product_id = sc.product_id
        WHERE sc.stocktake_id = ? AND sc.counted_qty IS NOT NULL`,
      [stocktakeId],
    );

    // Local calendar date (NOT UTC — a 2 AM stocktake must stamp today's
    // date, not yesterday's, for stores ahead of UTC). en-CA locale emits
    // YYYY-MM-DD in the device's local timezone.
    const dateLabel = new Date().toLocaleDateString('en-CA');
    let appliedLines = 0;
    for (const r of rows) {
      const variance = r.counted_qty - r.book_qty;
      if (variance === 0) continue;
      const move = await applyStockMoveInTx(db, {
        productId: r.product_id,
        qtyDelta: r.is_weighed === 1 ? 0 : variance,
        qtyGDelta: r.is_weighed === 1 ? variance : null,
        type: 'adjustment',
        refType: 'stocktake',
        refId: stocktakeId,
        reason: `Stocktake ${dateLabel}`,
      });
      if (move.syncOpId) await enqueueOpInTx(db, 'ledger', move.syncOpId);
      appliedLines += 1;
    }

    const now = Date.now();
    await db.runAsync(
      'UPDATE stocktake SET applied_at = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?',
      [now, now, stocktakeId],
    );
    box.r = { appliedLines, appliedAt: now };
  });
  if (!box.r) throw new Error('Stocktake apply did not complete');
  return box.r;
}
