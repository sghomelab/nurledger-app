/**
 * Stock repository — the only module allowed to write stock_ledger rows (FR-316)
 * and to consume FIFO cost layers (ADR-003).
 *
 * Ledger rows are IMMUTABLE: this file contains no UPDATE/DELETE on stock_ledger.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../db/database';
import {
  applyConsumption,
  consumeFifo,
  daysUntil,
  expiryUrgency,
  fefoRank,
  summarizeRadar,
  type LayerInput,
} from '../lib/stock';
import { uuidv4 } from '../lib/ids';
import { cogsForWeight } from '../lib/weighed';
import { enqueueOpInTx } from './outboxRepository';
import type {
  BatchWithQty,
  CostLayer,
  ExpiryRadarEntry,
  ExpiryRadarSummary,
  Lot,
  StockLedgerRow,
  StockMoveType,
} from '../types';

export async function stockOf(productId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ qty: number }>(
    'SELECT COALESCE(SUM(qty_delta), 0) AS qty FROM stock_ledger WHERE product_id = ? AND qty_delta IS NOT NULL',
    [productId],
  );
  return row ? row.qty : 0;
}

async function outletId(): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!row) throw new Error('No outlet found');
  return row.id;
}

export interface LedgerWrite {
  productId: string;
  type: StockMoveType;
  qtyDelta: number;
  lotId?: string | null;
  unitCostMinor?: number | null;
  cogsMinor?: number | null;
  refType: string;
  refId: string;
  /** Human reason (adjustments/waste/expiry) — M3, FR-305/FR-313. */
  reason?: string | null;
  deviceId?: string | null;
}

/** Append an immutable ledger row (with its client-UUID sync op). */
export async function appendLedgerRow(w: LedgerWrite): Promise<StockLedgerRow> {
  const db = await getDb();
  const id = uuidv4();
  const opId = uuidv4();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO stock_ledger
      (id, outlet_id, product_id, lot_id, type, qty_delta, qty_g_delta, unit_cost_minor,
       cogs_minor, ref_type, ref_id, reason, device_id, sync_op_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, await outletId(), w.productId, w.lotId ?? null, w.type, w.qtyDelta,
      w.unitCostMinor ?? null, w.cogsMinor ?? null, w.refType, w.refId, w.reason ?? null,
      w.deviceId ?? null, opId, now,
    ],
  );
  return {
    id,
    outletId: '',
    productId: w.productId,
    lotId: w.lotId ?? null,
    type: w.type,
    qtyDelta: w.qtyDelta,
    qtyGDelta: null,
    unitCostMinor: w.unitCostMinor ?? null,
    cogsMinor: w.cogsMinor ?? null,
    refType: w.refType,
    refId: w.refId,
    reason: w.reason ?? null,
    deviceId: w.deviceId ?? null,
    syncOpId: opId,
    createdAt: now,
    createdBy: null,
  };
}

/** Most recent lots for a product, FEFO order (M3 expiry radar). */
export async function lotsFefo(productId: string): Promise<Lot[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Lot>(
    `SELECT id, product_id AS productId, outlet_id AS outletId, lot_code AS lotCode,
            expiry_date AS expiryDate, received_at AS receivedAt
       FROM lot WHERE product_id = ? ORDER BY (expiry_date IS NULL), expiry_date, received_at, id`,
    [productId],
  );
  return rows;
}

export interface ConsumptionResult {
  cogsMinor: number;
  lotId: string | null;
  unitCostMinor: number | null;
  short: boolean;
  shortageQty: number;
}

/**
 * Consume `qty` base units for a sale (FIFO across cost layers, FEFO lot pick).
 * Returns COGS + the lot to record on the sale line. Does NOT write ledger rows —
 * the caller (sale service, M2) writes the ledger + layer updates atomically.
 */
export async function previewConsume(productId: string, qty: number): Promise<ConsumptionResult> {
  const db = await getDb();
  const layers = await db.getAllAsync<LayerInput>(
    `SELECT id, unit_cost_minor AS unitCostMinor, qty_remaining AS qtyRemaining, received_at AS receivedAt
       FROM cost_layer WHERE product_id = ?`,
    [productId],
  );
  const result = consumeFifo(layers, qty);
  const lots = await lotsFefo(productId);
  const firstLot = lots[0] ?? null;
  if (result.short || layers.length === 0) {
    return { cogsMinor: result.cogsMinor, lotId: firstLot?.id ?? null, unitCostMinor: null, short: true, shortageQty: result.shortageQty };
  }
  const oldestConsumed = result.consumed[0];
  return {
    cogsMinor: result.cogsMinor,
    lotId: firstLot?.id ?? null,
    unitCostMinor: oldestConsumed ? oldestConsumed.unitCostMinor : null,
    short: false,
    shortageQty: 0,
  };
}

