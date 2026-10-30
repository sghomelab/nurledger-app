/**
 * Database bootstrap — expo-sqlite (the Expo equivalent of Drift's role in ADR-001,
 * superseded by ADR-009: Expo SDK 57 stack per owner direction).
 *
 * Every read/write in the app goes through this DB. The network never blocks a sale
 * (offline-first rule 1, spec §4.2).
 */

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { MIGRATE_V1_TO_V2_SQL, MIGRATE_V2_TO_V3_SQL, SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { runSeed, isSeeded } from './seed';

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
          await database.runAsync('INSERT OR REPLACE INTO schema_meta (id, v) VALUES (1, ?)', [
            SCHEMA_VERSION,
          ]);
        });
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
