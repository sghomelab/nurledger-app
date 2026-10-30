/**
 * First-run seed: outlet + categories + 11 products, each with one lot and an
 * opening ledger row + FIFO cost layer (so M3 FEFO and M2 margin work from day one).
 * Guarded by settings.seeded_v1 — runs exactly once per install.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { uuidv4 } from '../lib/ids';
import { SEED_CATEGORIES, SEED_PRODUCTS, SEED_OUTLET } from '../seed/data';

export async function isSeeded(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'seeded_v1'",
  );
  return row !== null;
}

export async function runSeed(db: SQLiteDatabase): Promise<void> {
  if (await isSeeded(db)) return;

  const outletId = uuidv4();
  const now = Date.now();

  await db.runAsync(
    'INSERT INTO outlet (id, name, currency, locale, tax_engine, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [outletId, SEED_OUTLET.name, SEED_OUTLET.currency, SEED_OUTLET.locale, SEED_OUTLET.taxEngine, now],
  );

  const categoryIds = new Map<string, string>();
  for (const cat of SEED_CATEGORIES) {
    const id = uuidv4();
    categoryIds.set(cat.name, id);
    await db.runAsync('INSERT INTO category (id, name, active) VALUES (?, ?, 1)', [id, cat.name]);
  }

  for (const p of SEED_PRODUCTS) {
    const productId = uuidv4();
    const categoryId = categoryIds.get(p.category) ?? null;
    const ts = Date.parse(p.updatedAt);

    await db.runAsync(
      `INSERT INTO product
        (id, outlet_id, sku, name, category_id, unit_type, is_weighed, barcode, carton_barcode,
         carton_size, cost_minor, price_minor, tax_category, min_qty, max_qty, velocity_class,
         description, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'each', 0, ?, NULL, 1, ?, ?, 'standard', ?, ?, ?, ?, 1, ?, ?)`,
      [
        productId, outletId, p.sku, p.name, categoryId, p.barcode,
        p.costMinor, p.priceMinor, p.reorderPoint, p.maxQty, p.velocityClass,
        p.description, ts, ts,
      ],
    );

    // One opening lot per product (batch + expiry from prototype)
    const lotId = uuidv4();
    await db.runAsync(
      'INSERT INTO lot (id, product_id, outlet_id, lot_code, expiry_date, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      [lotId, productId, outletId, p.batchNumber, p.expiryDate, ts],
    );

    // Opening stock as an immutable ledger row (FR-316) — type receive_po, ref seed
    await db.runAsync(
      `INSERT INTO stock_ledger
        (id, outlet_id, product_id, lot_id, type, qty_delta, unit_cost_minor, cogs_minor,
         ref_type, ref_id, sync_op_id, created_at)
       VALUES (?, ?, ?, ?, 'receive_po', ?, ?, NULL, 'seed', 'seed-v1', ?, ?)`,
      [uuidv4(), outletId, productId, lotId, p.stock, p.costMinor, uuidv4(), ts],
    );

    // Opening FIFO cost layer at the prototype cost (ADR-003)
    await db.runAsync(
      `INSERT INTO cost_layer (id, outlet_id, product_id, unit_cost_minor, qty_remaining, ref_type, ref_id, received_at)
       VALUES (?, ?, ?, ?, ?, 'seed', 'seed-v1', ?)`,
      [uuidv4(), outletId, productId, p.costMinor, p.stock, ts],
    );
  }

  await db.runAsync("INSERT INTO settings (key, value) VALUES ('seeded_v1', '1')");
}
