/**
 * Security repository on a REAL SQLite engine (issue #26 design §2–§5):
 * the insert-only hash-chained audit log + Store PIN / one-time recovery
 * code in the keystore (never in SQLite).
 * @jest-environment node
 */
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
let DatabaseSync: any = null;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }
let mockDB: any;
jest.mock('../db/database', () => ({ getDb: async () => mockDB, ensureDeviceId: async () => {} }));
import { SCHEMA_SQL } from '../db/schema';
import {
  appendSecurityEvent,
  clearStorePin,
  consumeRecoveryCode,
  getStorePinHash,
  hasStorePin,
  listSecurityEvents,
  runIntegrityCheck,
  setStorePin,
  verifySecurityChain,
  verifyStorePin,
} from '../repositories/securityRepository';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const secureMock = require('expo-secure-store');

let raw: any;
function mk() {
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA_SQL);
  let inTx = false;
  return {
    execAsync: async (s: string) => raw.exec(s),
    runAsync: async (s: string, p: any[] = []) => { raw.prepare(s).run(...p); },
    getFirstAsync: async (s: string, p: any[] = []) => raw.prepare(s).get(...p) ?? null,
    getAllAsync: async (s: string, p: any[] = []) => raw.prepare(s).all(...p),
    withTransactionAsync: async (fn: any) => { if (inTx) throw new Error('nested'); inTx = true; raw.exec('BEGIN'); try { await fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } finally { inTx = false; } },
  };
}
const q = (s: string, ...p: any[]) => raw.prepare(s).all(...p);

const d = DatabaseSync ? describe : describe.skip;
beforeEach(() => {
  secureMock.__reset();
  if (!DatabaseSync) return;
  mockDB = mk();
});

