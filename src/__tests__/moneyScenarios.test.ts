/**
 * @jest-environment node
 *
 * Money / FIFO / refund scenarios on a REAL SQLite engine (node:sqlite) —
 * sale -> ledger -> cost layers -> refunds, end to end. Invariants pinned:
 *   - ledger on-hand == sum(cost_layer.qty_remaining) for unit products
 *   - sale header total == what the cart computes; COGS spans FIFO layers
 *   - refunds sum to EXACTLY the sale total (tax + order discount included)
 *   - oversell is atomic (rollback) for unit AND weighed products
 *   - a line discount can never exceed its own line
 * Skipped automatically when node:sqlite is unavailable (Node < 22.5).
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
import { applyStockMove, stockOf } from '../repositories/stockRepository';
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

d('money scenarios on real SQLite', () => {
it('FIFO across two layers, order+line discount, inclusive tax; partial+final refunds sum to the sale total; ledger == layers', async () => {
  const A = await addProduct('A', 1000, 400);
  await applyStockMove({ productId: A, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'po1' });
  await new Promise((r) => setTimeout(r, 5));
  await applyStockMove({ productId: A, qtyDelta: 10, unitCostMinor: 500, type: 'receive' as any, refType: 'po', refId: 'po2' });
  const r = await completeSale({ lines: [line(A, { qty: 15, discountMinor: 100, stockQty: 20 })], payments: [{ method: 'cash', amountMinor: 14650 } as any], orderDiscountMinor: 250, taxEngineId: 'flat:sg-gst-9-inclusive' });
  const s = r.sale;
  expect(s.cogsMinor).toBe(10 * 400 + 5 * 500);
  expect(s.totalMinor).toBe(15000 - 100 - 250);
  expect(s.taxMinor).toBe(Math.round((14650 * 9) / 109));
  expect(await stockOf(A)).toBe(5);
  expect(sum(q('select qty_remaining from cost_layer where product_id=?', A), 'qty_remaining')).toBe(5);
  const ctx = (await getRefundContext(s.id))!;
  const id = ctx.lines[0]!.saleLineId;
  const r1 = await createRefund({ saleId: s.id, inputs: [{ saleLineId: id, qty: 5, qtyG: null, restock: true }], reasonCode: 'customer_return', masterRestock: true, userId: null });
  const r2 = await createRefund({ saleId: s.id, inputs: [{ saleLineId: id, qty: 10, qtyG: null, restock: false }], reasonCode: 'damaged', masterRestock: false, userId: null });
  expect(r1.totalMinor + r2.totalMinor).toBe(s.totalMinor);
  await expect(createRefund({ saleId: s.id, inputs: [{ saleLineId: id, qty: 1, qtyG: null, restock: true }], reasonCode: 'other', masterRestock: true, userId: null })).rejects.toThrow();
  expect(await stockOf(A)).toBe(10);
  expect(sum(q('select qty_remaining from cost_layer where product_id=?', A), 'qty_remaining')).toBe(10);
});

it('oversell across two lines of the same unit product is rejected atomically', async () => {
  const A = await addProduct('B', 1000, 400);
  await applyStockMove({ productId: A, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
  await expect(completeSale({ lines: [line(A, { qty: 6, stockQty: 10 }), line(A, { qty: 6, stockQty: 10 })], payments: [{ method: 'cash', amountMinor: 12000 } as any], orderDiscountMinor: 0, taxEngineId: 'flat:x-1-inclusive' })).rejects.toThrow();
  expect(await stockOf(A)).toBe(10);
  expect(q('select count(*) n from sale')[0].n).toBe(0);
});

it('WEIGHED oversell is rejected atomically (two 800 g lines vs 1,000 g; stale snapshot)', async () => {
  const W = await addProduct('W', 2000, 1200, true);
  await applyStockMove({ productId: W, qtyDelta: 0, qtyGDelta: 1000, type: 'receive' as any, refType: 'po', refId: 'w' });
  const grams = () => q('select coalesce(sum(qty_g_delta),0) g from stock_ledger where product_id=?', W)[0].g;
  await expect(completeSale({ lines: [line(W, { unitPriceMinor: 1600, qtyG: 800, stockQty: 1000 }), line(W, { unitPriceMinor: 1600, qtyG: 800, stockQty: 1000 })], payments: [{ method: 'cash', amountMinor: 3200 } as any], orderDiscountMinor: 0, taxEngineId: 'flat:x-1-inclusive' })).rejects.toThrow(/Insufficient stock/);
  expect(grams()).toBe(1000);
  expect(q('select count(*) n from sale')[0].n).toBe(0);
  await expect(completeSale({ lines: [line(W, { unitPriceMinor: 10000, qtyG: 5000, stockQty: 99999 })], payments: [{ method: 'cash', amountMinor: 10000 } as any], orderDiscountMinor: 0, taxEngineId: 'flat:x-1-inclusive' })).rejects.toThrow();
  expect(grams()).toBe(1000);
  // a valid weighed sale still works and decrements grams
  await completeSale({ lines: [line(W, { unitPriceMinor: 1600, qtyG: 800, stockQty: 1000 })], payments: [{ method: 'cash', amountMinor: 1600 } as any], orderDiscountMinor: 0, taxEngineId: 'flat:x-1-inclusive' });
  expect(grams()).toBe(200);
});

it('EXCLUSIVE tax: total = base + tax; a full refund returns exactly the total', async () => {
  const A = await addProduct('C', 1000, 400);
  await applyStockMove({ productId: A, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
  const r = await completeSale({ lines: [line(A, { qty: 3, stockQty: 10 })], payments: [{ method: 'card', amountMinor: 3240 } as any], orderDiscountMinor: 0, taxEngineId: 'flat:my-sst-8-exclusive' });
  expect(r.sale.totalMinor).toBe(3240);
  const ctx = (await getRefundContext(r.sale.id))!;
  const rf = await createRefund({ saleId: r.sale.id, inputs: [{ saleLineId: ctx.lines[0]!.saleLineId, qty: 3, qtyG: null, restock: true }], reasonCode: 'customer_return', masterRestock: true, userId: null });
  expect(rf.totalMinor).toBe(3240);
});

it('a line discount larger than its own line is clamped (no negative line, other lines untouched)', async () => {
  const A = await addProduct('D', 1000, 400); const B = await addProduct('E', 1000, 400);
  for (const p of [A, B]) await applyStockMove({ productId: p, qtyDelta: 10, unitCostMinor: 400, type: 'receive' as any, refType: 'po', refId: 'p' });
  const r = await completeSale({ lines: [line(A, { qty: 1, discountMinor: 1500, stockQty: 10 }), line(B, { qty: 1, stockQty: 10 })], payments: [{ method: 'cash', amountMinor: 1000 } as any], orderDiscountMinor: 0, taxEngineId: 'flat:x-9-inclusive' });
  expect(r.sale.lines.map((l: any) => l.lineTotalMinor).sort()).toEqual([0, 1000]);
  expect(r.sale.totalMinor).toBe(1000);
  expect(r.sale.discountMinor).toBe(1000);
});
});
