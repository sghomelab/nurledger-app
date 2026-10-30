/**
 * Database bootstrap — expo-sqlite (the Expo equivalent of Drift's role in ADR-001,
 * superseded by ADR-009: Expo SDK 57 stack per owner direction).
 *
 * Every read/write in the app goes through this DB. The network never blocks a sale
 * (offline-first rule 1, spec §4.2).
 */

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
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

      const row = await database.getFirstAsync<{ v: number }>(
        'SELECT v FROM schema_meta WHERE id = 1',
      );
      const current = row ? row.v : 0;

      if (current === 0) {
        await database.withTransactionAsync(async () => {
          await database.execAsync('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);');
          await database.execAsync(SCHEMA_SQL);
          await database.runAsync('INSERT OR REPLACE INTO schema_meta (id, v) VALUES (1, ?)', [
            SCHEMA_VERSION,
          ]);
        });
        await database.withTransactionAsync(async () => {
          await runSeed(database);
        });
      } else if (current < SCHEMA_VERSION) {
        // Future migrations land here (one step per version bump).
        throw new Error(`Nurledger: schema migration ${current} → ${SCHEMA_VERSION} not implemented`);
      }

      db = database;
      return database;
    })();
  }
  return initPromise;
}

/** Test/diagnostic: seed state without a full open. */
export async function isSeededAsync(): Promise<boolean> {
  const d = await getDb();
  return isSeeded(d);
}
