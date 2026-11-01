/**
 * First-run data:
 * - `ensureOutlet` — the outlet row is REQUIRED infrastructure (every read in
 *   the app resolves currency/locale/tax through it), so it is created at
 *   bootstrap regardless of the owner's first-run choice.
 * - `runSeed` — the FIXTURE inventory: categories + 11 products, each with one
 *   lot and an opening ledger row + FIFO cost layer (so M3 FEFO and M2 margin
 *   work from day one). Guarded by settings.seeded_v1 — runs exactly once per
 *   install, and ONLY when the owner picks "Load sample data" on the
 *   first-run screen (see src/db/firstRun.ts).
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { deterministicId, uuidv4 } from '../lib/ids';
import { createPinHash } from '../lib/pin';
import { SEED_CATEGORIES, SEED_PRODUCTS, SEED_OUTLET } from '../seed/data';

/**
 * Seed id namespace (M5 multi-device convergence). Every device that seeds
 * the same fixture derives the SAME product/lot/ledger UUIDs from the same
 * names — those UUIDs are the sync idempotency keys, so a second device that
 * joins a store already seeded by another device converges 1:1 instead of
 * colliding on the server's UNIQUE (outlet_id, sku). The `v1` lets the id
 * space be re-derived if the fixture ever changes shape. (deterministicId —
 * src/lib/ids.ts — documents why.)
 */
const SEED_NS = 'nurledger:seed:v1:';
const seedCategoryId = (name: string) => deterministicId(`${SEED_NS}category:${name}`);
const seedProductId = (sku: string) => deterministicId(`${SEED_NS}product:${sku}`);
const seedLotId = (sku: string, lotCode: string) => deterministicId(`${SEED_NS}lot:${sku}:${lotCode}`);
const seedLedgerId = (sku: string) => deterministicId(`${SEED_NS}ledger:${sku}`);
const seedLedgerOpId = (sku: string) => deterministicId(`${SEED_NS}ledger-op:${sku}`);
const seedCostLayerId = (sku: string) => deterministicId(`${SEED_NS}cost-layer:${sku}`);

export async function isSeeded(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'seeded_v1'",
  );
  return row !== null;
}

/**
 * Ensure the outlet row exists (the store's identity: name/currency/locale/
 * tax engine). Count-guarded and idempotent — safe on every bootstrap.
 * Uses the SEED_OUTLET defaults as a neutral placeholder: the owner renames
 * the store (and re-points currency/tax) in Settings; both the "sample" and
 * "empty" first-run paths land on the same row.
 */
export async function ensureOutlet(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outlet');
  if (row && row.n > 0) return;
  await db.runAsync(
    'INSERT INTO outlet (id, name, currency, locale, tax_engine, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), SEED_OUTLET.name, SEED_OUTLET.currency, SEED_OUTLET.locale, SEED_OUTLET.taxEngine, Date.now()],
  );
}

export async function runSeed(db: SQLiteDatabase): Promise<void> {
  if (await isSeeded(db)) return;

  // The outlet is guaranteed by ensureOutlet (bootstrap + self-heal); the
  // fixture rows reference it, so resolve the existing id instead of creating
  // a second row. (FKs are ON — a missing outlet would fail the inserts.)
  const outletRow = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outletRow) return;
  const outletId = outletRow.id;
  const now = Date.now();

  const categoryIds = new Map<string, string>();
  for (const cat of SEED_CATEGORIES) {
    const id = seedCategoryId(cat.name);
    categoryIds.set(cat.name, id);
    await db.runAsync(
      'INSERT INTO category (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [id, cat.name, now, now],
    );
  }

  for (const p of SEED_PRODUCTS) {
    const productId = seedProductId(p.sku);
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
    const lotId = seedLotId(p.sku, p.batchNumber);
    await db.runAsync(
      'INSERT INTO lot (id, product_id, outlet_id, lot_code, expiry_date, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      [lotId, productId, outletId, p.batchNumber, p.expiryDate, ts],
    );

    // Opening stock as an immutable ledger row (FR-316) — type receive_po, ref seed.
    // Deterministic row id + sync_op_id: the SAME op on every device, so the
    // server applies the opening stock exactly once (ON CONFLICT DO NOTHING)
    // and both devices' stock projections line up.
    await db.runAsync(
      `INSERT INTO stock_ledger
        (id, outlet_id, product_id, lot_id, type, qty_delta, unit_cost_minor, cogs_minor,
         ref_type, ref_id, sync_op_id, created_at)
       VALUES (?, ?, ?, ?, 'receive_po', ?, ?, NULL, 'seed', 'seed-v1', ?, ?)`,
      [seedLedgerId(p.sku), outletId, productId, lotId, p.stock, p.costMinor, seedLedgerOpId(p.sku), ts],
    );

    // Opening FIFO cost layer at the prototype cost (ADR-003). Linked to the lot
    // (ref_type='lot') so the M3 FEFO Expiry Radar can show per-batch remaining qty.
    await db.runAsync(
      `INSERT INTO cost_layer (id, outlet_id, product_id, unit_cost_minor, qty_remaining, ref_type, ref_id, received_at)
       VALUES (?, ?, ?, ?, ?, 'lot', ?, ?)`,
      [seedCostLayerId(p.sku), outletId, productId, p.costMinor, p.stock, lotId, ts],
    );
  }

  await db.runAsync("INSERT INTO settings (key, value) VALUES ('seeded_v1', '1')");

  // M4: default users (Owner + Cashier) — idempotent, also run by the v3→v4
  // migration for existing installs.
  await ensureDefaultUsers(db);
}

/**
 * M4 (FR-500): seed the default Owner + Cashier when no users exist yet.
 * Idempotent — safe to call on every bootstrap.
 *
 * NOTE: the Owner's default PIN is **1234** — a documented fixture so the PIN
 * gates are testable on a fresh install. There is no change-PIN UI in M4
 * (open item; logged in FR-COVERAGE). The salted hash is computed at seed time
 * (never stored as plaintext — see src/lib/pin.ts threat model).
 */
export async function ensureDefaultUsers(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM app_user');
  if (row && row.n > 0) return;

  const now = Date.now();
  const ownerId = uuidv4();

  await db.runAsync(
    'INSERT INTO app_user (id, name, role, pin_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    [ownerId, 'Owner', 'owner', createPinHash('1234'), now],
  );
  await db.runAsync(
    'INSERT INTO app_user (id, name, role, pin_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    [uuidv4(), 'Jun', 'cashier', null, now],
  );

  // First run defaults to the Owner as the active user (the PIN holder).
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_user_id', ?)", [
    ownerId,
  ]);
}
