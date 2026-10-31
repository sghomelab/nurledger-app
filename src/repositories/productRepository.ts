/**
 * Product repository — local CRUD over the SQLite DB (M1: local-only;
 * outbox sync for master data lands in M5 per build-order).
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../db/database';
import { reorderSuggestion, stockStatus } from '../lib/stock';
import { uuidv4 } from '../lib/ids';
import type { ParsedProductRow } from '../lib/productCsv';
import { enqueueOpInTx } from './outboxRepository';
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
  p.supplier_id AS supplierId,
  p.cost_minor AS costMinor, p.price_minor AS priceMinor,
  p.tax_category AS taxCategory, p.min_qty AS minQty, p.max_qty AS maxQty,
  p.velocity_class AS velocityClass, p.description, p.active,
  p.created_at AS createdAt, p.updated_at AS updatedAt
`;

/**
 * Stock on hand in the product's NATIVE unit (M5, FR-103): base units for
 * each/carton products, GRAMS for weighed products. `stock_view` carries both
 * projections; readers pick by `is_weighed` so every UI surface (chips,
 * oversell guards, reorder math) sees one consistent number.
 */
const STOCK_QTY_SQL = `CASE WHEN p.is_weighed = 1 THEN COALESCE(sv.qty_g, 0) ELSE COALESCE(sv.qty, 0) END`;

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
             ${STOCK_QTY_SQL} AS stockQty
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
      WHERE p.active = 1 AND ${STOCK_QTY_SQL} <= p.min_qty`,
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
            ${STOCK_QTY_SQL} AS stockQty
       FROM product p LEFT JOIN stock_view sv ON sv.product_id = p.id
       WHERE p.active = 1 AND ${STOCK_QTY_SQL} < p.min_qty
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
    `SELECT ${PRODUCT_COLS}, ${STOCK_QTY_SQL} AS stockQty
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
    `SELECT ${PRODUCT_COLS}, ${STOCK_QTY_SQL} AS stockQty
       FROM product p LEFT JOIN stock_view sv ON sv.product_id = p.id
      WHERE p.active = 1 AND (
        p.barcode = ? OR p.carton_barcode = ? OR LOWER(p.sku) = LOWER(?)
        OR p.barcode = '0' || ? OR p.carton_barcode = '0' || ?
      )`,
    [barcode, barcode, barcode, barcode, barcode],
  );
  if (!row) return null;
  return { ...mapProduct(row), stockQty: row.stockQty, status: stockStatus(row.stockQty, row.minQty, true) };
}

/**
 * M5 (FR-104): resolve a weighed product from a scale barcode's item key. The
 * owner stores the scale's 8-digit item prefix on the product's `barcode`;
 * a scanned in-store EAN-13 (`2…` + 5-digit weight) matches by prefix.
 * stockQty is in GRAMS for weighed products (see STOCK_QTY_SQL).
 */
export async function findByWeighedKey(itemKey: string): Promise<ProductWithStock | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawProduct & { stockQty: number } | null>(
    `SELECT ${PRODUCT_COLS}, ${STOCK_QTY_SQL} AS stockQty
       FROM product p LEFT JOIN stock_view sv ON sv.product_id = p.id
      WHERE p.active = 1 AND p.is_weighed = 1
        AND (p.barcode = ? OR p.barcode LIKE ?)
      ORDER BY length(p.barcode) DESC
      LIMIT 1`,
    [itemKey, `${itemKey}%`],
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
  /** FR-313 (M6): linked supplier id (per-supplier SKU link); null = none. */
  supplierId: string | null;
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
       carton_size, supplier_id, cost_minor, price_minor, tax_category, min_qty, max_qty,
       velocity_class, description, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, outlet.id, input.sku, input.name, input.categoryId, input.unitType,
      input.isWeighed ? 1 : 0, input.barcode, input.cartonBarcode, input.cartonSize,
      input.supplierId, input.costMinor, input.priceMinor, input.taxCategory, input.minQty,
      input.maxQty, input.velocityClass, input.description, input.active ? 1 : 0, now, now,
    ],
  );
  // M5 (FR-502): the new product syncs as a product op. op_id = product.id —
  // the same key the one-time backfill uses, so backfill never double-queues it.
  await enqueueOpInTx(db, 'product', id);
  const created = await getProduct(id);
  if (!created) throw new Error('Product insert failed');
  return created;
}

export async function updateProduct(id: string, input: ProductInput): Promise<Product> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE product SET
       sku = ?, name = ?, category_id = ?, unit_type = ?, is_weighed = ?,
       barcode = ?, carton_barcode = ?, carton_size = ?, supplier_id = ?,
       cost_minor = ?, price_minor = ?, tax_category = ?, min_qty = ?, max_qty = ?,
       velocity_class = ?, description = ?, active = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.sku, input.name, input.categoryId, input.unitType, input.isWeighed ? 1 : 0,
      input.barcode, input.cartonBarcode, input.cartonSize, input.supplierId,
      input.costMinor, input.priceMinor, input.taxCategory, input.minQty, input.maxQty,
      input.velocityClass, input.description, input.active ? 1 : 0, Date.now(), id,
    ],
  );
  // M5 (FR-502): each edit is its own op (op_id = fresh client UUID). The
  // payload is reconstructed from the current row at drain time, and the
  // server's LWW (updated_at, device tie-break) makes convergent retries safe.
  // The fresh op id is resolved back to the row via the { productId } hint.
  await enqueueOpInTx(db, 'product', uuidv4(), JSON.stringify({ productId: id }));
  const updated = await getProduct(id);
  if (!updated) throw new Error(`Product ${id} not found`);
  return updated;
}

