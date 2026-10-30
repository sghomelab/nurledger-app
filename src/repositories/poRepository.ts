/**
 * Purchase-order repository (FR-306, FR-318). Local-only (outbox sync for POs is
 * M5). `receivePO` is the ONLY place a PO turns into stock: inside one
 * transaction it creates one lot + FIFO cost layer per line (via
 * `stockRepository.applyStockMoveInTx`) and appends immutable `receive_po`
 * ledger rows — so receiving a PO always produces correct FEFO batches + stock.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../db/database';
import { poTotalCostMinor } from '../lib/po';
import { uuidv4 } from '../lib/ids';
import { applyStockMoveInTx } from './stockRepository';
import type { POLine, POLineInput, PurchaseOrder } from '../types';

const PO_COLS = `
  id, outlet_id AS outletId, supplier_name AS supplierName, status, terms,
  total_cost_minor AS totalCostMinor, created_at AS createdAt, received_at AS receivedAt
`;

interface RawLine {
  id: string;
  po_id: string;
  product_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost_minor: number;
  lot_code: string | null;
  expiry_date: string | null;
}

function mapLine(r: RawLine): POLine {
  return {
    id: r.id,
    poId: r.po_id,
    productId: r.product_id,
    qtyOrdered: r.qty_ordered,
    qtyReceived: r.qty_received,
    unitCostMinor: r.unit_cost_minor,
    lotCode: r.lot_code,
    expiryDate: r.expiry_date,
  };
}

/** Create a draft PO from its lines (base units). FR-306. */
export async function createPO(
  supplierName: string,
  lines: POLineInput[],
  terms = 'net30',
): Promise<PurchaseOrder> {
  if (lines.length === 0) throw new Error('A purchase order needs at least one line');
  const db = await getDb();
  const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outlet) throw new Error('No outlet found — DB not seeded');
  const poId = uuidv4();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO purchase_order
         (id, outlet_id, supplier_name, status, terms, total_cost_minor, created_at, received_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, NULL)`,
      [poId, outlet.id, supplierName.trim(), terms, poTotalCostMinor(lines), now],
    );
    for (const l of lines) {
      await db.runAsync(
        `INSERT INTO po_line
           (id, po_id, product_id, qty_ordered, qty_received, unit_cost_minor, lot_code, expiry_date)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        [uuidv4(), poId, l.productId, l.qtyOrdered, l.unitCostMinor, l.lotCode, l.expiryDate],
      );
    }
  });
  const created = await getPO(poId);
  if (!created) throw new Error('PO insert failed');
  return created;
}

export async function getPO(id: string): Promise<PurchaseOrder | null> {
  const db = await getDb();
  const po = await db.getFirstAsync<Record<string, unknown> | null>(
    `SELECT ${PO_COLS} FROM purchase_order WHERE id = ?`,
    [id],
  );
  if (!po) return null;
  const rawLines = await db.getAllAsync<RawLine>(
    'SELECT id, po_id, product_id, qty_ordered, qty_received, unit_cost_minor, lot_code, expiry_date FROM po_line WHERE po_id = ? ORDER BY rowid',
    [id],
  );
  return {
    id: po.id as string,
    outletId: po.outletId as string,
    supplierName: po.supplierName as string,
    status: po.status as PurchaseOrder['status'],
    terms: po.terms as string,
    totalCostMinor: po.totalCostMinor as number,
    createdAt: po.createdAt as number,
    receivedAt: (po.receivedAt as number | null) ?? null,
    lines: rawLines.map(mapLine),
  };
}

/** A compact PO row for the PO list (status + how much is received). */
export interface POSummary {
  id: string;
  supplierName: string;
  status: string;
  terms: string;
  totalCostMinor: number;
  createdAt: number;
  receivedAt: number | null;
  lineCount: number;
  orderedQty: number;
  receivedQty: number;
}

export async function listPOs(): Promise<POSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT ${PO_COLS},
            COALESCE(lc.cnt, 0) AS lineCount,
            COALESCE(lc.ordered, 0) AS orderedQty,
            COALESCE(lc.received, 0) AS receivedQty
       FROM purchase_order
       LEFT JOIN (
         SELECT po_id, COUNT(*) AS cnt,
                SUM(qty_ordered) AS ordered, SUM(qty_received) AS received
         FROM po_line GROUP BY po_id
       ) lc ON lc.po_id = purchase_order.id
       ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    supplierName: r.supplierName as string,
    status: r.status as string,
    terms: r.terms as string,
    totalCostMinor: r.totalCostMinor as number,
    createdAt: r.createdAt as number,
    receivedAt: (r.receivedAt as number | null) ?? null,
    lineCount: r.lineCount as number,
    orderedQty: r.orderedQty as number,
    receivedQty: r.receivedQty as number,
  }));
}

/**
 * Receive a PO (FR-306/FR-318): for every not-fully-received line, create a lot
 * (batch) with the line's lot code + expiry and add `qtyOrdered − qtyReceived`
 * base units of stock via the general in-tx stock move (new FIFO cost layer +
 * immutable `receive_po` ledger row, cost layer linked to the lot for FEFO).
 * When every line is received the PO flips to 'received'.
 */
export async function receivePO(id: string): Promise<PurchaseOrder> {
  const db = await getDb();
  const po = await getPO(id);
  if (!po) throw new Error(`PO ${id} not found`);
  if (po.status === 'received' || po.status === 'cancelled') {
    throw new Error(`This PO is already ${po.status}`);
  }

  const now = Date.now();
  await db.withTransactionAsync(async () => {
    const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
    if (!outlet) throw new Error('No outlet — DB not seeded');

    for (const line of po.lines) {
      const remaining = line.qtyOrdered - line.qtyReceived;
      if (remaining <= 0) continue;

      // One lot (batch) per received line, carrying its lot code + expiry.
      const lotId = uuidv4();
      const lotCode = line.lotCode ?? `PO-${id.slice(0, 4).toUpperCase()}`;
      await db.runAsync(
        'INSERT INTO lot (id, product_id, outlet_id, lot_code, expiry_date, received_at) VALUES (?, ?, ?, ?, ?, ?)',
        [lotId, line.productId, outlet.id, lotCode, line.expiryDate, now],
      );

      // Stock-in: FIFO cost layer (linked to the lot) + immutable receive_po ledger row.
      await applyStockMoveInTx(db, {
        productId: line.productId,
        qtyDelta: remaining,
        type: 'receive_po',
        unitCostMinor: line.unitCostMinor,
        lotId,
        refType: 'po',
        refId: id,
        costLayerRef: { type: 'lot', id: lotId },
      });

      await db.runAsync(
        'UPDATE po_line SET qty_received = ? WHERE id = ?',
        [line.qtyOrdered, line.id],
      );
    }

    await db.runAsync(
      "UPDATE purchase_order SET status = 'received', received_at = ? WHERE id = ?",
      [now, id],
    );
  });

  const updated = await getPO(id);
  if (!updated) throw new Error('PO vanished after receive (should be impossible)');
  return updated;
}

export type { SQLiteDatabase };
