/**
 * @jest-environment node
 *
 * Multi-device stock + domain-boundary validation on a REAL SQLite engine
 * (node:sqlite). Skipped automatically when it is unavailable (Node < 22.5).
 *   - pulled peer ledger rows must mirror onto FIFO cost layers (a peer's
 *     receipt must be sellable here; a peer's sale must not be re-sellable);
 *   - replays / own echoes are no-ops; weighed rows never create layers;
 *   - one-time reconcile repairs pre-fix drift;
 *   - completeSale rejects negative / fractional / zero qty and negative price;
 *   - a 100%-discounted sale can still be refunded + restocked.
 */
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
let DatabaseSync: any = null;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }
let mockDB: any;
jest.mock('../db/database', () => ({ getDb: async () => mockDB, ensureDeviceId: async () => {} }));
import { SCHEMA_SQL } from '../db/schema';
import { ensureOutlet, ensureDefaultUsers } from '../db/seed';
import { completeSale } from '../repositories/saleRepository';
import { createRefund, getRefundContext } from '../repositories/refundRepository';
import { applyStockMove, stockOf, applyRemoteLedgerRowInTx, reconcileCostLayersOnce, type RemoteLedgerRow } from '../repositories/stockRepository';
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


const layerSum = (p: string) => sum(q('select qty_remaining from cost_layer where product_id=?', p), 'qty_remaining');
const remote = (o: Partial<RemoteLedgerRow> & { rowId: string; productId: string }): RemoteLedgerRow => ({
  opId: 'op-' + o.rowId, lotId: null, type: 'receive', qtyDelta: null, qtyGDelta: null, unitCostMinor: 400, cogsMinor: null,
  refType: 'po', refId: 'x', reason: null, deviceId: 'dev2', createdAt: Date.now(), ...o,
});
const outletId = () => q('select id from outlet')[0].id;
const SALE = { orderDiscountMinor: 0, taxEngineId: 'flat:x-1-inclusive' };
const cash = (n: number) => [{ method: 'cash', amountMinor: n } as any];