/**
 * FR-314 (M6): apply parsed CSV rows — upsert by SKU (case-insensitive).
 * Unknown category NAMES are auto-created (the CSV stores names, not ids —
 * ids are per-device). Everything runs in ONE transaction; each created or
 * updated product enqueues its own `product` sync op in the exact shape of
 * createProduct/updateProduct (new id for creates, fresh op id + { productId }
 * hint for updates), so the import syncs like N manual edits.
 */
export interface ProductImportReport {
  created: number;
  updated: number;
  categoriesCreated: string[];
}

export async function importProducts(rows: ParsedProductRow[]): Promise<ProductImportReport> {
  const db = await getDb();
  const report: ProductImportReport = { created: 0, updated: 0, categoriesCreated: [] };
  await db.withTransactionAsync(async () => {
    const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
    if (!outlet) throw new Error('No outlet found — DB not seeded');
    const prods = await db.getAllAsync<{ id: string; skuLc: string }>(
      'SELECT id, lower(sku) AS skuLc FROM product',
    );
    const bySku = new Map(prods.map((p) => [p.skuLc, p.id]));
    const cats = await db.getAllAsync<{ id: string; nameLc: string }>(
      'SELECT id, lower(name) AS nameLc FROM category',
    );
    const catByIdOrName = new Map(cats.map((c) => [c.nameLc, c.id]));

    for (const row of rows) {
      let categoryId: string | null = null;
      if (row.categoryName) {
        const key = row.categoryName.toLowerCase();
        const existing = catByIdOrName.get(key);
        if (existing !== undefined) {
          categoryId = existing;
        } else {
          categoryId = uuidv4();
          catByIdOrName.set(key, categoryId);
          report.categoriesCreated.push(row.categoryName);
          const catNow = Date.now();
          await db.runAsync(
            'INSERT INTO category (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
            [categoryId, row.categoryName, catNow, catNow],
          );
          // M6 (schema v3): the imported category must reach the other
          // devices BEFORE their products reference it (pull order is
          // categories → products; FIFO pushes the category first).
          await enqueueOpInTx(db, 'category', categoryId);
        }
      }
      const now = Date.now();
      const isWeighed = row.unitType === 'kg' ? 1 : 0;
      const existingId = bySku.get(row.sku.toLowerCase());
      if (existingId !== undefined) {
        bySku.delete(row.sku.toLowerCase());
        await db.runAsync(
          `UPDATE product SET
             name = ?, category_id = ?, unit_type = ?, is_weighed = ?,
             barcode = ?, carton_barcode = ?, carton_size = ?,
             cost_minor = ?, price_minor = ?, min_qty = ?, max_qty = ?,
             velocity_class = ?, description = ?, active = ?, updated_at = ?
           WHERE id = ?`,
          [
            row.name, categoryId, row.unitType, isWeighed,
            row.barcode, row.cartonBarcode, row.cartonSize,
            row.costMinor, row.priceMinor, row.minQty, row.maxQty,
            row.velocityClass, row.description, row.active ? 1 : 0, now, existingId,
          ],
        );
        report.updated++;
        await enqueueOpInTx(db, 'product', uuidv4(), JSON.stringify({ productId: existingId }));
      } else {
        const id = uuidv4();
        bySku.set(row.sku.toLowerCase(), id);
        await db.runAsync(
          `INSERT INTO product
             (id, outlet_id, sku, name, category_id, unit_type, is_weighed, barcode, carton_barcode,
              carton_size, supplier_id, cost_minor, price_minor, tax_category, min_qty, max_qty,
              velocity_class, description, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'standard', ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, outlet.id, row.sku, row.name, categoryId, row.unitType, isWeighed,
            row.barcode, row.cartonBarcode, row.cartonSize,
            row.costMinor, row.priceMinor, row.minQty, row.maxQty,
            row.velocityClass, row.description, row.active ? 1 : 0, now, now,
          ],
        );
        report.created++;
        await enqueueOpInTx(db, 'product', id);
      }
    }
  });
  return report;
}

/** Soft delete (products are referenced by ledger rows — never hard-delete). */
export async function deactivateProduct(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE product SET active = 0, updated_at = ? WHERE id = ?', [Date.now(), id]);
  // M5 (FR-502): deactivation syncs too (other devices see the product retire).
  // Fresh op id + { productId } hint (see updateProduct).
  await enqueueOpInTx(db, 'product', uuidv4(), JSON.stringify({ productId: id }));
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
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO category (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [id, name, now, now],
    );
    // M6 (schema v3): categories sync like products — enqueue AT WRITE TIME
    // (op_id = category.id; the server upserts idempotently by id, LWW).
    await enqueueOpInTx(db, 'category', id);
  });
  return { id, name, active: true };
}

/** Outlet reads/writes live in outletRepository (outlet is its own feature). */
