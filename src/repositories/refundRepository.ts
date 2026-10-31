/**
 * refundRepository (FR-110, FR-111) — the only module that touches refund SQL.
 *
 * A refund is append-only and references a sale (the sale is never mutated —
 * ADR-002). `createRefund` is ONE atomic transaction:
 *   plan (pure lib/refund) → refund header + lines → per-line restock stock
 *   moves (type='refund', re-entering the FIFO layers at the sale-time cost)
 *   → outbox 'refund' op (op_id = refund uuid; the restock ledger rows ride
 *   along in the op's payload, exactly like the sale path).
 * Fully offline: no network anywhere in this path (FR-111).
 */

import { uuidv4 } from '../lib/ids';
import { planRefund, type RefundLineInput, type RefundReason } from '../lib/refund';
import { getDb } from '../db/database';
import { applyStockMoveInTx } from './stockRepository';
import { enqueueOpInTx } from './outboxRepository';
import { getOpenShift } from './shiftRepository';

/** One sale line as the refund UI + math need it (in stored order). */
export interface RefundableLine {
  saleLineId: string;
  productId: string;
  name: string;
  sku: string;
  /** true for weighed lines (refund in grams, FR-103). */
  isWeighed: boolean;
  qty: number;
  qtyG: number | null;
  unitPriceMinor: number;
  /** Tax-exclude line subtotal. */
  lineTotalMinor: number;
  refundedQty: number;
  refundedQtyG: number | null;
  unitCostMinor: number | null;
}

export interface RefundContext {
  saleId: string;
  saleUuid: string;
  totalMinor: number;
  createdAt: number;
  lines: RefundableLine[];
}

/** Sale header + its lines with already-refunded quantities (null if the sale is fully refunded). */
export async function getRefundContext(saleId: string): Promise<RefundContext | null> {
  const db = await getDb();
  const sale = await db.getFirstAsync<{
    id: string; uuid: string; total_minor: number; created_at: number;
  }>(
    'SELECT id, uuid, total_minor AS total_minor, created_at AS created_at FROM sale WHERE id = ?',
    [saleId],
  );
  if (!sale) return null;

  const rows = await db.getAllAsync<{
    id: string; product_id: string; qty: number; qty_g: number | null;
    unit_price_minor: number; line_total_minor: number; unit_cost_minor: number | null;
    name: string | null; sku: string | null; is_weighed: number;
    refunded_qty: number; refunded_qty_g: number | null;
  }>(
    `SELECT sl.id, sl.product_id, sl.qty, sl.qty_g, sl.unit_price_minor,
            sl.line_total_minor, sl.unit_cost_minor,
            p.name, p.sku, COALESCE(p.is_weighed, 0) AS is_weighed,
            COALESCE((SELECT SUM(CASE WHEN rl.qty_g IS NOT NULL THEN 0 ELSE rl.qty END)
                        FROM refund_line rl WHERE rl.sale_line_id = sl.id), 0) AS refunded_qty,
            (SELECT SUM(rl.qty_g) FROM refund_line rl WHERE rl.sale_line_id = sl.id AND rl.qty_g IS NOT NULL) AS refunded_qty_g
       FROM sale_line sl LEFT JOIN product p ON p.id = sl.product_id
      WHERE sl.sale_id = ?
      ORDER BY sl.rowid`,
    [saleId],
  );

  const lines: RefundableLine[] = rows.map((r) => ({
    saleLineId: r.id,
    productId: r.product_id,
    name: r.name ?? 'Unknown item',
    sku: r.sku ?? '',
    isWeighed: r.is_weighed === 1,
    qty: r.qty,
    qtyG: r.qty_g,
    unitPriceMinor: r.unit_price_minor,
    lineTotalMinor: r.line_total_minor,
    refundedQty: r.refunded_qty,
    refundedQtyG: r.refunded_qty_g,
    unitCostMinor: r.unit_cost_minor,
  }));

  // Nothing left to refund?
  const anythingRefundable = lines.some(
    (l) => (l.isWeighed ? (l.qtyG ?? 0) - (l.refundedQtyG ?? 0) : l.qty - l.refundedQty) > 0,
  );
  if (!anythingRefundable) return null;

  return {
    saleId: sale.id,
    saleUuid: sale.uuid,
    totalMinor: sale.total_minor,
    createdAt: sale.created_at,
    lines,
  };
}

export interface CreateRefundInput {
  saleId: string;
  inputs: RefundLineInput[];
  reasonCode: RefundReason;
  /** The master restock toggle from the screen (header record). */
  masterRestock: boolean;
  /** User who verified the PIN (null = ungated role, e.g. Owner). */
  userId: string | null;
}

