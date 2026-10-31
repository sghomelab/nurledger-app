/**
 * Outbox repository (FR-502) — the only module that reads/writes `outbox` +
 * `delta_cursor`.
 *
 * Design (docs/SYNC-DESIGN.md §3):
 *  - Ops are enqueued AT WRITE TIME with a client-UUID `op_id` (the server
 *    idempotency key). `ON CONFLICT (op_id) DO NOTHING` makes enqueueing
 *    itself idempotent (safe on crash-retry).
 *  - The stored `payload` is a small debug hint only. The AUTHORITATIVE
 *    payload is RECONSTRUCTED at drain time from the immutable source rows
 *    (sale/sale_line/payment/stock_ledger/product) — which is also what makes
 *    pre-M5 rows (seed stock, M3/M4 adjustments, fixture sales) syncable.
 *  - `backfillOnce()` enqueues everything that predates M5 exactly once.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../db/database';
import { uuidv4 } from '../lib/ids';
import { productResolveRef, saleResolveCandidates, type SyncEntity } from '../lib/sync';

export interface PendingOp {
  id: string;
  opId: string;
  entity: SyncEntity;
  /** Stored debug hint — also the RESOLVER for ops whose op_id is not the
   * source row's key (product edits carry a fresh op id + `{ productId }`;
   * legacy sale ops carry `{ saleId, saleUuid }`). */
  payload: string;
  createdAt: number;
  /** rowid — FIFO tie-breaker for equal timestamps. */
  seq: number;
}

/** Enqueue (own transaction). No-op if op_id already queued. */
export async function enqueueOp(entity: SyncEntity, opId: string, payloadHint = '{}'): Promise<void> {
  const db = await getDb();
  await enqueueOpInTx(db, entity, opId, payloadHint);
}

/** Enqueue inside the CALLER's transaction (atomic with the business write). */
export async function enqueueOpInTx(db: SQLiteDatabase, entity: SyncEntity, opId: string, payloadHint = '{}'): Promise<void> {
  await db.runAsync(
    'INSERT INTO outbox (id, op_id, entity, payload, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (op_id) DO NOTHING',
    [uuidv4(), opId, entity, payloadHint, Date.now()],
  );
}

/** Pending ops, strictly FIFO (created_at, then insertion rowid). */
export async function pendingOps(limit = 20): Promise<PendingOp[]> {
  const db = await getDb();
  return await db.getAllAsync<PendingOp>(
    `SELECT id, op_id AS opId, entity, payload, created_at AS createdAt, rowid AS seq
       FROM outbox
      WHERE uploaded_at IS NULL
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?`,
    [limit],
  );
}

/** Mark ops uploaded (only after the server confirmed each one). */
export async function markUploaded(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  const db = await getDb();
  const ph = opIds.map(() => '?').join(', ');
  await db.runAsync(`UPDATE outbox SET uploaded_at = ? WHERE op_id IN (${ph})`, [Date.now(), ...opIds]);
}

/** "N ops waiting" (FR-503 banner). */
export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE uploaded_at IS NULL');
  return row ? row.n : 0;
}

export async function pendingCountByEntity(): Promise<Record<SyncEntity, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ entity: SyncEntity; n: number }>(
    'SELECT entity, COUNT(*) AS n FROM outbox WHERE uploaded_at IS NULL GROUP BY entity',
  );
  const out: Record<SyncEntity, number> = { sale: 0, ledger: 0, product: 0, refund: 0, category: 0 };
  for (const r of rows) out[r.entity] = r.n;
  return out;
}

// ---------------- delta cursors ----------------

export type CursorTable = 'product' | 'sale' | 'ledger' | 'refund' | 'category';

export async function getCursor(table: CursorTable): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_updated_at: number } | null>(
    'SELECT last_updated_at FROM delta_cursor WHERE table_name = ?',
    [table],
  );
  return row ? row.last_updated_at : 0;
}

