/**
 * @jest-environment node
 *
 * First-run / reset against a REAL SQLite engine (node:sqlite) — the mock-based
 * firstRun.test.ts cannot catch atomicity or FK/ schema_meta regressions.
 * Skipped automatically when node:sqlite is unavailable (Node < 22.5).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_SQL } from '../db/schema';
import { ensureOutlet, ensureDefaultUsers, isSeeded } from '../db/seed';
import { completeFirstRun, resetAllData } from '../db/firstRun';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
// resetAllData → ensureDeviceId lives in database.ts (pulls in expo-sqlite
// open); stub it with the same settings write against the injected db.
jest.mock('../db/database', () => ({
  ensureDeviceId: async (db: { runAsync: (s: string, p?: unknown[]) => Promise<void> }) => {
    await db.runAsync("INSERT OR IGNORE INTO settings (key, value) VALUES ('device_id', 'dev-test')");
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseSync: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}
const d = DatabaseSync ? describe : describe.skip;

function mk() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA_SQL);
  raw.exec('ALTER TABLE product ADD COLUMN supplier_id TEXT;'); // ensureM6 equivalent
  // schema_meta is created by database.ts bootstrap, not SCHEMA_SQL.
  raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);');
  raw.exec('INSERT OR REPLACE INTO schema_meta (id, v) VALUES (1, 6);');
  let inTx = false;
  const db = {
    execAsync: async (s: string) => raw.exec(s),
    runAsync: async (s: string, p: unknown[] = []) => {
      raw.prepare(s).run(...p);
    },
    getFirstAsync: async (s: string, p: unknown[] = []) => raw.prepare(s).get(...p) ?? null,
    getAllAsync: async (s: string, p: unknown[] = []) => raw.prepare(s).all(...p),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      if (inTx) throw new Error('nested transaction');
      inTx = true;
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        inTx = false;
      }
    },
  };
  return { db: db as unknown as SQLiteDatabase, raw };
}

const count = (raw: { prepare: (s: string) => { get: () => unknown } }, t: string) =>
  (raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

d('first run on real SQLite', () => {
  it('sample load is atomic: a mid-seed failure leaves no fixture and no flag, and a retry works', async () => {
    const { db, raw } = mk();
    await ensureOutlet(db);
    await ensureDefaultUsers(db);
    // Make the seed fail part-way: reject any lot insert.
    raw.exec("CREATE TRIGGER boom BEFORE INSERT ON lot BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    await expect(completeFirstRun(db, 'sample')).rejects.toThrow('boom');
    expect(await isSeeded(db)).toBe(false);
    expect(count(raw, 'product')).toBe(0);
    expect(count(raw, 'category')).toBe(0);
    raw.exec('DROP TRIGGER boom');
    await completeFirstRun(db, 'sample');
    expect(await isSeeded(db)).toBe(true);
    expect(count(raw, 'product')).toBeGreaterThan(0);
  });

  it("'empty' records the decision and loads no fixture", async () => {
    const { db, raw } = mk();
    await ensureOutlet(db);
    await completeFirstRun(db, 'empty');
    expect(await isSeeded(db)).toBe(true);
    expect(count(raw, 'product')).toBe(0);
    expect(count(raw, 'app_user')).toBeGreaterThan(0);
  });

  it('resetAllData keeps schema_meta, wipes the rest, re-arms first run, FKs back ON', async () => {
    const { db, raw } = mk();
    await ensureOutlet(db);
    await completeFirstRun(db, 'sample');
    const before = raw.prepare('SELECT id, v FROM schema_meta ORDER BY id').all();
    expect(before.length).toBeGreaterThan(0);
    await resetAllData(db);
    expect(raw.prepare('SELECT id, v FROM schema_meta ORDER BY id').all()).toEqual(before);
    expect(count(raw, 'product')).toBe(0);
    expect(count(raw, 'sale')).toBe(0);
    expect(await isSeeded(db)).toBe(false);
    expect(count(raw, 'outlet')).toBe(1);
    expect((raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    // and a second first run works after reset
    await completeFirstRun(db, 'sample');
    expect(count(raw, 'product')).toBeGreaterThan(0);
  });
});
