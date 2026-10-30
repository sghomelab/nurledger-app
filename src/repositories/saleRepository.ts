/**
 * Sale repository — the only module that completes a sale (M2 register core).
 *
 * `completeSale` runs one transaction: FIFO consume + immutable ledger decrement
 * per line, sale header + per-line COGS (FR-321), payments, an outbox op
 * (FR-502), and the cart clear. Any failure (including oversell) rolls back the
 * whole thing — the register never leaves partial stock state (NFR-3, ADR-002).
 */

import { getDb } from '../db/database';
import { uuidv4 } from '../lib/ids';
import { computeTotals, type SaleTotals } from '../lib/sale';
import { taxEngineFor } from '../lib/tax';
import { applySaleInTx } from './stockRepository';
import { clearActiveOrderInTx } from './orderRepository';
import type { CartLine, CompletedSale, PaymentAllocation, Sale, SaleLine } from '../types';

export interface CompleteSaleInput {
  lines: CartLine[];
  payments: PaymentAllocation[];
  orderDiscountMinor: number;
  /** Outlet's tax engine id (e.g. 'flat:sg-gst-9-inclusive') — never a rate. */
  taxEngineId: string;
  cashierId?: string | null;
  deviceId?: string | null;
  shiftId?: string | null;
}

/**
 * The sale totals (subtotal/discount/tax/total + tax breakdown) for the receipt.
 * Computed here so the receipt and the stored header always agree.
 */
export interface SaleReceipt {
  sale: CompletedSale;
  totals: SaleTotals;
}

export async function completeSale(input: CompleteSaleInput): Promise<SaleReceipt> {
  const db = await getDb();
  if (input.lines.length === 0) throw new Error('Cannot complete an empty sale');

  const taxEngine = taxEngineFor(input.taxEngineId);
  const totals = computeTotals(input.lines, input.orderDiscountMinor, taxEngine);
  if (totals.totalMinor < 0) throw new Error('Invalid sale total');

  // Friendly oversell guard up front; the transaction re-checks authoritatively.
  for (const l of input.lines) {
    if (l.qty > l.stockQty) {
      throw new Error(`Insufficient stock for ${l.name} (have ${l.stockQty}, need ${l.qty})`);
    }
  }

  const saleId = uuidv4();
  const saleUuid = uuidv4();
  const now = Date.now();
  const deviceId = input.deviceId ?? null;

  interface LineCommit {
    line: CartLine;
    cogsMinor: number;
    unitCostMinor: number | null;
    lotId: string | null;
    lineTotalMinor: number;
  }
  const lineCommits: LineCommit[] = [];

  await db.withTransactionAsync(async () => {
    const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
    if (!outlet) throw new Error('No outlet — DB not seeded');

    // 1 + 2a: consume FIFO + append immutable ledger; accumulate authoritative COGS.
    let cogsTotal = 0;
    for (const line of input.lines) {
      const cogs = await applySaleInTx(db, { productId: line.productId, qty: line.qty, refId: saleId, deviceId });
      if (cogs.short) throw new Error(`Insufficient stock for ${line.name}`);
      cogsTotal += cogs.cogsMinor;
      lineCommits.push({
        line,
        cogsMinor: cogs.cogsMinor,
        unitCostMinor: cogs.unitCostMinor,
        lotId: cogs.lotId,
        lineTotalMinor: line.unitPriceMinor * line.qty - Math.max(0, line.discountMinor),
      });
    }

    // 2b: sale header
    await db.runAsync(
      `INSERT INTO sale (id, uuid, outlet_id, device_id, cashier_id, shift_id, status,
        subtotal_minor, discount_minor, tax_minor, total_minor, cogs_minor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
      [saleId, saleUuid, outlet.id, deviceId, input.cashierId ?? null, input.shiftId ?? null,
       totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, cogsTotal, now],
    );

    // 2c: sale lines with per-line COGS recorded at sale time (FR-321).
    // Per-line tax is a display concern (category breakdown on the receipt); the
    // header carries the authoritative total tax (FR-108).
    for (const lc of lineCommits) {
      await db.runAsync(
        `INSERT INTO sale_line (id, sale_id, product_id, lot_id, qty, unit_price_minor,
          discount_minor, tax_minor, line_total_minor, unit_cost_minor, cogs_minor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [uuidv4(), saleId, lc.line.productId, lc.lotId, lc.line.qty, lc.line.unitPriceMinor,
         Math.max(0, lc.line.discountMinor), lc.lineTotalMinor, lc.unitCostMinor, lc.cogsMinor, now],
      );
    }

    // 3: payments
    for (const p of input.payments) {
      await db.runAsync(
        'INSERT INTO payment (id, sale_id, method, amount_minor, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), saleId, p.method, p.amountMinor, p.reference ?? null, now],
      );
    }

    // 4: outbox op (FR-502, idempotent by client UUID). The sale is the sync unit;
    // stock_ledger rows carry their own sync_op_id for the M5 drain.
    await db.runAsync(
      'INSERT INTO outbox (id, op_id, entity, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), uuidv4(), 'sale', JSON.stringify({
        saleId, saleUuid, outletId: outlet.id, totalMinor: totals.totalMinor,
        cogsMinor: cogsTotal, payments: input.payments, createdAt: now,
      }), now],
    );

    // 5: clear the active cart (sale complete) — in the caller's transaction
    // (no nested withTransactionAsync; see clearActiveOrderInTx).
    await clearActiveOrderInTx(db);
  });

  const sale = await getSale(saleId);
  if (!sale) throw new Error('Sale vanished after commit (should be impossible)');
  return { sale, totals };
}