/** Monotonic — never rewinds (sync.ts advanceCursor is the rule; this is the storage). */
export async function setCursor(table: CursorTable, ts: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO delta_cursor (table_name, last_updated_at) VALUES (?, ?)
     ON CONFLICT (table_name) DO UPDATE SET last_updated_at = MAX(last_updated_at, excluded.last_updated_at)`,
    [table, ts],
  );
}

// ---------------- payload reconstruction (drain time) ----------------

interface RawLedgerRow {
  opId: string | null;
  id: string;
  outletId: string;
  productId: string;
  lotId: string | null;
  type: string;
  qtyDelta: number | null;
  qtyGDelta: number | null;
  unitCostMinor: number | null;
  cogsMinor: number | null;
  refType: string | null;
  refId: string | null;
  reason: string | null;
  deviceId: string | null;
  createdBy: string | null;
  createdAt: number;
}

const LEDGER_COLS = `sync_op_id AS opId, id, outlet_id AS outletId, product_id AS productId,
  lot_id AS lotId, type, qty_delta AS qtyDelta, qty_g_delta AS qtyGDelta,
  unit_cost_minor AS unitCostMinor, cogs_minor AS cogsMinor, ref_type AS refType,
  ref_id AS refId, reason, device_id AS deviceId, created_by AS createdBy, created_at AS createdAt`;

function ledgerPayload(r: RawLedgerRow, tenantOutletId?: string): string {
  return JSON.stringify({
    op_id: r.opId, id: r.id, outlet_id: tenantOutletId ?? r.outletId, product_id: r.productId,
    lot_id: r.lotId, type: r.type, qty_delta: r.qtyDelta, qty_g_delta: r.qtyGDelta,
    unit_cost_minor: r.unitCostMinor, cogs_minor: r.cogsMinor, ref_type: r.refType,
    ref_id: r.refId, reason: r.reason, device_id: r.deviceId, created_by: r.createdBy,
    created_at: r.createdAt,
  });
}

/**
 * Rebuild the `apply_sale` payload from local immutable rows.
 * Returns null when the sale no longer exists (poison op → skip + mark).
 *
 * `tenantOutletId`: the CLOUD tenant's outlet id. Local rows carry this
 * device's outlet id; when the device joined an existing store the cloud row
 * is keyed differently, so the payload re-maps it here (the reverse mapping
 * happens in `applyPullLocally`). Omitted = local id (device that created it).
 */
export async function buildSalePayload(saleRef: string, payloadHint: string | null, tenantOutletId?: string): Promise<string | null> {
  const db = await getDb();
  const SALE_COLS = `id, uuid, outlet_id AS outletId, device_id AS deviceId, cashier_id AS cashierId,
            shift_id AS shiftId, status, subtotal_minor AS subtotalMinor,
            discount_minor AS discountMinor, tax_minor AS taxMinor, total_minor AS totalMinor,
            cogs_minor AS cogsMinor, created_at AS createdAt`;
  // op_id = sale.uuid for every op the sale path enqueues — the resolver (lib)
  // orders the candidates: the op id first, then the stored hint's saleId /
  // saleUuid (legacy ops queued a RANDOM op_id whose only pointer to the sale
  // is the hint). Each candidate is matched against BOTH sale.uuid and
  // sale.id; the DB does the existence check.
  let sale: Record<string, unknown> | null = null;
  for (const candidate of saleResolveCandidates(saleRef, payloadHint)) {
    sale = await db.getFirstAsync<Record<string, unknown> | null>(
      `SELECT ${SALE_COLS} FROM sale WHERE uuid = ? OR id = ?`, [candidate, candidate],
    );
    if (sale) break;
  }
  if (!sale) return null;
  // Child rows are linked by the LOCAL sale.id (sale_line.sale_id, ledger
  // ref_id) — not the sync uuid.
  const localSaleId = String(sale['id']);
  const lines = await db.getAllAsync<Record<string, unknown>>(
    `SELECT id, product_id AS productId, lot_id AS lotId, qty, qty_g AS qtyG,
            unit_price_minor AS unitPriceMinor, discount_minor AS discountMinor,
            tax_minor AS taxMinor, line_total_minor AS lineTotalMinor,
            unit_cost_minor AS unitCostMinor, cogs_minor AS cogsMinor, created_at AS createdAt
       FROM sale_line WHERE sale_id = ? ORDER BY rowid`,
    [localSaleId],
  );
  const payments = await db.getAllAsync<Record<string, unknown>>(
    `SELECT id, method, amount_minor AS amountMinor, reference, created_at AS createdAt
       FROM payment WHERE sale_id = ? ORDER BY rowid`,
    [localSaleId],
  );
  const ledgerRows = await db.getAllAsync<RawLedgerRow>(
    `SELECT ${LEDGER_COLS} FROM stock_ledger WHERE ref_type = 'sale' AND ref_id = ? ORDER BY rowid`,
    [localSaleId],
  );

  const g = (r: Record<string, unknown>, k: string) => r[k];
  return JSON.stringify({
    uuid: g(sale, 'uuid'), id: g(sale, 'id'),
    outlet_id: tenantOutletId ?? g(sale, 'outletId'),
    device_id: g(sale, 'deviceId') ?? null, cashier_id: g(sale, 'cashierId') ?? null,
    shift_id: g(sale, 'shiftId') ?? null, status: g(sale, 'status'),
    subtotal_minor: g(sale, 'subtotalMinor'), discount_minor: g(sale, 'discountMinor'),
    tax_minor: g(sale, 'taxMinor'), total_minor: g(sale, 'totalMinor'),
    cogs_minor: g(sale, 'cogsMinor'), created_at: g(sale, 'createdAt'),
    lines: lines.map((l) => ({
      id: g(l, 'id'), product_id: g(l, 'productId'), lot_id: g(l, 'lotId') ?? null,
      qty: g(l, 'qty'), qty_g: g(l, 'qtyG') ?? null,
      unit_price_minor: g(l, 'unitPriceMinor'), discount_minor: g(l, 'discountMinor'),
      tax_minor: g(l, 'taxMinor'), line_total_minor: g(l, 'lineTotalMinor'),
      unit_cost_minor: g(l, 'unitCostMinor') ?? null, cogs_minor: g(l, 'cogsMinor') ?? null,
      created_at: g(l, 'createdAt'),
    })),
    payments: payments.map((p) => ({
      id: g(p, 'id'), method: g(p, 'method'), amount_minor: g(p, 'amountMinor'),
      reference: g(p, 'reference') ?? null, created_at: g(p, 'createdAt'),
    })),
    ledger_rows: ledgerRows.map((r) => ({
      op_id: r.opId, id: r.id, product_id: r.productId, lot_id: r.lotId, type: r.type,
      qty_delta: r.qtyDelta, qty_g_delta: r.qtyGDelta, unit_cost_minor: r.unitCostMinor,
      cogs_minor: r.cogsMinor, ref_type: r.refType, ref_id: r.refId, reason: r.reason,
      device_id: r.deviceId, created_by: r.createdBy, created_at: r.createdAt,
    })),
  });
}

/**
 * Rebuild the `apply_refund` payload (M6, FR-110) from local immutable rows.
 * op_id = refund.uuid. The restock ledger rows (ref_type='refund',
 * ref_id=refund.id) ride along exactly like the sale path.
 * Returns null when the refund no longer exists (poison op → skip + mark).
 */
export async function buildRefundPayload(refundRef: string, payloadHint: string | null, tenantOutletId?: string): Promise<string | null> {
  const db = await getDb();
  void payloadHint; // the stored hint is debug-only; op_id IS the refund uuid
  const refund = await db.getFirstAsync<Record<string, unknown> | null>(
    `SELECT id, uuid, sale_id AS saleId, reason_code AS reasonCode, restock,
            amount_minor AS amountMinor, pin_verified_by AS pinVerifiedBy, created_at AS createdAt
       FROM refund WHERE uuid = ? OR id = ?`,
    [refundRef, refundRef],
  );
  if (!refund) return null;

  // The local refund header has no outlet/device columns — the outlet id is
  // single-tenant (this device's), the device id is the settings row.
  const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  const dev = await db.getFirstAsync<{ value: string } | null>(
    "SELECT value FROM settings WHERE key = 'device_id'",
  );
  const sale = await db.getFirstAsync<{ uuid: string } | null>(
    'SELECT uuid FROM sale WHERE id = ?', [String(refund['saleId'])],
  );
  if (!sale) return null; // sale vanished — integrity surprise; treat as poison

  const localRefundId = String(refund['id']);
  const lines = await db.getAllAsync<Record<string, unknown>>(
    `SELECT id, sale_line_id AS saleLineId, product_id AS productId, qty,
            qty_g AS qtyG, amount_minor AS amountMinor, restock
       FROM refund_line WHERE refund_id = ? ORDER BY rowid`,
    [localRefundId],
  );
  const ledgerRows = await db.getAllAsync<RawLedgerRow>(
    `SELECT ${LEDGER_COLS} FROM stock_ledger WHERE ref_type = 'refund' AND ref_id = ? ORDER BY rowid`,
    [localRefundId],
  );

  const g = (r: Record<string, unknown>, k: string) => r[k];
  return JSON.stringify({
    uuid: g(refund, 'uuid'), id: g(refund, 'id'),
    sale_uuid: sale.uuid,
    outlet_id: tenantOutletId ?? outlet?.id ?? null,
    device_id: dev?.value ?? null,
    user_id: g(refund, 'pinVerifiedBy') ?? null,
    reason_code: g(refund, 'reasonCode'),
    restock: !!g(refund, 'restock'),
    amount_minor: g(refund, 'amountMinor'),
    created_at: g(refund, 'createdAt'),
    lines: lines.map((l) => ({
      id: g(l, 'id'), sale_line_id: g(l, 'saleLineId'), product_id: g(l, 'productId'),
      qty: g(l, 'qty'), qty_g: g(l, 'qtyG') ?? null,
      amount_minor: g(l, 'amountMinor'), restock: !!g(l, 'restock'),
    })),
    ledger_rows: ledgerRows.map((r) => ({
      op_id: r.opId, id: r.id, product_id: r.productId, lot_id: r.lotId, type: r.type,
      qty_delta: r.qtyDelta, qty_g_delta: r.qtyGDelta, unit_cost_minor: r.unitCostMinor,
      cogs_minor: r.cogsMinor, ref_type: r.refType, ref_id: r.refId, reason: r.reason,
      device_id: r.deviceId, created_by: r.createdBy, created_at: r.createdAt,
    })),
  });
}

/** Rebuild the `apply_ledger` payload for a standalone move (op_id = sync_op_id). */
export async function buildLedgerPayload(syncOpId: string, tenantOutletId?: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawLedgerRow | null>(
    `SELECT ${LEDGER_COLS} FROM stock_ledger WHERE sync_op_id = ?`,
    [syncOpId],
  );
  return row ? ledgerPayload(row, tenantOutletId) : null;
}

/** Rebuild the `apply_product` payload (LWW fields + this device as editor). */
export async function buildProductPayload(productRef: string, payloadHint: string | null, tenantOutletId?: string): Promise<string | null> {
  const db = await getDb();
  // op_id = product.id for create/backfill ops. Edit + deactivate ops carry a
  // FRESH random op_id (retries of distinct edits must not dedupe against
  // each other via ON CONFLICT (op_id)) and resolve the row via the stored
  // hint `{ productId }` — the pure resolver (lib) picks the ref; the DB does
  // the existence check.
  const ref = productResolveRef(productRef, payloadHint);
  const p = await db.getFirstAsync<Record<string, unknown> | null>(
    `SELECT id, outlet_id AS outletId, sku, name, category_id AS categoryId,
            unit_type AS unitType, is_weighed AS isWeighed, barcode,
            carton_barcode AS cartonBarcode, carton_size AS cartonSize,
            cost_minor AS costMinor, price_minor AS priceMinor,
            tax_category AS taxCategory, min_qty AS minQty, max_qty AS maxQty,
            velocity_class AS velocityClass, description, active,
            created_at AS createdAt, updated_at AS updatedAt
       FROM product WHERE id = ?`,
    [ref],
  );
  if (!p) return null;
  const dev = await db.getFirstAsync<{ value: string } | null>(
    "SELECT value FROM settings WHERE key = 'device_id'",
  );
  const g = (r: Record<string, unknown>, k: string) => r[k];
  return JSON.stringify({
    id: g(p, 'id'), outlet_id: tenantOutletId ?? g(p, 'outletId'), sku: g(p, 'sku'), name: g(p, 'name'),
    category_id: g(p, 'categoryId') ?? null, unit_type: g(p, 'unitType'),
    is_weighed: !!g(p, 'isWeighed'), barcode: g(p, 'barcode') ?? null,
    carton_barcode: g(p, 'cartonBarcode') ?? null, carton_size: g(p, 'cartonSize'),
    cost_minor: g(p, 'costMinor'), price_minor: g(p, 'priceMinor'),
    tax_category: g(p, 'taxCategory'), min_qty: g(p, 'minQty'), max_qty: g(p, 'maxQty'),
    velocity_class: g(p, 'velocityClass') ?? null, description: g(p, 'description') ?? null,
    active: !!g(p, 'active'), created_at: g(p, 'createdAt'), updated_at: g(p, 'updatedAt'),
    updated_by_device: dev?.value ?? 'unknown',
  });
}

/**
 * Rebuild the `apply_category` payload (LWW fields + this device as editor).
 * op_id = category.id (categories are create-only today — no edit path, so
 * no fresh-op-id/hint variant like product edits need).
 */
export async function buildCategoryPayload(categoryRef: string, payloadHint: string | null, tenantOutletId?: string): Promise<string | null> {
  const db = await getDb();
  void payloadHint; // the stored hint is debug-only; op_id IS the category id
  const c = await db.getFirstAsync<Record<string, unknown> | null>(
    `SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
       FROM category WHERE id = ?`,
    [categoryRef],
  );
  if (!c) return null;
  const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  const dev = await db.getFirstAsync<{ value: string } | null>(
    "SELECT value FROM settings WHERE key = 'device_id'",
  );
  const g = (r: Record<string, unknown>, k: string) => r[k];
  return JSON.stringify({
    id: g(c, 'id'),
    outlet_id: tenantOutletId ?? outlet?.id ?? null,
    name: g(c, 'name'),
    created_at: g(c, 'createdAt') ?? 0,
    updated_at: g(c, 'updatedAt') ?? 0,
    updated_by_device: dev?.value ?? 'unknown',
  });
}

// ---------------- one-time backfill ----------------

/**
 * First-connect backfill: enqueue ops for all pre-M5 data (sales, ledger
 * rows, active products) that has no outbox op yet. Idempotent:
 *  - per-op `op_id` dedup (sale.uuid / ledger.sync_op_id / product.id), and
 *  - a settings flag so the scan runs once.
 * Ledger rows belonging to a SALE are skipped — they ride along in the sale
 * op's payload (double-sending them would be harmless but redundant).
 */
export async function backfillOnce(): Promise<number> {
  const db = await getDb();
  const flag = await db.getFirstAsync<{ value: string } | null>(
    "SELECT value FROM settings WHERE key = 'cloud.backfill_v1'",
  );
  if (flag?.value === '1') return 0;

  let n = 0;
  const sales = await db.getAllAsync<{ uuid: string }>(
    `SELECT s.uuid FROM sale s
      WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'sale' AND o.op_id = s.uuid)`,
  );
  for (const s of sales) {
    await enqueueOpInTx(db, 'sale', s.uuid);
    n += 1;
  }

  const ledgerOps = await db.getAllAsync<{ op: string }>(
    `SELECT l.sync_op_id AS op FROM stock_ledger l
      WHERE l.sync_op_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.op_id = l.sync_op_id)
        AND NOT (l.ref_type = 'sale' AND EXISTS (
              SELECT 1 FROM sale s JOIN outbox os ON os.op_id = s.uuid
              WHERE s.id = l.ref_id AND os.entity = 'sale'))`,
  );
  for (const l of ledgerOps) {
    await enqueueOpInTx(db, 'ledger', l.op);
    n += 1;
  }

  const products = await db.getAllAsync<{ id: string }>(
    `SELECT p.id FROM product p
      WHERE p.active = 1
        AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'product' AND o.op_id = p.id)`,
  );
  for (const p of products) {
    await enqueueOpInTx(db, 'product', p.id);
    n += 1;
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('cloud.backfill_v1', '1')",
  );
  return n;
}

/**
 * Schema-v3 backfill: enqueue `category` ops for every local category that has
 * no outbox op yet. Needed because categories created BEFORE v3 (seed
 * categories, CSV-imported ones) predate the category outbox entity. Idempotent
 * like backfillOnce(): per-op op_id dedup (category.id) + a settings flag.
 */
export async function backfillCategoriesOnce(): Promise<number> {
  const db = await getDb();
  const flag = await db.getFirstAsync<{ value: string } | null>(
    "SELECT value FROM settings WHERE key = 'cloud.backfill_v3'",
  );
  if (flag?.value === '1') return 0;

  let n = 0;
  const cats = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM category c
      WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'category' AND o.op_id = c.id)`,
  );
  for (const c of cats) {
    await enqueueOpInTx(db, 'category', c.id);
    n += 1;
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('cloud.backfill_v3', '1')",
  );
  return n;
}
