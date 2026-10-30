/**
 * Stock repository — the only module allowed to write stock_ledger rows (FR-316)
 * and to consume FIFO cost layers (ADR-003).
 *
 * Ledger rows are IMMUTABLE: this file contains no UPDATE/DELETE on stock_ledger.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../db/database';
import { applyConsumption, consumeFifo, type LayerInput } from '../lib/stock';
import { uuidv4 } from '../lib/ids';
import type { CostLayer, Lot, StockLedgerRow, StockMoveType } from '../types';

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
       cogs_minor, ref_type, ref_id, device_id, sync_op_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, await outletId(), w.productId, w.lotId ?? null, w.type, w.qtyDelta,
      w.unitCostMinor ?? null, w.cogsMinor ?? null, w.refType, w.refId,
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
            ref_type AS refType, ref_id AS refId, device_id AS deviceId,
            sync_op_id AS syncOpId, created_at AS createdAt, created_by AS createdBy
       FROM stock_ledger WHERE product_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [productId, limit],
  );
}

export type { SQLiteDatabase };
