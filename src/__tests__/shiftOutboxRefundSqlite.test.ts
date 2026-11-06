/**
 * @jest-environment node
 *
 * The shifts / outbox / refund fixes, exercised against a REAL SQLite engine
 * (node:sqlite) — the mock-based suites cannot prove SQL-level atomicity
 * (guarded INSERT/UPDATE), or the difference between rowid and created_at
 * ordering. Skipped automatically when node:sqlite is unavailable (Node < 22.5).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_SQL } from '../db/schema';
import { openShift, closeShift } from '../repositories/shiftRepository';
import { createRefund } from '../repositories/refundRepository';
import { pendingOps } from '../repositories/outboxRepository';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

// The repositories resolve their connection via getDb() — point it at the
// per-test in-memory database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDb: any;
jest.mock('../db/database', () => ({
  getDb: async () => {
    if (!mockDb) throw new Error('test must install a db first');
    return mockDb;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mk(): any {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA_SQL);
  const db = {
    execAsync: async (s: string) => raw.exec(s),
    // Must return the run result: closeShift asserts on `changes`.
    runAsync: async (s: string, p: unknown[] = []) => raw.prepare(s).run(...p),
    getFirstAsync: async (s: string, p: unknown[] = []) => raw.prepare(s).get(...p) ?? null,
    getAllAsync: async (s: string, p: unknown[] = []) => raw.prepare(s).all(...p),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  mockDb = db as unknown as SQLiteDatabase;
  return raw;
}

const seedOutlet = (raw: { exec: (s: string) => unknown }) =>
  raw.exec(`INSERT INTO outlet (id, name, currency, locale, tax_engine, created_at)
            VALUES ('o1', 'Test Store', 'MYR', 'en', 'flat', 0)`);

/** One 2-unit sale on product p1, tendered per the given [method, minor] rows. */
function seedSale(raw: { exec: (s: string) => unknown; prepare: (s: string) => { run: (...p: unknown[]) => unknown } }, payments: Array<[string, number]>): void {
  raw.exec(`
    INSERT INTO product (id, outlet_id, sku, name, price_minor, cost_minor, created_at, updated_at)
      VALUES ('p1', 'o1', 'SKU-1', 'Item', 500, 300, 1000, 1000);
    INSERT INTO sale (id, uuid, outlet_id, subtotal_minor, total_minor, created_at)
      VALUES ('s1', 'sale-uuid-1', 'o1', 1000, 1000, 1000);
    INSERT INTO sale_line (id, sale_id, product_id, qty, unit_price_minor, line_total_minor, unit_cost_minor, created_at)
      VALUES ('sl1', 's1', 'p1', 2, 500, 1000, 300, 1000);
  `);
  payments.forEach(([method, amount], i) => {
    raw.prepare('INSERT INTO payment (id, sale_id, method, amount_minor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`pay-${i}`, 's1', method, amount, 1000);
  });
}

const shiftRow = (raw: { prepare: (s: string) => { get: (...p: unknown[]) => Record<string, unknown> | undefined } }, id: string) =>
  raw.prepare('SELECT * FROM shift WHERE id = ?').get(id) as Record<string, unknown> | undefined;

const openInput = { outletId: 'o1', deviceId: 'dev-1', cashierId: null, floatMinor: 1000 };

const countShifts = (raw: { prepare: (s: string) => { get: () => { n: number } } }) =>
  (raw.prepare('SELECT COUNT(*) AS n FROM shift').get() as { n: number }).n;

const countOpenShifts = (raw: { prepare: (s: string) => { get: () => { n: number } } }) =>
  (raw.prepare('SELECT COUNT(*) AS n FROM shift WHERE closed_at IS NULL').get() as { n: number }).n;

d('openShift is atomic (guarded INSERT)', () => {
  it('two racing opens -> exactly one open shift; the second errors', async () => {
    const raw = mk();
    seedOutlet(raw);
    const results = await Promise.allSettled([
      openShift(openInput),
      openShift({ ...openInput, deviceId: 'dev-2' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const err = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(err).toHaveLength(1);
    expect((err[0] as PromiseRejectedResult).reason as Error).toHaveProperty(
      'message', expect.stringMatching(/already open/),
    );
    expect(countShifts(raw)).toBe(1);
    expect(countOpenShifts(raw)).toBe(1);
  });

  it('opens again after the shift is closed', async () => {
    const raw = mk();
    seedOutlet(raw);
    const s1 = await openShift(openInput);
    await closeShift({ shiftId: s1.id, countedMinor: 1000, notes: null });
    const s2 = await openShift(openInput);
    expect(s2.id).not.toBe(s1.id);
    expect(countShifts(raw)).toBe(2);
    expect(countOpenShifts(raw)).toBe(1);
  });
});

d('closeShift is atomic + validated', () => {
  it('stores the Z report and closes the shift', async () => {
    const raw = mk();
    seedOutlet(raw);
    const s = await openShift(openInput);
    const done = await closeShift({ shiftId: s.id, countedMinor: 1234, notes: 'eod' });
    expect(done.closedAt).not.toBeNull();
    const row = shiftRow(raw, s.id)!;
    expect(row.counted_minor).toBe(1234);
    expect(row.notes).toBe('eod');
    expect(row.z_report_json).toBeTruthy();
    // float 1000, no sales/moves/refunds -> expected = 1000, variance = 234
    expect(row.expected_minor).toBe(1000);
    expect(row.variance_minor).toBe(234);
  });

  it('a second close of the same shift errors', async () => {
    const raw = mk();
    seedOutlet(raw);
    const s = await openShift(openInput);
    await closeShift({ shiftId: s.id, countedMinor: 1000, notes: null });
    await expect(closeShift({ shiftId: s.id, countedMinor: 9999, notes: null }))
      .rejects.toThrow('Shift is already closed');
    // the original Z report is untouched
    expect(shiftRow(raw, s.id)!.counted_minor).toBe(1000);
  });

  it('concurrent double-close -> exactly one winner, its values stored', async () => {
    const raw = mk();
    seedOutlet(raw);
    const s = await openShift(openInput);
    const results = await Promise.allSettled([
      closeShift({ shiftId: s.id, countedMinor: 1111, notes: null }),
      closeShift({ shiftId: s.id, countedMinor: 2222, notes: null }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const err = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(err).toHaveLength(1);
    expect((err[0] as PromiseRejectedResult).reason as Error).toHaveProperty(
      'message', expect.stringMatching(/already closed/),
    );
    const row = shiftRow(raw, s.id)!;
    // whoever won, THEIR counted value is the one stored — never a mix
    expect([1111, 2222]).toContain(row.counted_minor);
  });

  it('rejects a negative counted cash', async () => {
    const raw = mk();
    seedOutlet(raw);
    const s = await openShift(openInput);
    await expect(closeShift({ shiftId: s.id, countedMinor: -1, notes: null }))
      .rejects.toThrow('Counted cash must be zero or a positive number');
    expect(shiftRow(raw, s.id)!.closed_at).toBeNull();
  });

  it('rejects a NaN counted cash (no NULL poisoned into the Z report)', async () => {
    const raw = mk();
    seedOutlet(raw);
    const s = await openShift(openInput);
    await expect(closeShift({ shiftId: s.id, countedMinor: Number.NaN, notes: null }))
      .rejects.toThrow('Counted cash must be zero or a positive number');
    expect(shiftRow(raw, s.id)!.closed_at).toBeNull();
  });
});

d('refund payment_method = the sale\'s largest tender', () => {
  const refundInput = (saleId: string) => ({
    saleId,
    inputs: [{ saleLineId: 'sl1', qty: 2, qtyG: null, restock: true }],
    reasonCode: 'customer_return' as const,
    masterRestock: true,
    userId: null,
  });
  const storedMethod = (raw: { prepare: (s: string) => { get: () => { payment_method: string } } }) =>
    (raw.prepare('SELECT payment_method FROM refund LIMIT 1').get() as { payment_method: string }).payment_method;

  it('card-majority tender refunds as card', async () => {
    const raw = mk();
    seedOutlet(raw);
    seedSale(raw, [['card', 600], ['cash', 400]]);
    await createRefund(refundInput('s1'));
    expect(storedMethod(raw)).toBe('card');
  });

  it('cash-majority tender refunds as cash', async () => {
    const raw = mk();
    seedOutlet(raw);
    seedSale(raw, [['cash', 600], ['card', 400]]);
    await createRefund(refundInput('s1'));
    expect(storedMethod(raw)).toBe('cash');
  });

  it('single tender refunds as that method (qr)', async () => {
    const raw = mk();
    seedOutlet(raw);
    seedSale(raw, [['qr', 1000]]);
    await createRefund(refundInput('s1'));
    expect(storedMethod(raw)).toBe('qr');
  });
});

d('pendingOps is strictly rowid FIFO (clock-proof)', () => {
  it('returns insertion order even when created_at is out of order', async () => {
    const raw = mk();
    seedOutlet(raw);
    // Insert A with a LATER timestamp, then B with an EARLIER one (clock
    // drift / same-millisecond stamps are the real-world cause).
    raw.prepare('INSERT INTO outbox (id, op_id, entity, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('ob1', 'op-A', 'sale', '{}', 5000);
    raw.prepare('INSERT INTO outbox (id, op_id, entity, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('ob2', 'op-B', 'refund', '{}', 1000);
    raw.prepare('INSERT INTO outbox (id, op_id, entity, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('ob3', 'op-C', 'sale', '{}', 3000);
    const ops = await pendingOps(10);
    expect(ops.map((o) => o.opId)).toEqual(['op-A', 'op-B', 'op-C']);
  });
});