d('multi-device stock on real SQLite', () => {
  it("a peer's receipt (pulled) is sellable here — ledger and layers agree", async () => {
    const A = await addProduct('R1', 1000, 400);
    expect(await applyRemoteLedgerRowInTx(mockDB, outletId(), remote({ rowId: 'r1', productId: A, qtyDelta: 10 }))).toBe(true);
    expect(await stockOf(A)).toBe(10); expect(layerSum(A)).toBe(10);
    const r = await completeSale({ lines: [line(A, { qty: 4, stockQty: 10 })], payments: cash(4000), ...SALE });
    expect(r.sale.cogsMinor).toBe(4 * 400);
    expect(await stockOf(A)).toBe(6); expect(layerSum(A)).toBe(6);
  });

  it("a peer's sale (pulled) cannot be re-sold by a stale cart", async () => {
    const A = await addProduct('R2', 1000, 400);
    await applyStockMove({ productId: A, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
    await applyRemoteLedgerRowInTx(mockDB, outletId(), remote({ rowId: 's1', productId: A, type: 'sale', qtyDelta: -8, cogsMinor: 3200, refType: 'sale', refId: 's' }));
    expect(await stockOf(A)).toBe(2); expect(layerSum(A)).toBe(2);
    await expect(completeSale({ lines: [line(A, { qty: 5, stockQty: 10 })], payments: cash(5000), ...SALE })).rejects.toThrow(/Insufficient stock/);
    expect(await stockOf(A)).toBe(2);
  });

  it('replays and own echoes are no-ops; a peer sale beyond local layers depletes to 0, never negative', async () => {
    const A = await addProduct('R3', 1000, 400);
    await applyStockMove({ productId: A, qtyDelta: 3, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
    const row = remote({ rowId: 's2', productId: A, type: 'sale', qtyDelta: -5, refType: 'sale', refId: 's' });
    expect(await applyRemoteLedgerRowInTx(mockDB, outletId(), row)).toBe(true);
    expect(await applyRemoteLedgerRowInTx(mockDB, outletId(), row)).toBe(false); // replay
    expect(layerSum(A)).toBe(0);
    expect(q('select min(qty_remaining) m from cost_layer where product_id=?', A)[0].m).toBe(0);
    // own echo: a row this device already wrote comes back from the server
    const own = q('select id, sync_op_id from stock_ledger where product_id=? and type=?', A, 'receive')[0];
    expect(await applyRemoteLedgerRowInTx(mockDB, outletId(), remote({ rowId: own.id, opId: own.sync_op_id, productId: A, qtyDelta: 3 }))).toBe(false);
    expect(q('select count(*) n from cost_layer where product_id=?', A)[0].n).toBe(1);
  });

  it('weighed rows never create layers', async () => {
    const W = await addProduct('RW', 2000, 1200, true);
    await applyRemoteLedgerRowInTx(mockDB, outletId(), remote({ rowId: 'w1', productId: W, qtyDelta: 0, qtyGDelta: 1500 }));
    expect(q('select count(*) n from cost_layer where product_id=?', W)[0].n).toBe(0);
    expect(q('select coalesce(sum(qty_g_delta),0) g from stock_ledger where product_id=?', W)[0].g).toBe(1500);
  });

  it('reconcileCostLayersOnce repairs pre-fix drift in both directions, once', async () => {
    const A = await addProduct('D1', 1000, 400); const B = await addProduct('D2', 1000, 400);
    const o = outletId();
    // drift as the OLD pull wrote it: ledger rows with no layer effect
    raw.prepare(`INSERT INTO stock_ledger (id,outlet_id,product_id,type,qty_delta,unit_cost_minor,ref_type,ref_id,device_id,sync_op_id,created_at) VALUES ('d1',?,?,'receive',7,450,'po','x','dev2','od1',1)`).run(o, A);
    await applyStockMove({ productId: B, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
    raw.prepare(`INSERT INTO stock_ledger (id,outlet_id,product_id,type,qty_delta,unit_cost_minor,ref_type,ref_id,device_id,sync_op_id,created_at) VALUES ('d2',?,?,'sale',-6,400,'sale','s','dev2','od2',2)`).run(o, B);
    expect(await reconcileCostLayersOnce()).toBe(2);
    expect(layerSum(A)).toBe(7); expect(layerSum(B)).toBe(4);
    expect(q('select unit_cost_minor c from cost_layer where product_id=?', A)[0].c).toBe(450);
    expect(await reconcileCostLayersOnce()).toBe(0);
  });
});

d('completeSale domain-boundary validation', () => {
  const bad: Array<[string, (A: string, B: string) => any[]]> = [
    ['negative qty', (A, B) => [line(A, { qty: -5, stockQty: 10 }), line(B, { qty: 3, stockQty: 10 })]],
    ['fractional qty', (A) => [line(A, { qty: 2.5, stockQty: 10 })]],
    ['zero qty', (A) => [line(A, { qty: 0, stockQty: 10 })]],
    ['negative unit price', (A, B) => [line(A, { unitPriceMinor: -500, stockQty: 10 }), line(B, { stockQty: 10 })]],
    ['fractional price', (A) => [line(A, { unitPriceMinor: 99.5, stockQty: 10 })]],
    ['fractional line discount', (A) => [line(A, { discountMinor: 10.5, stockQty: 10 })]],
    ['zero grams', (A) => [line(A, { qtyG: 0, stockQty: 10 })]],
  ];
  for (const [name, mkLines] of bad) {
    it(`rejects ${name} with no side effects`, async () => {
      const A = await addProduct('V1', 1000, 400); const B = await addProduct('V2', 1000, 400);
      for (const p of [A, B]) await applyStockMove({ productId: p, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
      await expect(completeSale({ lines: mkLines(A, B), payments: cash(99999), ...SALE })).rejects.toThrow(/Invalid/);
      expect(await stockOf(A)).toBe(10); expect(await stockOf(B)).toBe(10);
      expect(q('select count(*) n from sale')[0].n).toBe(0);
    });
  }
  it('rejects a fractional order discount and a negative payment', async () => {
    const A = await addProduct('V3', 1000, 400);
    await applyStockMove({ productId: A, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
    await expect(completeSale({ lines: [line(A, { stockQty: 10 })], payments: cash(1000), orderDiscountMinor: 0.5, taxEngineId: 'flat:x-1-inclusive' })).rejects.toThrow(/Invalid order discount/);
    await expect(completeSale({ lines: [line(A, { stockQty: 10 })], payments: cash(-1), ...SALE })).rejects.toThrow(/Invalid payment/);
  });
});

d('fully-discounted sale', () => {
  it('can still be refunded and restocked (nothing to pay back, goods return)', async () => {
    const A = await addProduct('Z1', 1000, 400);
    await applyStockMove({ productId: A, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
    const r = await completeSale({ lines: [line(A, { qty: 2, discountMinor: 2000, stockQty: 10 })], payments: [], ...SALE });
    expect(r.sale.totalMinor).toBe(0);
    const ctx = (await getRefundContext(r.sale.id))!;
    const rf = await createRefund({ saleId: r.sale.id, inputs: [{ saleLineId: ctx.lines[0]!.saleLineId, qty: 2, qtyG: null, restock: true }], reasonCode: 'customer_return', masterRestock: true, userId: null });
    expect(rf.totalMinor).toBe(0);
    expect(await stockOf(A)).toBe(10);
  });
});
