/**
 * Database bootstrap — expo-sqlite (the Expo equivalent of Drift's role in ADR-001,
 * superseded by ADR-009: Expo SDK 57 stack per owner direction).
 *
 * Every read/write in the app goes through this DB. The network never blocks a sale
 * (offline-first rule 1, spec §4.2).
 */

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { MIGRATE_V1_TO_V2_SQL, MIGRATE_V2_TO_V3_SQL, MIGRATE_V3_TO_V4_SQL, MIGRATE_V4_TO_V5_SQL, MIGRATE_V5_TO_V6_SQL, ENSURE_M4_SQL, ENSURE_M6_SQL, SCHEMA_SQL, SCHEMA_VERSION, OUTBOX_PENDING_INDEX_SQL, STOCK_VIEW_SQL } from './schema';
import { runSeed, isSeeded, ensureDefaultUsers } from './seed';
import { uuidv4 } from '../lib/ids';

const DB_NAME = 'nurledger.db';

let db: SQLiteDatabase | null = null;
let initPromise: Promise<SQLiteDatabase> | null = null;

/** Idempotent bootstrap: open → migrate → seed on first run. */
export async function getDb(): Promise<SQLiteDatabase> {
  if (db) return db;
  if (!initPromise) {
    initPromise = (async () => {
      const database = await openDatabaseAsync(DB_NAME);
      await database.execAsync('PRAGMA foreign_keys = ON;');

      // Meta table must exist before we can read the version (fresh DB = no tables yet).
      await database.execAsync('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);');
      const row = await database.getFirstAsync<{ v: number }>(
        'SELECT v FROM schema_meta WHERE id = 1',
      );
      const current = row ? row.v : 0;

      if (current === 0) {
        await database.withTransactionAsync(async () => {
          await database.execAsync(SCHEMA_SQL);
          await database.runAsync('INSERT OR REPLACE INTO schema_meta (id, v) VALUES (1, ?)', [
            SCHEMA_VERSION,
          ]);
        });
        await database.withTransactionAsync(async () => {
          await runSeed(database);
        });
      } else if (current < SCHEMA_VERSION) {
        // Forward migrations, one step per version bump.
        await database.withTransactionAsync(async () => {
          if (current < 2) {
            await database.execAsync(MIGRATE_V1_TO_V2_SQL); // M2: cart persistence
          }
          if (current < 3) {
            // M3: reason column (ADD COLUMN is not idempotent → guard it).
            if (!(await hasColumn(database, 'stock_ledger', 'reason'))) {
              await database.execAsync(MIGRATE_V2_TO_V3_SQL);
            }
          }
          if (current < 4) {
            await database.execAsync(MIGRATE_V3_TO_V4_SQL); // M4: expense table
            // Existing installs predate the user seed — backfill the default
            // owner/cashier so M4 roles work without a factory reset.
            await ensureDefaultUsers(database);
          }
          if (current < 5) {
            // M5: stock_view +qty_g (weighed, FR-103). The outbox index and the
            // qty_g column ALTERs run in ensureM5() below (every bootstrap) so
            // installs the early broken migration left half-done self-heal.
            await database.execAsync(MIGRATE_V4_TO_V5_SQL);
          }
          if (current < 6) {
            // M6: refund_line (FR-110) + supplier (FR-313) — new tables only.
            // The non-idempotent product.supplier_id ALTER runs in ensureM6()
            // below (every bootstrap) so fresh + upgraded installs converge.
            await database.execAsync(MIGRATE_V5_TO_V6_SQL);
          }
          await database.runAsync('INSERT OR REPLACE INTO schema_meta (id, v) VALUES (1, ?)', [
            SCHEMA_VERSION,
          ]);
        });
      }

      // M4 self-heal: an early M4 build committed v4 without the app_user/expense
      // tables or the default user seed. Re-assert both (idempotent DDL) and the
      // count-guarded user seed on EVERY bootstrap so any such install repairs
      // itself without a factory reset. Cheap: two CREATE TABLE IF NOT EXISTS +
      // one COUNT.
      await database.execAsync(ENSURE_M4_SQL);
      await ensureDefaultUsers(database);

      // M5 self-heal: the early broken v4→v5 migration (a `rowid` index that
      // SQLite rejects) can leave schema_meta at 5 while `current_order_line`
      // lacks `qty_g` — the register then fails with "no such column: qty_g".
      // Re-assert the guarded ALTERs + index on EVERY bootstrap (idempotent).
      await ensureM5(database);

      // M6 self-heal: re-assert the refund_line/supplier tables and the
      // guarded product.supplier_id ALTER on EVERY bootstrap (idempotent).
      await ensureM6(database);

      // FR-200: shift = {device, cashier} pair — stable device identity
      // (created once on first run; persists across restarts).
      const devRow = await database.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'device_id'",
      );
      if (!devRow) {
        await database.runAsync(
          "INSERT INTO settings (key, value) VALUES ('device_id', ?)",
          [uuidv4()],
        );
      }

      db = database;
      return database;
    })().catch((e) => {
      // Don't cache a failed init — a later call should be able to retry.
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

/** Test/diagnostic: seed state without a full open. */
export async function isSeededAsync(): Promise<boolean> {
  const d = await getDb();
  return isSeeded(d);
}

/** Does `table` already have a column named `column`? (SQLite has no ADD COLUMN IF NOT EXISTS.) */
async function hasColumn(db: SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

/**
 * M5 self-heal (every bootstrap). Repairs installs whose early v4→v5
 * migration was interrupted by the rejected `rowid` index (and by the
 * invalid `CREATE OR REPLACE VIEW`): re-asserts the outbox drain index, the
 * `qty_g` columns the register reads (FR-103), and the v5 `stock_view`
 * definition. Every step is idempotent — a PRAGMA guard, IF NOT EXISTS, or a
 * safe DROP+CREATE of a stateless projection — so a healthy DB pays only a
 * few cheap PRAGMAs and two view statements per launch.
 */
async function ensureM5(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(OUTBOX_PENDING_INDEX_SQL);
  if (!(await hasColumn(db, 'current_order_line', 'qty_g'))) {
    await db.execAsync('ALTER TABLE current_order_line ADD COLUMN qty_g INTEGER;');
  }
  if (!(await hasColumn(db, 'sale_line', 'qty_g'))) {
    await db.execAsync('ALTER TABLE sale_line ADD COLUMN qty_g INTEGER;');
  }
  if (!(await hasColumn(db, 'stock_ledger', 'qty_g_delta'))) {
    await db.execAsync('ALTER TABLE stock_ledger ADD COLUMN qty_g_delta INTEGER;');
  }
  // Recreate the projection with the v5 definition. Repairs installs where the
  // early broken migration (CREATE OR REPLACE VIEW — invalid in SQLite) left
  // the OLD m4 view in place (no qty_g column → "no such column: qty_g" from
  // every stock read). Runs AFTER the ALTERs because the view references
  // stock_ledger.qty_g_delta. Cheap: one DROP + one CREATE per launch.
  await db.execAsync(STOCK_VIEW_SQL);
}

/** M6 self-heal: re-assert the new tables + the guarded supplier_id ALTER. */
async function ensureM6(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(ENSURE_M6_SQL);
  if (!(await hasColumn(db, 'product', 'supplier_id'))) {
    await db.execAsync('ALTER TABLE product ADD COLUMN supplier_id TEXT;');
  }
  // Category sync (cloud schema v3): the timestamps are what make categories
  // LWW-syncable. ADD COLUMN is not idempotent → guard; the NULL backfill
  // stamps legacy rows once (idempotent — no NULLs remain afterwards).
  if (!(await hasColumn(db, 'category', 'created_at'))) {
    await db.execAsync('ALTER TABLE category ADD COLUMN created_at INTEGER;');
    await db.execAsync('ALTER TABLE category ADD COLUMN updated_at INTEGER;');
  }
  await db.runAsync(
    `UPDATE category
        SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?)
      WHERE updated_at IS NULL`,
    [Date.now(), Date.now()],
  );
}