d('security_events — insert-only hash chain (design §4)', () => {
  it('appends rows with monotonically increasing seq linked from the genesis hash', async () => {
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_start', method: 'system' });
    await appendSecurityEvent({ user_id: 'u2', event_type: 'user_switch', method: 'pin', from_user_id: 'u1', to_user_id: 'u2' });
    const rows = q('select * from security_events order by seq');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.seq).toBe(1);
    expect(rows[0]!.prev_hash).toBe('0'.repeat(64));
    expect(rows[1]!.seq).toBe(2);
    expect(rows[1]!.prev_hash).toBe(rows[0]!.row_hash);
  });

  it('verifies a clean chain', async () => {
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_start' });
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_end' });
    expect(await verifySecurityChain()).toEqual({ ok: true, firstBadSeq: null, checked: 2 });
  });

  it('detects a tampered old row (direct SQL UPDATE — no app path does this)', async () => {
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_start' });
    await appendSecurityEvent({ user_id: 'u2', event_type: 'shift_end' });
    raw.prepare("UPDATE security_events SET user_id = 'u9' WHERE seq = 1").run();
    const v = await verifySecurityChain();
    expect(v.ok).toBe(false);
    expect(v.firstBadSeq).toBe(1);
  });

  it('detects a deleted middle row', async () => {
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_start' });
    await appendSecurityEvent({ user_id: 'u1', event_type: 'unlock', method: 'pin' });
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_end' });
    raw.prepare('DELETE FROM security_events WHERE seq = 2').run();
    const v = await verifySecurityChain();
    expect(v.ok).toBe(false);
    expect(v.firstBadSeq).toBe(3);
  });

  it('runIntegrityCheck logs itself as an event with the result in detail', async () => {
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_start' });
    const v = await runIntegrityCheck('u1');
    expect(v.ok).toBe(true);
    const last = q('select * from security_events order by seq desc limit 1');
    expect(last[0]!.event_type).toBe('integrity_check');
    expect(last[0]!.user_id).toBe('u1');
    expect(last[0]!.detail).toMatch(/^ok checked=\d+$/);
  });

  it('an integrity check on a tampered log is ITSELF tamper-detectable afterwards', async () => {
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_start' });
    const v1 = await runIntegrityCheck('u1'); // clean: ok
    expect(v1.ok).toBe(true);
    raw.prepare("UPDATE security_events SET user_id = 'u9' WHERE seq = 1").run();
    const v2 = await runIntegrityCheck('u1'); // detects row 1; the FAIL is logged
    expect(v2.ok).toBe(false);
    const last = q('select detail from security_events order by seq desc limit 1');
    expect(last[0]!.detail).toMatch(/^FAIL first_bad_seq=1 checked=\d+$/);
  });

  it('listSecurityEvents returns all rows in ascending order', async () => {
    await appendSecurityEvent({ user_id: 'u1', event_type: 'shift_start' });
    await appendSecurityEvent({ user_id: 'u1', event_type: 'unlock' });
    const rows = await listSecurityEvents();
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('a fresh install has an empty, valid chain', async () => {
    expect(await listSecurityEvents()).toEqual([]);
    expect(await verifySecurityChain()).toEqual({ ok: true, firstBadSeq: null, checked: 0 });
  });
});

d('Store PIN + one-time recovery code (keystore, never SQLite) — design §2/§3', () => {
  it('setStorePin issues a one-time recovery code; the PIN verifies; nothing sensitive lands in SQLite', async () => {
    const { recoveryCode } = await setStorePin('4821', 'owner1');
    expect(recoveryCode).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    expect(await hasStorePin()).toBe(true);
    expect(await getStorePinHash()).toMatch(/^s:[0-9a-f]{16}:[0-9a-f]{64}$/);
    expect(await verifyStorePin('4821')).toBe(true);
    expect(await verifyStorePin('0000')).toBe(false);
    expect(JSON.stringify(q('select * from settings'))).not.toContain('4821');
    expect(JSON.stringify(q('select * from security_events'))).not.toContain('4821');
    expect(Object.keys(secureMock.__dump()).some((k) => k.startsWith('nl.store.'))).toBe(true);
  });

  it('rejects an invalid PIN (no partial state)', async () => {
    await expect(setStorePin('12', 'owner1')).rejects.toThrow();
    expect(await hasStorePin()).toBe(false);
    expect(await getStorePinHash()).toBeNull();
  });

  it('the recovery code is consumed exactly once', async () => {
    const { recoveryCode } = await setStorePin('4821', 'owner1');
    expect(await consumeRecoveryCode(recoveryCode, 'owner1')).toBe(true);
    expect(await consumeRecoveryCode(recoveryCode, 'owner1')).toBe(false); // already consumed
  });

  it('a wrong recovery code changes nothing (the real code stays valid)', async () => {
    const { recoveryCode } = await setStorePin('4821', 'owner1');
    expect(await consumeRecoveryCode('9999-9999-9999', 'owner1')).toBe(false);
    expect(await consumeRecoveryCode(recoveryCode, 'owner1')).toBe(true);
  });

  it('setting a NEW Store PIN invalidates the old recovery code', async () => {
    const first = await setStorePin('4821', 'owner1');
    await setStorePin('9988', 'owner1');
    expect(await verifyStorePin('9988')).toBe(true);
    expect(await verifyStorePin('4821')).toBe(false);
    expect(await consumeRecoveryCode(first.recoveryCode, 'owner1')).toBe(false);
  });

  it('pin_set / recovery_used events are attributed to the acting owner', async () => {
    const { recoveryCode } = await setStorePin('4821', 'owner1');
    await consumeRecoveryCode(recoveryCode, 'owner1');
    const rows = q('select event_type, user_id, method from security_events order by seq');
    expect(rows.map((r: any) => r.event_type)).toEqual(['pin_set', 'recovery_used']);
    rows.forEach((r: any) => expect(r.user_id).toBe('owner1'));
  });

  it('clearStorePin wipes both secrets from the keystore', async () => {
    await setStorePin('4821', 'owner1');
    await clearStorePin();
    expect(await hasStorePin()).toBe(false);
    expect(Object.keys(secureMock.__dump())).toEqual([]);
  });
});
