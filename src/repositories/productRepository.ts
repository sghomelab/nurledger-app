/**
 * Product repository — local CRUD over the SQLite DB (M1: local-only;
 * outbox sync for master data lands in M5 per build-order).
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../db/database';
import { reorderSuggestion, stockStatus } from '../lib/stock';
import { uuidv4 } from '../lib/ids';
import type {
  Category,
  Product,
  ProductWithStock,
  ReorderCandidate,
  UnitType,
  VelocityClass,
} from '../types';

const PRODUCT_COLS = `
  p.id, p.outlet_id AS outletId, p.sku, p.name, p.category_id AS categoryId,
  p.unit_type AS unitType, p.is_weighed AS isWeighed, p.barcode,
  p.carton_barcode AS cartonBarcode, p.carton_size AS cartonSize,
  p.cost_minor AS costMinor, p.price_minor AS priceMinor,
  p.tax_category AS taxCategory, p.min_qty AS minQty, p.max_qty AS maxQty,
  p.velocity_class AS velocityClass, p.description, p.active,
  p.created_at AS createdAt, p.updated_at AS updatedAt
`;

interface RawProduct extends Omit<Product, 'isWeighed' | 'active'> {
  isWeighed: number;
  active: number;
}

function mapProduct(r: RawProduct): Product {
  return {
    ...r,
    isWeighed: !!r.isWeighed,
    active: !!r.active,
  };
}

/** All active products with projected stock + status, name-asc. */
export async function listProducts(search = ''): Promise<ProductWithStock[]> {
  const db = await getDb();
  const like = search.trim() ? `%${search.trim()}%` : '';
  const rows = await db.getAllAsync<RawProduct & { stockQty: number }>(
    `SELECT ${PRODUCT_COLS},
            COALESCE(sv.qty, 0) AS stockQty
       FROM product p
       LEFT JOIN stock_view sv ON sv.product_id = p.id
      WHERE p.active = 1
        AND (? = '' OR p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
      ORDER BY p.name COLLATE NOCASE`,
    [like, like, like, like],
  );
  return rows.map((r) => ({
    ...mapProduct(r),
    stockQty: r.stockQty,
    status: stockStatus(r.stockQty, r.minQty, true),
  }));
}

