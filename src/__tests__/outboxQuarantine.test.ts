/**
 * @jest-environment node
 *
 * Outbox quarantine on a REAL SQLite engine: a record the server keeps
 * REJECTING must not block the FIFO behind it forever — but only a positively
 * identified per-record rejection may ever set an op aside.
 */
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
let DatabaseSync: any = null;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }
let mockDB: any;
jest.mock('../db/database', () => ({ getDb: async () => mockDB, ensureDeviceId: async () => {} }));

// The engine's adapter seam — each test scripts pushOps.
const mockPush = jest.fn();
jest.mock('../lib/cloud/supabaseAdapter', () => ({
  createSupabaseAdapter: () => ({
    pushOps: (...a: any[]) => mockPush(...a),
    pullDeltas: async () => ({
      categories: [], products: [], sales: [], saleLines: [], payments: [], ledger: [], refunds: [], refundLines: [],
      maxSyncedAt: { product: 0, sale: 0, ledger: 0, refund: 0, category: 0 },
    }),
  }),
}));

import { SCHEMA_SQL } from '../db/schema';
import { ensureOutlet, ensureDefaultUsers } from '../db/seed';
import { __syncTickForTests } from '../hooks/useSync';
import { saveCloudConfig, setSyncEnabled, getLastSyncError } from '../repositories/cloudConfigRepository';
import {
  enqueueOp, pendingCount, pendingOps, quarantinedCount, quarantinedOps, retryQuarantined,
  discardQuarantined, unsyncedCount, recordOpRejection,
} from '../repositories/outboxRepository';
import { classifyPushFailure } from '../lib/sync';

