/**
 * User repository — progressive-match prefix guard (review H3) on a REAL
 * SQLite engine: a new PIN that EXTENDS an existing user's or the Store PIN's
 * PIN is rejected at creation/change time, so a longer PIN can never be
 * permanently shadowed by the shorter holder at unlock time.
 * @jest-environment node
 */
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
let DatabaseSync: any = null;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }
let mockDB: any;
jest.mock('../db/database', () => ({ getDb: async () => mockDB, ensureDeviceId: async () => {} }));
import { SCHEMA_SQL } from '../db/schema';
import { createUser, setUserPin, getUser } from '../repositories/userRepository';
import { setStorePin } from '../repositories/securityRepository';
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

d('PIN prefix-collision guard (review H3)', () => {
  it('createUser rejects a new PIN that extends an existing user PIN', async () => {
    await createUser({ name: 'Ali', role: 'cashier', pin: '1234' });
    await expect(createUser({ name: 'Bob', role: 'cashier', pin: '123456' }))
      .rejects.toThrow('PIN_PREFIX_COLLISION');
    // Nothing was written for Bob.
    expect(q('select * from app_user where name = ?', 'Bob')).toHaveLength(0);
  });

  it('createUser accepts unrelated PINs (no false positive)', async () => {
    await createUser({ name: 'Ali', role: 'cashier', pin: '1234' });
    const bob = await createUser({ name: 'Bob', role: 'cashier', pin: '4321' });
    expect(bob.pinHash).toMatch(/^s:[0-9a-f]{16}:[0-9a-f]{64}$/);
  });

  it('createUser rejects a PIN that extends the STORE PIN (kept in keystore)', async () => {
    await setStorePin('5678', 'owner1');
    await expect(createUser({ name: 'Bob', role: 'cashier', pin: '567801' }))
      .rejects.toThrow('PIN_PREFIX_COLLISION');
  });

  it('setUserPin SELF-EXCLUSION: a user may extend their OWN current PIN', async () => {
    const ali = await createUser({ name: 'Ali', role: 'cashier', pin: '1234' });
    await setUserPin(ali.id, '123456'); // fine — the old hash is gone
    const updated = await getUser(ali.id);
    expect(updated!.pinHash).not.toBeNull();
  });

  it('setUserPin still rejects extending ANOTHER user\'s PIN', async () => {
    const ali = await createUser({ name: 'Ali', role: 'cashier', pin: '1234' });
    const bob = await createUser({ name: 'Bob', role: 'cashier', pin: '9999' });
    await expect(setUserPin(bob.id, '123456')).rejects.toThrow('PIN_PREFIX_COLLISION');
  });

  it('setUserPin rejects extending the Store PIN', async () => {
    const bob = await createUser({ name: 'Bob', role: 'cashier', pin: '9999' });
    await setStorePin('1234', 'owner1');
    await expect(setUserPin(bob.id, '123456')).rejects.toThrow('PIN_PREFIX_COLLISION');
  });
});