interface RawSale {
  id: string;
  uuid: string;
  outlet_id: string;
  device_id: string | null;
  cashier_id: string | null;
  shift_id: string | null;
  status: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  cogs_minor: number;
  created_at: number;
}

interface RawLine {
  id: string;
  sale_id: string;
  product_id: string;
  lot_id: string | null;
  qty: number;
  unit_price_minor: number;
  discount_minor: number;
  tax_minor: number;
  line_total_minor: number;
  unit_cost_minor: number | null;
  cogs_minor: number | null;
  name: string | null;
  sku: string | null;
}

interface RawPayment {
  method: string;
  amount_minor: number;
  reference: string | null;
}

/** Fetch a sale with its lines + payments (receipt / re-print, FR-109). */
export async function getSale(id: string): Promise<CompletedSale | null> {
  const db = await getDb();
  const sale = await db.getFirstAsync<RawSale | null>(
    `SELECT id, uuid, outlet_id, device_id, cashier_id, shift_id, status,
            subtotal_minor, discount_minor, tax_minor, total_minor, cogs_minor, created_at
       FROM sale WHERE id = ?`,
    [id],
  );
  if (!sale) return null;

  const lines = await db.getAllAsync<RawLine>(
    `SELECT sl.id, sl.sale_id, sl.product_id, sl.lot_id, sl.qty, sl.unit_price_minor,
            sl.discount_minor, sl.tax_minor, sl.line_total_minor, sl.unit_cost_minor, sl.cogs_minor,
            p.name, p.sku
       FROM sale_line sl LEFT JOIN product p ON p.id = sl.product_id
      WHERE sl.sale_id = ?`,
    [id],
  );
  const payments = await db.getAllAsync<RawPayment>(
    'SELECT method, amount_minor, reference FROM payment WHERE sale_id = ?',
    [id],
  );

  const mappedLines: SaleLine[] = lines.map((l) => ({
    id: l.id,
    saleId: l.sale_id,
    productId: l.product_id,
    lotId: l.lot_id,
    sku: l.sku ?? '',
    name: l.name ?? 'Unknown item',
    qty: l.qty,
    unitPriceMinor: l.unit_price_minor,
    discountMinor: l.discount_minor,
    taxMinor: l.tax_minor,
    lineTotalMinor: l.line_total_minor,
    unitCostMinor: l.unit_cost_minor,
    cogsMinor: l.cogs_minor,
  }));

  const mappedSale: Sale = {
    id: sale.id,
    uuid: sale.uuid,
    outletId: sale.outlet_id,
    deviceId: sale.device_id,
    cashierId: sale.cashier_id,
    shiftId: sale.shift_id,
    status: sale.status,
    subtotalMinor: sale.subtotal_minor,
    discountMinor: sale.discount_minor,
    taxMinor: sale.tax_minor,
    totalMinor: sale.total_minor,
    cogsMinor: sale.cogs_minor,
    createdAt: sale.created_at,
  };

  return {
    ...mappedSale,
    lines: mappedLines,
    payments: payments.map((p) => ({
      method: p.method as PaymentAllocation['method'],
      amountMinor: p.amount_minor,
      reference: p.reference,
    })),
  };
}

/** Count of outbox ops not yet uploaded — drives the "N sales waiting" banner. */
export async function outboxCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM outbox WHERE uploaded_at IS NULL',
  );
  return row ? row.n : 0;
}