/** Commit FIFO consumption: decrement layer qty_remaining (cost cursor only). */
export async function commitConsume(productId: string, qty: number): Promise<ConsumptionResult> {
  const db = await getDb();
  const preview = await previewConsume(productId, qty);
  if (!preview.short) {
    const layers = await db.getAllAsync<LayerInput>(
      `SELECT id, unit_cost_minor AS unitCostMinor, qty_remaining AS qtyRemaining, received_at AS receivedAt
         FROM cost_layer WHERE product_id = ?`,
      [productId],
    );
    const result = consumeFifo(layers, qty);
    const remaining = applyConsumption(layers, result);
    await db.withTransactionAsync(async () => {
      for (const c of result.consumed) {
        const newQty = remaining.get(c.layerId) ?? 0;
        await db.runAsync('UPDATE cost_layer SET qty_remaining = ? WHERE id = ?', [newQty, c.layerId]);
      }
    });
  }
  return preview;
}

/** Raw FIFO cost layers for a product (for the cart's live-margin preview). */
export async function costLayersOf(productId: string): Promise<LayerInput[]> {
  const db = await getDb();
  return await db.getAllAsync<LayerInput>(
    `SELECT id, unit_cost_minor AS unitCostMinor, qty_remaining AS qtyRemaining, received_at AS receivedAt
       FROM cost_layer WHERE product_id = ?`,
    [productId],
  );
}

/** Create a cost layer (PO receive / stock adjustment, ADR-003). */
export async function addCostLayer(
  productId: string,
  unitCostMinor: number,
  qty: number,
  refType: string,
  refId: string,
): Promise<CostLayer> {
  const db = await getDb();
  const id = uuidv4();
  await db.runAsync(
    `INSERT INTO cost_layer (id, outlet_id, product_id, unit_cost_minor, qty_remaining, ref_type, ref_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, await outletId(), productId, unitCostMinor, qty, refType, refId, Date.now()],
  );
  return {
    id,
    outletId: '',
    productId,
    unitCostMinor,
    qtyRemaining: qty,
    refType,
    refId,
    receivedAt: Date.now(),
  };
}

/** Last `limit` ledger rows for a product (product detail "Ledger (last 5)"). */
export async function ledgerHistory(productId: string, limit = 10): Promise<StockLedgerRow[]> {
  const db = await getDb();
  return await db.getAllAsync<StockLedgerRow>(
    `SELECT id, outlet_id AS outletId, product_id AS productId, lot_id AS lotId, type,
            qty_delta AS qtyDelta, qty_g_delta AS qtyGDelta,
            unit_cost_minor AS unitCostMinor, cogs_minor AS cogsMinor,
            ref_type AS refType, ref_id AS refId, reason,
            device_id AS deviceId, sync_op_id AS syncOpId,
            created_at AS createdAt, created_by AS createdBy
       FROM stock_ledger WHERE product_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [productId, limit],
  );
}

