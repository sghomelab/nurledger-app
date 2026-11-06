/**
 * @jest-environment node
 *
 * v7 → v8: an install whose outbox predates the quarantine columns upgrades in
 * place (existing queued ops intact, counters at their defaults), fresh installs
 * get the columns from SCHEMA_SQL, and re-running bootstrap is idempotent.
 */
let DatabaseSync: any = null;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }
let raw: any;
const adapter = () => ({
  execAsync: async (s: string) => raw.exec(s),
  runAsync: async (s: string, p: any[] = []) => { raw.prepare(s).run(...p); },
  getFirstAsync: async (s: string, p: any[] = []) => raw.prepare(s).get(...p) ?? null,
  getAllAsync: async (s: string, p: any[] = []) => raw.prepare(s).all(...p),
  withTransactionAsync: async (fn: any) => { raw.exec('BEGIN'); try { await fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
});
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => adapter()) }));

import { SCHEMA_SQL, SCHEMA_VERSION } from '../db/schema';

const d = DatabaseSync ? describe : describe.skip;
const cols = () => raw.prepare('PRAGMA table_info(outbox)').all().map((r: any) => r.name);

d('outbox quarantine migration', () => {
  beforeEach(() => { jest.resetModules(); });

  it('upgrades a v7 outbox in place and is idempotent', async () => {
    raw = new DatabaseSync(':memory:');
    // Build a genuine v7 database: strip the v8 columns from the fresh DDL.
    const v7 = SCHEMA_SQL.replace(/,\s*-- v8 quarantine[\s\S]*?discarded_at INTEGER\n\)/, '\n)');
    expect(v7).not.toBe(SCHEMA_SQL);
    raw.exec(v7);
    raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);');
    raw.exec('INSERT INTO schema_meta (id, v) VALUES (1, 7)');
    raw.exec("INSERT INTO outbox (id, op_id, entity, payload, created_at) VALUES ('a','op-a','sale','{}',1),('b','op-b','ledger','{}',2)");
    expect(cols()).not.toContain('quarantined_at');

    const { getDb } = require('../db/database');
    await getDb();
    expect(cols()).toEqual(expect.arrayContaining(['attempts', 'last_error', 'quarantined_at', 'discarded_at']));
    expect(raw.prepare('SELECT v FROM schema_meta WHERE id=1').get().v).toBe(SCHEMA_VERSION);
    expect(raw.prepare('SELECT op_id, attempts, last_error, quarantined_at, discarded_at, uploaded_at FROM outbox ORDER BY created_at').all())
      .toEqual([
        { op_id: 'op-a', attempts: 0, last_error: null, quarantined_at: null, discarded_at: null, uploaded_at: null },
        { op_id: 'op-b', attempts: 0, last_error: null, quarantined_at: null, discarded_at: null, uploaded_at: null },
      ]);

    // second bootstrap (fresh module state) must not re-ALTER / throw
    jest.resetModules();
    await require('../db/database').getDb();
    expect(cols().filter((c: string) => c === 'attempts')).toHaveLength(1);
  });

  it('a fresh install has the columns straight from SCHEMA_SQL', async () => {
    raw = new DatabaseSync(':memory:');
    await require('../db/database').getDb();
    expect(cols()).toEqual(expect.arrayContaining(['attempts', 'last_error', 'quarantined_at', 'discarded_at']));
    expect(raw.prepare('SELECT v FROM schema_meta WHERE id=1').get().v).toBe(SCHEMA_VERSION);
  });
});