/** Create the refund (one atomic tx). Returns the refund id + total. */
export async function createRefund(input: CreateRefundInput): Promise<{ refundId: string; totalMinor: number }> {
  const db = await getDb();
  const box: { refundId?: string; totalMinor?: number } = {};

  await db.withTransactionAsync(async () => {
    const ctx = await getRefundContext(input.saleId);
    if (!ctx) throw new Error('Nothing left to refund on this sale.');

    // Pure plan: validates caps + prices every line (incl. tax share).
    const plan = planRefund(
      ctx.lines.map((l) => ({
        id: l.saleLineId, qty: l.qty, qtyG: l.qtyG, lineTotalMinor: l.lineTotalMinor,
        refundedQty: l.refundedQty, refundedQtyG: l.refundedQtyG, unitCostMinor: l.unitCostMinor,
      })),
      ctx.totalMinor,
      input.inputs,
      input.reasonCode,
    );

    const now = Date.now();
    const refundId = uuidv4();
    const refundUuid = uuidv4();

    // CR-08: stamp the refund with the shift being served, so the drawer math
    // can deduct the cash that leaves THIS drawer. The M6 refund flow is
    // cash-only (money out of the drawer) — payment_method is therefore
    // always 'cash'; the Z-report query filters on it so a future non-cash
    // refund method cannot skew the expected balance. No shift open
    // (register locked) → shift_id stays NULL: the refund affected no drawer.
    // These columns are LOCAL-ONLY — the cloud refund row carries no shift
    // (shifts never sync), and pulled copies insert NULL so another device's
    // refunds can't move this device's drawer.
    const openShift = await getOpenShift();
    const refundShiftId = openShift ? openShift.id : null;

    await db.runAsync(
      `INSERT INTO refund (id, uuid, sale_id, reason_code, restock, amount_minor, pin_verified_by, shift_id, payment_method, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [refundId, refundUuid, input.saleId, input.reasonCode,
       input.masterRestock ? 1 : 0, plan.totalMinor, input.userId, refundShiftId, 'cash', now],
    );

    const lineById = new Map(ctx.lines.map((l) => [l.saleLineId, l]));
    for (const p of plan.lines) {
      const sl = lineById.get(p.input.saleLineId);
      if (!sl) throw new Error(`Sale line ${p.input.saleLineId} vanished`);
      await db.runAsync(
        `INSERT INTO refund_line (id, refund_id, sale_line_id, product_id, qty, qty_g, amount_minor, restock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), refundId, p.input.saleLineId, sl.productId, p.input.qty, p.input.qtyG ?? null,
         p.amountMinor, p.input.restock ? 1 : 0],
      );

      // Restock: re-enter stock (immutable 'refund' ledger row) + FIFO layer
      // at the sale-time cost. Weighed items restock in grams (FR-103).
      if (p.input.restock) {
        await applyStockMoveInTx(db, {
          productId: sl.productId,
          qtyDelta: sl.isWeighed ? 0 : p.input.qty,
          qtyGDelta: sl.isWeighed ? p.input.qtyG ?? 0 : null,
          type: 'refund',
          unitCostMinor: sl.unitCostMinor ?? undefined,
          reason: 'Refund restock',
          refType: 'refund',
          refId: refundId,
        });
      }
    }

    // Outbox (FR-502): the refund is the sync unit; op_id = refund uuid. The
    // restock ledger rows (ref_type='refund', ref_id=refundId) ride along in
    // the op's payload at drain time — exactly like the sale path.
    await enqueueOpInTx(db, 'refund', refundUuid, JSON.stringify({
      refundId, saleId: input.saleId, totalMinor: plan.totalMinor, createdAt: now,
    }));

    box.refundId = refundId;
    box.totalMinor = plan.totalMinor;
  });

  if (!box.refundId) throw new Error('Refund did not complete');
  return { refundId: box.refundId, totalMinor: box.totalMinor! };
}

/** A stored refund with its lines (history + re-print). */
export interface RefundDetail {
  id: string;
  uuid: string;
  saleId: string;
  reasonCode: string;
  restock: boolean;
  amountMinor: number;
  pinVerifiedBy: string | null;
  createdAt: number;
  lines: Array<{ name: string; qty: number; qtyG: number | null; amountMinor: number; restock: boolean }>;
}

export async function getRefund(refundId: string): Promise<RefundDetail | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{
    id: string; uuid: string; sale_id: string; reason_code: string; restock: number;
    amount_minor: number; pin_verified_by: string | null; created_at: number;
  }>(
    `SELECT id, uuid, sale_id, reason_code, restock, amount_minor, pin_verified_by, created_at
       FROM refund WHERE id = ?`,
    [refundId],
  );
  if (!r) return null;
  const lines = await db.getAllAsync<{
    name: string | null; qty: number; qty_g: number | null; amount_minor: number; restock: number;
  }>(
    `SELECT p.name, rl.qty, rl.qty_g, rl.amount_minor, rl.restock
       FROM refund_line rl LEFT JOIN product p ON p.id = rl.product_id
      WHERE rl.refund_id = ? ORDER BY rl.rowid`,
    [refundId],
  );
  return {
    id: r.id, uuid: r.uuid, saleId: r.sale_id, reasonCode: r.reason_code,
    restock: r.restock === 1, amountMinor: r.amount_minor, pinVerifiedBy: r.pin_verified_by,
    createdAt: r.created_at,
    lines: lines.map((l) => ({
      name: l.name ?? 'Unknown item', qty: l.qty, qtyG: l.qty_g,
      amountMinor: l.amount_minor, restock: l.restock === 1,
    })),
  };
}