/** Low-stock count for the tab badge (prototype: amber badge on Inventory). */
export async function lowStockCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM product p LEFT JOIN stock_view sv ON sv.product_id = p.id
      WHERE p.active = 1 AND COALESCE(sv.qty, 0) <= p.min_qty`,
  );
  return row ? row.n : 0;
}

/**
 * FR-308: products below their reorder point, each with the Min/Max suggested
 * qty (max − on-hand). Feeds the "Restock → Create PO" flow.
 */
export async function reorderCandidates(): Promise<ReorderCandidate[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    sku: string;
    name: string;
    category_id: string | null;
    cost_minor: number;
    price_minor: number;
    min_qty: number;
    max_qty: number;
    velocity_class: string | null;
    stockQty: number;
  }>(
    `SELECT p.id, p.sku, p.name, p.category_id, p.cost_minor, p.price_minor,
            p.min_qty, p.max_qty, p.velocity_class,
            COALESCE(sv.qty, 0) AS stockQty
       FROM product p LEFT JOIN stock_view sv ON sv.product_id = p.id
       WHERE p.active = 1 AND COALESCE(sv.qty, 0) < p.min_qty
       ORDER BY p.name COLLATE NOCASE`,
  );
  return rows.map((r) => ({
    productId: r.id,
    sku: r.sku,
    name: r.name,
    categoryId: r.category_id,
    stockQty: r.stockQty,
    minQty: r.min_qty,
    maxQty: r.max_qty,
    costMinor: r.cost_minor,
    priceMinor: r.price_minor,
    suggestedQty: reorderSuggestion(r.stockQty, r.min_qty, r.max_qty),
    velocityClass: (r.velocity_class as VelocityClass | null) ?? null,
  }));
}

export async function getProduct(id: string): Promise<ProductWithStock | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawProduct & { stockQty: number } | null>(
    `SELECT ${PRODUCT_COLS}, COALESCE(sv.qty, 0) AS stockQty
       FROM product p LEFT JOIN stock_view sv ON sv.product_id = p.id
      WHERE p.id = ?`,
    [id],
  );
  if (!row) return null;
  return { ...mapProduct(row), stockQty: row.stockQty, status: stockStatus(row.stockQty, row.minQty, !!row.active) };
}

export async function findByBarcode(barcode: string): Promise<ProductWithStock | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawProduct & { stockQty: number } | null>(
    `SELECT ${PRODUCT_COLS}, COALESCE(sv.qty, 0) AS stockQty
       FROM product p LEFT JOIN stock_view sv ON sv.product_id = p.id
      WHERE p.active = 1 AND (p.barcode = ? OR p.carton_barcode = ?)`,
    [barcode, barcode],
  );
  if (!row) return null;
  return { ...mapProduct(row), stockQty: row.stockQty, status: stockStatus(row.stockQty, row.minQty, true) };
}

export interface ProductInput {
  name: string;
  sku: string;
  categoryId: string | null;
  unitType: UnitType;
  isWeighed: boolean;
  barcode: string | null;
  cartonBarcode: string | null;
  cartonSize: number;
  costMinor: number;
  priceMinor: number;
  taxCategory: string;
  minQty: number;
  maxQty: number;
  velocityClass: VelocityClass | null;
  description: string | null;
  active: boolean;
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const db = await getDb();
  const id = uuidv4();
  const now = Date.now();
  const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outlet) throw new Error('No outlet found — DB not seeded');
  await db.runAsync(
    `INSERT INTO product
      (id, outlet_id, sku, name, category_id, unit_type, is_weighed, barcode, carton_barcode,
       carton_size, cost_minor, price_minor, tax_category, min_qty, max_qty, velocity_class,
       description, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, outlet.id, input.sku, input.name, input.categoryId, input.unitType,
      input.isWeighed ? 1 : 0, input.barcode, input.cartonBarcode, input.cartonSize,
      input.costMinor, input.priceMinor, input.taxCategory, input.minQty, input.maxQty,
      input.velocityClass, input.description, input.active ? 1 : 0, now, now,
    ],
  );
  const created = await getProduct(id);
  if (!created) throw new Error('Product insert failed');
  return created;
}

export async function updateProduct(id: string, input: ProductInput): Promise<Product> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE product SET
       sku = ?, name = ?, category_id = ?, unit_type = ?, is_weighed = ?,
       barcode = ?, carton_barcode = ?, carton_size = ?, cost_minor = ?,
       price_minor = ?, tax_category = ?, min_qty = ?, max_qty = ?,
       velocity_class = ?, description = ?, active = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.sku, input.name, input.categoryId, input.unitType, input.isWeighed ? 1 : 0,
      input.barcode, input.cartonBarcode, input.cartonSize, input.costMinor,
      input.priceMinor, input.taxCategory, input.minQty, input.maxQty,
      input.velocityClass, input.description, input.active ? 1 : 0, Date.now(), id,
    ],
  );
  const updated = await getProduct(id);
  if (!updated) throw new Error(`Product ${id} not found`);
  return updated;
}

/** Soft delete (products are referenced by ledger rows — never hard-delete). */
export async function deactivateProduct(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE product SET active = 0, updated_at = ? WHERE id = ?', [Date.now(), id]);
}

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; name: string; active: number }>(
    'SELECT id, name, active FROM category ORDER BY name COLLATE NOCASE',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, active: !!r.active }));
}

export async function createCategory(name: string): Promise<Category> {
  const db = await getDb();
  const id = uuidv4();
  await db.runAsync('INSERT INTO category (id, name, active) VALUES (?, ?, 1)', [id, name]);
  return { id, name, active: true };
}

/** Outlet reads/writes live in outletRepository (outlet is its own feature). */
