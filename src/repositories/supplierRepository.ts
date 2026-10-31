/**
 * Supplier master repository (FR-313, M6). Local-only reference data.
 *
 * Linkage model:
 *  - `product.supplier_id` — the LIVE per-supplier SKU link (nullable).
 *  - `purchase_order.supplier_name` — a name SNAPSHOT at PO-creation time:
 *    historical documents keep their vendor even if the master is renamed or
 *    deleted later, so suppliers are only ever deleted by UNLINKING products.
 */

import { getDb } from '../db/database';
import { uuidv4 } from '../lib/ids';
import type { Supplier, SupplierWithCounts } from '../types';

interface RawSupplier {
  id: string;
  name: string;
  lead_time_days: number;
  notes: string | null;
  created_at: number;
}

function mapSupplier(r: RawSupplier): Supplier {
  return {
    id: r.id,
    name: r.name,
    leadTimeDays: r.lead_time_days,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export async function listSuppliers(): Promise<SupplierWithCounts[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawSupplier & { productCount: number }>(
    `SELECT s.id, s.name, s.lead_time_days, s.notes, s.created_at,
            (SELECT COUNT(*) FROM product p
              WHERE p.supplier_id = s.id AND p.active = 1) AS productCount
       FROM supplier s
      ORDER BY s.name COLLATE NOCASE`,
  );
  return rows.map((r) => ({ ...mapSupplier(r), productCount: r.productCount }));
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawSupplier | null>(
    `SELECT id, name, lead_time_days, notes, created_at FROM supplier WHERE id = ?`,
    [id],
  );
  return row ? mapSupplier(row) : null;
}

export interface SupplierInput {
  name: string;
  leadTimeDays: number;
  notes: string | null;
}

/** Validate + normalize a supplier form (shared by create and update). */
export function normalizeSupplierInput(input: SupplierInput): { name: string; leadTimeDays: number; notes: string | null } {
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required');
  const leadTimeDays = Number.isFinite(input.leadTimeDays) ? Math.max(0, Math.round(input.leadTimeDays)) : 7;
  const notes = input.notes?.trim() ? input.notes.trim() : null;
  return { name, leadTimeDays, notes };
}

function uniqueConstraintError(e: unknown): e is Error {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const db = await getDb();
  const { name, leadTimeDays, notes } = normalizeSupplierInput(input);
  const id = uuidv4();
  const now = Date.now();
  try {
    await db.runAsync(
      `INSERT INTO supplier (id, name, lead_time_days, notes, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, name, leadTimeDays, notes, now],
    );
  } catch (e) {
    if (uniqueConstraintError(e)) throw new Error(`A supplier named "${name}" already exists`);
    throw e;
  }
  return { id, name, leadTimeDays, notes, createdAt: now };
}

export async function updateSupplier(id: string, input: SupplierInput): Promise<Supplier> {
  const db = await getDb();
  const { name, leadTimeDays, notes } = normalizeSupplierInput(input);
  try {
    await db.runAsync(
      `UPDATE supplier SET name = ?, lead_time_days = ?, notes = ? WHERE id = ?`,
      [name, leadTimeDays, notes, id],
    );
  } catch (e) {
    if (uniqueConstraintError(e)) throw new Error(`A supplier named "${name}" already exists`);
    throw e;
  }
  const updated = await getSupplier(id);
  if (!updated) throw new Error(`Supplier ${id} not found`);
  return updated;
}

/**
 * Delete a supplier. Linked products are UNLINKED (supplier_id = NULL) —
 * products and their history are never touched; POs keep their name snapshot.
 */
export async function deleteSupplier(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE product SET supplier_id = NULL WHERE supplier_id = ?`, [id]);
    await db.runAsync(`DELETE FROM supplier WHERE id = ?`, [id]);
  });
}

/** FR-313 per-supplier SKU link: set (or clear) a product's supplier. */
export async function setProductSupplier(productId: string, supplierId: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE product SET supplier_id = ? WHERE id = ?`, [supplierId, productId]);
}
