/**
 * @jest-environment node
 *
 * Cloud config on a REAL SQLite engine: the app never persists the
 * service_role key (schema v7) and deletes one left by an older build.
 */
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
let DatabaseSync: any = null;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }
let mockDB: any;
jest.mock('../db/database', () => ({ getDb: async () => mockDB, ensureDeviceId: async () => {} }));
import { SCHEMA_SQL } from '../db/schema';
import { ensureOutlet, ensureDefaultUsers } from '../db/seed';
import { getCloudConfig, saveCloudConfig, disconnectCloud, sdkStorage } from '../repositories/cloudConfigRepository';
import { resetAllData } from '../db/firstRun';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const secureMock = require('expo-secure-store');
import { uuidv4 } from '../lib/ids';

let raw: any;
function mk(path = ':memory:') {
  raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;'); raw.exec(SCHEMA_SQL);
  raw.exec('ALTER TABLE product ADD COLUMN supplier_id TEXT;');
  raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, v INTEGER NOT NULL);');
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
async function addProduct(sku: string, price: number, cost: number, weighed = false, tax = 'standard') {
  const id = uuidv4(); const o = q('select id from outlet')[0].id;
  raw.prepare(`INSERT INTO product (id,outlet_id,sku,name,unit_type,is_weighed,carton_size,cost_minor,price_minor,tax_category,min_qty,max_qty,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,0,0,1,1,1)`)
    .run(id, o, sku, sku, weighed ? 'kg' : 'each', weighed ? 1 : 0, cost, price, tax);
  return id;
}
const line = (productId: string, o: any = {}) => ({ key: uuidv4(), productId, sku: 'x', name: 'x', unitPriceMinor: 1000, qty: 1, qtyG: null, taxCategory: 'standard', discountMinor: 0, cogsMinor: 0, unitCostMinor: null, lotId: null, stockQty: 999, ...o });
const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + r[k], 0);

const d = DatabaseSync ? describe : describe.skip;
beforeEach(async () => {
  secureMock.__reset();
  if (!DatabaseSync) return; mockDB = mk(); await ensureOutlet(mockDB); await ensureDefaultUsers(mockDB); raw.exec("INSERT OR REPLACE INTO settings (key,value) VALUES ('seeded_v1','1')"); });



const setting = (k: string) => q('select value from settings where key=?', k)[0]?.value ?? null;

d('cloud config never holds a service_role key', () => {
  it('saveCloudConfig persists url + anon key + owner + outlet and NO service key', async () => {
    await saveCloudConfig({ url: ' https://x.supabase.co ', anonKey: ' anon ', ownerEmail: 'a@b.co', outletId: 'T1' } as any);
    expect(setting('cloud.url')).toBe('https://x.supabase.co');
    expect(setting('cloud.anon_key')).toBe('anon');
    expect(setting('cloud.service_key')).toBeNull();
    const cfg = await getCloudConfig();
    expect(cfg).toMatchObject({ url: 'https://x.supabase.co', anonKey: 'anon', outletId: 'T1', ownerEmail: 'a@b.co' });
    expect('serviceKey' in (cfg as object)).toBe(false);
  });

  it('a key stored by a pre-v7 build is deleted on first read, and the connection keeps working', async () => {
    raw.exec("INSERT INTO settings (key,value) VALUES ('cloud.url','https://x.supabase.co'),('cloud.anon_key','anon'),('cloud.service_key','SUPER-SECRET'),('cloud.outlet_id','T1')");
    expect(setting('cloud.service_key')).toBe('SUPER-SECRET');
    const cfg = await getCloudConfig();
    expect(cfg).not.toBeNull();
    expect(setting('cloud.service_key')).toBeNull();
    expect(JSON.stringify(q('select * from settings'))).not.toContain('SUPER-SECRET');
  });

  it('a pre-v7 connection WITHOUT the service key row still connects (url + anon key are enough)', async () => {
    raw.exec("INSERT INTO settings (key,value) VALUES ('cloud.url','https://x.supabase.co'),('cloud.anon_key','anon')");
    expect(await getCloudConfig()).not.toBeNull();
  });

  it('disconnect removes everything, including a legacy key', async () => {
    raw.exec("INSERT INTO settings (key,value) VALUES ('cloud.url','u'),('cloud.anon_key','a'),('cloud.service_key','SUPER-SECRET')");
    await disconnectCloud();
    expect(q("select key from settings where key like 'cloud.%'")).toEqual([]);
  });
});

const TOKEN = 'REFRESH-TOKEN-' + 'z'.repeat(2500);

d('Supabase session storage is in the keystore, not SQLite', () => {
  it('setItem puts the session in the keystore and NOTHING sensitive in the settings table', async () => {
    await sdkStorage.setItem('sb-x-auth-token', TOKEN);
    expect(await sdkStorage.getItem('sb-x-auth-token')).toBe(TOKEN);
    expect(JSON.stringify(q('select * from settings'))).not.toContain('REFRESH-TOKEN');
    expect(Object.keys(secureMock.__dump()).some((k) => k.startsWith('nl.sb-x-auth-token'))).toBe(true);
  });

  it('a session left in plaintext sb:* rows by an older build is migrated and the rows are deleted', async () => {
    raw.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('sb:sb-x-auth-token', TOKEN);
    expect(await sdkStorage.getItem('sb-x-auth-token')).toBe(TOKEN);
    expect(q("select * from settings where key like 'sb:%'")).toEqual([]);
    expect(JSON.stringify(q('select * from settings'))).not.toContain('REFRESH-TOKEN');
    expect(await sdkStorage.getItem('sb-x-auth-token')).toBe(TOKEN);
  });

  it('disconnect wipes the keystore session AND any plaintext remnant', async () => {
    await sdkStorage.setItem('sb-x-auth-token', TOKEN);
    raw.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('sb:sb-old-code-verifier', 'v');
    await disconnectCloud();
    expect(await sdkStorage.getItem('sb-x-auth-token')).toBeNull();
    expect(Object.keys(secureMock.__dump())).toEqual([]);
    expect(q("select * from settings where key like 'sb:%'")).toEqual([]);
  });

  it('after migration the old token bytes are gone from the db FILE (free pages + WAL), not just the live rows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-scrub-'));
    const file = path.join(dir, 'app.db');
    try {
      mockDB = mk(file);
      raw.exec('PRAGMA journal_mode = WAL;');
      const BIG = 'tavyxgjrh7fq-' + 'x'.repeat(2000);
      raw.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('sb:sb-x-auth-token', BIG);
      const all = () => ['', '-wal'].map((e) => { try { return fs.readFileSync(file + e).toString('latin1'); } catch { return ''; } }).join('');
      expect(all()).toContain('tavyxgjrh7fq');            // sanity: it really is on disk
      expect(await sdkStorage.getItem('sb-x-auth-token')).toBe(BIG);
      expect(all()).not.toContain('tavyxgjrh7fq');
      raw.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a factory reset (resetAllData) also clears the keystore session', async () => {
    await sdkStorage.setItem('sb-x-auth-token', TOKEN);
    await resetAllData(mockDB);
    expect(Object.keys(secureMock.__dump())).toEqual([]);
  });
});
