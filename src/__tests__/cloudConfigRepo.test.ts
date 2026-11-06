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
import { getCloudConfig, saveCloudConfig, disconnectCloud } from '../repositories/cloudConfigRepository';
import { uuidv4 } from '../lib/ids';

let raw: any;
function mk() {
  raw = new DatabaseSync(':memory:');
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