let raw: any;
function mk() {
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;'); raw.exec(SCHEMA_SQL);
  raw.exec('ALTER TABLE product ADD COLUMN supplier_id TEXT;');
  raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);');
  return {
    execAsync: async (s: string) => raw.exec(s),
    runAsync: async (s: string, p: any[] = []) => { raw.prepare(s).run(...p); },
    getFirstAsync: async (s: string, p: any[] = []) => raw.prepare(s).get(...p) ?? null,
    getAllAsync: async (s: string, p: any[] = []) => raw.prepare(s).all(...p),
    withTransactionAsync: async (fn: any) => { raw.exec('BEGIN'); try { await fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  };
}
const q = (s: string, ...p: any[]) => raw.prepare(s).all(...p);

const d = DatabaseSync ? describe : describe.skip;

beforeEach(async () => {
  mockPush.mockReset();
  if (!DatabaseSync) return;
  mockDB = mk(); await ensureOutlet(mockDB); await ensureDefaultUsers(mockDB);
  raw.exec("INSERT OR REPLACE INTO settings (key,value) VALUES ('seeded_v1','1'),('cloud.backfill_v1','1'),('cloud.backfill_v3','1'),('cloud.reconcile_layers_v1','1')");
  await saveCloudConfig({ url: 'https://x.supabase.co', anonKey: 'anon', outletId: 'T1' });
  await setSyncEnabled(true);
});

/** Enqueue ops with distinct created_at so FIFO order is explicit. */
async function seedOps(n: number) {
  for (let i = 1; i <= n; i++) {
    await enqueueOp('category', `op${i}`);
    raw.prepare('UPDATE outbox SET created_at = ? WHERE op_id = ?').run(1000 + i, `op${i}`);
    // Source row so the drain can rebuild a payload (category payload needs the row).
    raw.prepare('INSERT INTO category (id, name, active, created_at, updated_at) VALUES (?,?,1,1,1)').run(`op${i}`, `cat${i}`);
  }
}
const rejection = (opId: string, uploaded: string[] = [], code = '23503', message = 'violates foreign key') =>
  Object.assign(new Error(message), { code, failedOpId: opId, uploadedOpIds: uploaded });

describe('classifyPushFailure (pure)', () => {
  it('per-record rejections are "op"', () => {
    expect(classifyPushFailure({ code: '23503' })).toBe('op');
    expect(classifyPushFailure({ code: '23505' })).toBe('op');
    expect(classifyPushFailure({ code: '22P02' })).toBe('op');
    expect(classifyPushFailure({ code: 'P0001', message: 'product id belongs to another outlet' })).toBe('op');
    expect(classifyPushFailure({ status: 409 })).toBe('op');
  });
  it('session / permission / schema problems are "connection" — never blamed on one op', () => {
    expect(classifyPushFailure({ code: 'P0001', message: 'not authenticated' })).toBe('connection');
    expect(classifyPushFailure({ code: 'P0001', message: 'not a member of this outlet' })).toBe('connection');
    expect(classifyPushFailure({ code: '42501' })).toBe('connection');
    expect(classifyPushFailure({ code: 'PGRST202' })).toBe('connection');
    expect(classifyPushFailure({ code: 'PGRST301' })).toBe('connection');
    expect(classifyPushFailure({ status: 401 })).toBe('connection');
    expect(classifyPushFailure({ status: 403 })).toBe('connection');
    expect(classifyPushFailure({ status: 404 })).toBe('connection');
  });
  it('transient / unknown failures are "retry" (incl. statement_timeout and network errors)', () => {
    expect(classifyPushFailure({ code: '57014' })).toBe('retry'); // statement_timeout
    expect(classifyPushFailure({ code: '40P01' })).toBe('retry'); // deadlock
    expect(classifyPushFailure({ status: 503 })).toBe('retry');
    expect(classifyPushFailure({ status: 429 })).toBe('retry');
    expect(classifyPushFailure({ message: 'Network request failed' })).toBe('retry');
    expect(classifyPushFailure({})).toBe('retry');
    expect(classifyPushFailure({ code: 'XX999' })).toBe('retry');
  });
});

d('outbox quarantine (real SQLite)', () => {
  it('recordOpRejection counts, then quarantines on the 3rd rejection; pendingOps skips it', async () => {
    await seedOps(2);
    expect(await recordOpRejection('op1', 'e1')).toEqual({ attempts: 1, quarantined: false });
    expect(await recordOpRejection('op1', 'e2')).toEqual({ attempts: 2, quarantined: false });
    expect((await pendingOps()).map((o) => o.opId)).toEqual(['op1', 'op2']);
    expect(await recordOpRejection('op1', 'e3')).toEqual({ attempts: 3, quarantined: true });
    expect((await pendingOps()).map((o) => o.opId)).toEqual(['op2']);
    expect(await pendingCount()).toBe(1);
    expect(await quarantinedCount()).toBe(1);
    expect(await unsyncedCount()).toBe(2); // a factory reset would lose BOTH
    const [row] = await quarantinedOps();
    expect(row).toMatchObject({ opId: 'op1', entity: 'category', attempts: 3, lastError: 'e3' });
  });

  it('a head-of-line rejected op blocks only for 2 ticks; on the 3rd the ops behind it flow', async () => {
    await seedOps(3);
    // op1 is always rejected; everything else succeeds.
    mockPush.mockImplementation(async (_cfg: any, ops: any[]) => {
      const bad = ops.findIndex((o) => o.opId === 'op1');
      if (bad >= 0) throw rejection('op1', ops.slice(0, bad).map((o) => o.opId));
      return ops.map(() => 'applied');
    });
    await __syncTickForTests();
    expect(await pendingCount()).toBe(3); expect(await quarantinedCount()).toBe(0);
    expect((await getLastSyncError())?.message).toMatch(/foreign key/);
    await __syncTickForTests();
    expect(await quarantinedCount()).toBe(0);
    await __syncTickForTests(); // 3rd rejection → quarantined → rest drains in the same tick
    expect(await quarantinedCount()).toBe(1);
    expect(await pendingCount()).toBe(0);
    expect(q("select op_id from outbox where uploaded_at is not null order by op_id").map((r: any) => r.op_id)).toEqual(['op2', 'op3']);
    expect(q("select op_id from outbox where quarantined_at is not null").map((r: any) => r.op_id)).toEqual(['op1']);
    // source row untouched
    expect(q("select count(*) n from category where id='op1'")[0].n).toBe(1);
  });

  it('ops confirmed BEFORE the failing one in the same batch are marked uploaded', async () => {
    await seedOps(3);
    mockPush.mockImplementation(async (_cfg: any, ops: any[]) => {
      // op1 applied, op2 rejected
      throw rejection('op2', ['op1']);
    });
    await __syncTickForTests();
    expect(q("select uploaded_at is not null u from outbox where op_id='op1'")[0].u).toBe(1);
    expect(q("select attempts a from outbox where op_id='op2'")[0].a).toBe(1);
    expect(q("select attempts a from outbox where op_id='op3'")[0].a).toBe(0);
  });

  it('retryable and connection failures are NEVER pinned on an op', async () => {
    await seedOps(2);
    for (const e of [
      Object.assign(new Error('timeout'), { code: '57014', failedOpId: 'op1', uploadedOpIds: [] }),
      Object.assign(new Error('not authenticated'), { code: 'P0001', failedOpId: 'op1', uploadedOpIds: [] }),
      Object.assign(new Error('JWT expired'), { code: 'PGRST301', failedOpId: 'op1', uploadedOpIds: [] }),
      Object.assign(new Error('boom'), { status: 503, failedOpId: 'op1', uploadedOpIds: [] }),
      Object.assign(new Error('offline'), { failedOpId: 'op1', uploadedOpIds: [] }),
    ]) {
      mockPush.mockRejectedValueOnce(e);
      for (let i = 0; i < 4; i++) { mockPush.mockRejectedValueOnce(e); }
    }
    for (let i = 0; i < 10; i++) await __syncTickForTests();
    expect(await quarantinedCount()).toBe(0);
    expect(q("select attempts a from outbox where op_id='op1'")[0].a).toBe(0);
    expect(await pendingCount()).toBe(2);
  });

  it('a push error without failedOpId (older adapter) keeps the old retry behaviour', async () => {
    await seedOps(1);
    mockPush.mockRejectedValue(Object.assign(new Error('bad'), { code: '23503' }));
    for (let i = 0; i < 5; i++) await __syncTickForTests();
    expect(await quarantinedCount()).toBe(0);
    expect(await pendingCount()).toBe(1);
  });

  it('circuit breaker: a systemic rejection quarantines at most 5 ops, then surfaces an error instead', async () => {
    await seedOps(8);
    mockPush.mockImplementation(async (_cfg: any, ops: any[]) => { throw rejection(ops[0].opId); });
    for (let i = 0; i < 40; i++) await __syncTickForTests();
    expect(await quarantinedCount()).toBe(5);
    expect(await pendingCount()).toBe(3); // the rest stay queued, nothing lost
    expect((await getLastSyncError())?.message).toMatch(/keeps rejecting uploads/);
    // after the owner fixes the cause, Retry puts the 5 back and all 8 drain
    mockPush.mockReset();
    mockPush.mockImplementation(async (_cfg: any, ops: any[]) => ops.map(() => 'applied'));
    await retryQuarantined();
    await __syncTickForTests();
    expect(await pendingCount()).toBe(0);
    expect(await quarantinedCount()).toBe(0);
    expect(q("select count(*) n from outbox where uploaded_at is not null")[0].n).toBe(8);
  });

  it('retryQuarantined restores ORIGINAL FIFO order with fresh attempts; discardQuarantined stops draining but keeps rows', async () => {
    await seedOps(3);
    for (const id of ['op2']) { for (let i = 0; i < 3; i++) await recordOpRejection(id, 'x'); }
    expect((await pendingOps()).map((o) => o.opId)).toEqual(['op1', 'op3']);
    expect(await retryQuarantined()).toBe(1);
    expect((await pendingOps()).map((o) => o.opId)).toEqual(['op1', 'op2', 'op3']);
    expect(q("select attempts a, last_error e from outbox where op_id='op2'")[0]).toEqual({ a: 0, e: null });

    for (let i = 0; i < 3; i++) await recordOpRejection('op2', 'y');
    expect(await discardQuarantined()).toBe(1);
    expect(await quarantinedCount()).toBe(0);
    expect((await pendingOps()).map((o) => o.opId)).toEqual(['op1', 'op3']);
    expect(await unsyncedCount()).toBe(2); // discarded op no longer counted as "will be lost"
    expect(q("select count(*) n from outbox where op_id='op2'")[0].n).toBe(1); // kept for audit
    // retry must not resurrect discarded ops
    expect(await retryQuarantined()).toBe(0);
    expect((await pendingOps()).map((o) => o.opId)).toEqual(['op1', 'op3']);
  });

  it('an already-uploaded op is never touched by a late rejection report', async () => {
    await seedOps(1);
    raw.prepare('UPDATE outbox SET uploaded_at = 5 WHERE op_id = ?').run('op1');
    expect(await recordOpRejection('op1', 'late')).toBeNull();
  });
});