/** FEFO-first lot id for a product (best-effort; cost layers carry no lot). In-tx. */
async function firstFefoLotIdInTx(db: SQLiteDatabase, productId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM lot WHERE product_id = ?
      ORDER BY (expiry_date IS NULL), expiry_date, received_at, id LIMIT 1`,
    [productId],
  );
  return row?.id ?? null;
}

/**
 * Apply a SIGNED stock movement INSIDE the caller's transaction (M3, FR-316,
 * ADR-002/003). This is the single in-transaction writer for stock:
 *
 *  - `qtyDelta > 0` (stock-in: PO receive, adjustment-in): create a FIFO cost
 *    layer at the incoming cost + an immutable positive `stock_ledger` row.
 *  - `qtyDelta < 0` (stock-out: sale, adjustment-out, waste, expiry loss):
 *    consume FIFO cost layers (oldest first) + an immutable negative ledger row
 *    carrying the realized COGS (FR-321).
 *
 * The caller owns the surrounding transaction + outbox. Returns `short` true when
 * a stock-out exceeded available layers; the caller decides whether to throw
 * (sales throw → full rollback; adjustments may clamp).
 *
 * `stock_ledger` is still written ONLY from this module (module-map rule).
 */
export interface StockMoveInput {
  productId: string;
  /** Signed base-unit delta: >0 in, <0 out, 0 = no-op (use qtyGDelta for weighed). */
  qtyDelta: number;
  /** M5 (FR-103): signed GRAMS delta for weighed products. When non-zero this
   *  move bypasses the unit/FIFO path: no cost layer, COGS recorded as a per-kg
   *  fact (documented approximation — SYNC-DESIGN §weighed). */
  qtyGDelta?: number | null;
  type: StockMoveType;
  /** Unit cost (minor) for stock-in; ignored on stock-out (FIFO derives it). */
  unitCostMinor?: number | null;
  /** Specific lot (waste/expiry loss); defaults to the FEFO-first lot on out. */
  lotId?: string | null;
  /** Human reason (adjustments/waste/expiry) — stored on the ledger row. */
  reason?: string | null;
  refType: string;
  refId: string;
  /** Where to point the new cost layer (stock-in). Default { type:'move', id: refId }.
   *  PO receive passes { type:'lot', id: lotId } so the FEFO radar can join it. */
  costLayerRef?: { type: string; id: string } | null;
  deviceId?: string | null;
}

export interface StockMoveResult {
  cogsMinor: number;
  unitCostMinor: number | null;
  lotId: string | null;
  short: boolean;
  shortageQty: number;
  /** The ledger row's client-UUID idempotency key (null on a 0-qty no-op). */
  syncOpId: string | null;
}

export async function applyStockMoveInTx(
  db: SQLiteDatabase,
  input: StockMoveInput,
): Promise<StockMoveResult> {
  const outletRow = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outletRow) throw new Error('No outlet — DB not seeded');
  const now = Date.now();
  const { productId } = input;

  if (input.qtyDelta === 0 && (input.qtyGDelta ?? 0) === 0) {
    return { cogsMinor: 0, unitCostMinor: null, lotId: input.lotId ?? null, short: false, shortageQty: 0, syncOpId: null };
  }

  // Pre-generated: the caller needs it (outbox enqueue, atomic with this move)
  // and it is the server idempotency key for the ledger row.
  const syncOpId = uuidv4();

  // WEIGHED (FR-103): stock lives in grams; no FIFO layer, COGS is a per-kg fact.
  const gramsDelta = input.qtyGDelta ?? 0;
  if (gramsDelta !== 0) {
    let cogs = 0;
    let unitCost: number | null = null;
    if (gramsDelta < 0) {
      const p = await db.getFirstAsync<{ cost_minor: number }>(
        'SELECT cost_minor FROM product WHERE id = ?',
        [productId],
      );
      unitCost = p ? p.cost_minor : 0;
      cogs = cogsForWeight(unitCost, -gramsDelta);
    }
    const lotId = input.lotId ?? null;
    await db.runAsync(
      `INSERT INTO stock_ledger
         (id, outlet_id, product_id, lot_id, type, qty_delta, qty_g_delta, unit_cost_minor, cogs_minor,
          ref_type, ref_id, reason, device_id, sync_op_id, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), outletRow.id, productId, lotId, input.type, gramsDelta,
       gramsDelta < 0 ? unitCost : null, gramsDelta < 0 ? cogs : null,
       input.refType, input.refId, input.reason ?? null, input.deviceId ?? null, syncOpId, now],
    );
    return { cogsMinor: cogs, unitCostMinor: unitCost, lotId, short: false, shortageQty: 0, syncOpId };
  }

  if (input.qtyDelta > 0) {
    // STOCK IN: new FIFO cost layer + positive immutable ledger row.
    const qty = input.qtyDelta;
    let unitCost = input.unitCostMinor ?? null;
    if (unitCost == null) {
      const p = await db.getFirstAsync<{ cost_minor: number }>(
        'SELECT cost_minor FROM product WHERE id = ?',
        [productId],
      );
      unitCost = p ? p.cost_minor : 0;
    }
    const lotId = input.lotId ?? (await firstFefoLotIdInTx(db, productId));
    const layerRef = input.costLayerRef ?? { type: 'move', id: input.refId };
    await db.runAsync(
      `INSERT INTO cost_layer (id, outlet_id, product_id, unit_cost_minor, qty_remaining, ref_type, ref_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), outletRow.id, productId, unitCost, qty, layerRef.type, layerRef.id, now],
    );
    await db.runAsync(
      `INSERT INTO stock_ledger
         (id, outlet_id, product_id, lot_id, type, qty_delta, unit_cost_minor, cogs_minor,
          ref_type, ref_id, reason, device_id, sync_op_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), outletRow.id, productId, lotId, input.type, qty, unitCost,
       input.refType, input.refId, input.reason ?? null, input.deviceId ?? null, syncOpId, now],
    );
    return { cogsMinor: 0, unitCostMinor: unitCost, lotId, short: false, shortageQty: 0, syncOpId };
  }

  // STOCK OUT: consume FIFO cost layers (oldest first) + negative ledger row.
  const qty = -input.qtyDelta;
  const layers = await db.getAllAsync<LayerInput>(
    `SELECT id, unit_cost_minor AS unitCostMinor, qty_remaining AS qtyRemaining, received_at AS receivedAt
       FROM cost_layer WHERE product_id = ?`,
    [productId],
  );
  const result = consumeFifo(layers, qty);
  const lotId = input.lotId ?? (await firstFefoLotIdInTx(db, productId));
  if (!result.short) {
    const remaining = applyConsumption(layers, result);
    for (const c of result.consumed) {
      const newQty = remaining.get(c.layerId) ?? 0;
      await db.runAsync('UPDATE cost_layer SET qty_remaining = ? WHERE id = ?', [newQty, c.layerId]);
    }
  }
  const unitCostMinor = result.consumed[0]?.unitCostMinor ?? null;
  await db.runAsync(
    `INSERT INTO stock_ledger
       (id, outlet_id, product_id, lot_id, type, qty_delta, unit_cost_minor, cogs_minor,
        ref_type, ref_id, reason, device_id, sync_op_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), outletRow.id, productId, lotId, input.type, -qty, unitCostMinor,
     result.cogsMinor, input.refType, input.refId, input.reason ?? null, input.deviceId ?? null, syncOpId, now],
  );
  return {
    cogsMinor: result.cogsMinor,
    unitCostMinor,
    lotId,
    short: result.short,
    shortageQty: result.shortageQty,
    syncOpId,
  };
}

/**
 * Standalone stock move (its own transaction) for UI callers — stock adjustments,
 * waste, expiry loss. The in-tx variant is used when the move must join a larger
 * transaction (PO receive, sale commit).
 */
export async function applyStockMove(input: StockMoveInput): Promise<StockMoveResult> {
  const db = await getDb();
  const box: { r?: StockMoveResult } = {};
  await db.withTransactionAsync(async () => {
    box.r = await applyStockMoveInTx(db, input);
    // M5 (FR-502): enqueue the standalone move's sync op atomically with the
    // ledger row it just wrote (the sale path enqueues at sale-commit instead —
    // sale ledger rows ride along in the sale op's payload).
    if (box.r && box.r.syncOpId) {
      await enqueueOpInTx(db, 'ledger', box.r.syncOpId);
    }
  });
  if (!box.r) throw new Error('Stock move did not complete');
  return box.r;
}

/**
 * Sale-specific alias (M2 contract): consume `qty` + append an immutable 'sale'
 * ledger row. completeSale throws on `short` → the whole sale rolls back, so
 * stock is never partially decremented.
 */
export type SaleMoveResult = StockMoveResult;

export async function applySaleInTx(
  db: SQLiteDatabase,
  input: { productId: string; qty: number; qtyG?: number | null; refId: string; deviceId?: string | null },
): Promise<SaleMoveResult> {
  // Weighed (FR-103): the ledger delta is in grams; the unit qty stays 0.
  const grams = input.qtyG ?? null;
  return applyStockMoveInTx(db, {
    productId: input.productId,
    qtyDelta: grams != null ? 0 : -input.qty,
    qtyGDelta: grams != null ? -grams : null,
    type: 'sale',
    refType: 'sale',
    refId: input.refId,
    deviceId: input.deviceId ?? null,
  });
}

/**
 * All lots/batches with their remaining sellable qty (from the linked FIFO cost
 * layer), for the FEFO Expiry Radar (FR-307). A batch with no linked layer
 * (fully consumed) shows 0.
 */
export async function batchesWithQty(): Promise<BatchWithQty[]> {
  const db = await getDb();
  return await db.getAllAsync<BatchWithQty>(
    `SELECT l.id, l.product_id AS productId, p.sku, p.name AS productName,
            l.lot_code AS lotCode, l.expiry_date AS expiryDate, l.received_at AS receivedAt,
            COALESCE(cl.qty_remaining, 0) AS qtyRemaining
       FROM lot l
       JOIN product p ON p.id = l.product_id
       LEFT JOIN cost_layer cl ON cl.ref_type = 'lot' AND cl.ref_id = l.id
       ORDER BY (l.expiry_date IS NULL), l.expiry_date, l.received_at, l.id`,
  );
}

/**
 * FEFO Expiry Radar (FR-307): batches ranked earliest-expiry-first with a
 * computed urgency band + an Expiring/Expired/Other summary (prototype §5).
 */
export async function expiryRadar(
  now: Date = new Date(),
): Promise<{ entries: ExpiryRadarEntry[]; summary: ExpiryRadarSummary }> {
  const batches = await batchesWithQty();
  const entries: ExpiryRadarEntry[] = batches
    .map((b) => {
      const daysLeft = b.expiryDate ? daysUntil(b.expiryDate, now) : Number.POSITIVE_INFINITY;
      return { ...b, daysLeft, urgency: expiryUrgency(daysLeft) };
    })
    .filter((b) => b.qtyRemaining > 0); // only batches that still hold stock
  const ranked = fefoRank(entries);
  return { entries: ranked, summary: summarizeRadar(ranked) };
}

export type { SQLiteDatabase };
