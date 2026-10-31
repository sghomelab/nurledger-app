/**
 * Shift repository (FR-200…FR-204). A shift = {device, cashier} pair with a
 * recorded float; at most ONE open shift per device (enforced here — the
 * device is a single-register shop at launch, so "per device" = "global").
 *
 * The shift row is a state record (UPDATEd on close); the immutable facts are
 * the sale/payment/cash_move rows it references. Closing computes the drawer
 * math via src/lib/shift (expected = float + cash sales + in − out) and
 * stores the Z-report JSON (FR-202).
 *
 * Offline (FR-204): open/close are pure local writes — no sync dependency;
 * the shift's sales already flow through the outbox like any other sale.
 */

import { getDb } from '../db/database';
import { uuidv4 } from '../lib/ids';
import {
  buildZReport,
  expectedCashMinor,
  type CashMove,
  type CashMoveType,
  type SalesByMethod,
  type ZReport,
} from '../lib/shift';

export interface Shift {
  id: string;
  outletId: string;
  deviceId: string | null;
  cashierId: string | null;
  cashierName: string | null;
  openedAt: number;
  closedAt: number | null;
  floatMinor: number;
  countedMinor: number | null;
  expectedMinor: number | null;
  varianceMinor: number | null;
  notes: string | null;
  /** Parsed z_report_json (null until closed). */
  zReport: ZReport | null;
}

interface RawShift {
  id: string;
  outlet_id: string;
  device_id: string | null;
  cashier_id: string | null;
  cashier_name: string | null;
  opened_at: number;
  closed_at: number | null;
  float_minor: number;
  counted_minor: number | null;
  expected_minor: number | null;
  variance_minor: number | null;
  notes: string | null;
  z_report_json: string | null;
}

function toShift(row: RawShift): Shift {
  let zReport: ZReport | null = null;
  if (row.z_report_json) {
    try {
      zReport = JSON.parse(row.z_report_json) as ZReport;
    } catch {
      zReport = null;
    }
  }
  return {
    id: row.id,
    outletId: row.outlet_id,
    deviceId: row.device_id,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    floatMinor: row.float_minor,
    countedMinor: row.counted_minor,
    expectedMinor: row.expected_minor,
    varianceMinor: row.variance_minor,
    notes: row.notes,
    zReport,
  };
}

const SHIFT_SELECT = `
SELECT s.id, s.outlet_id, s.device_id, s.cashier_id, u.name AS cashier_name,
       s.opened_at, s.closed_at, s.float_minor, s.counted_minor, s.expected_minor,
       s.variance_minor, s.notes, s.z_report_json
FROM shift s
LEFT JOIN app_user u ON u.id = s.cashier_id
`;

/** The single open shift, or null (register locked). */
export async function getOpenShift(): Promise<Shift | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawShift>(
    `${SHIFT_SELECT} WHERE s.closed_at IS NULL ORDER BY s.opened_at DESC LIMIT 1`,
  );
  return row ? toShift(row) : null;
}

export async function getShift(id: string): Promise<Shift | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawShift>(`${SHIFT_SELECT} WHERE s.id = ?`, [id]);
  return row ? toShift(row) : null;
}

/** Closed shifts, most recent first (the Shift tab's history list). */
export async function listClosedShifts(limit = 50): Promise<Shift[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawShift>(
    `${SHIFT_SELECT} WHERE s.closed_at IS NOT NULL ORDER BY s.closed_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toShift);
}

export interface OpenShiftInput {
  outletId: string;
  deviceId: string | null;
  cashierId: string | null;
  floatMinor: number;
}

/** FR-200: the stable device id (shift = {device, cashier} pair). Created once at bootstrap. */
export async function getDeviceId(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'device_id'",
  );
  return row?.value ?? null;
}

/** FR-200: open a shift with a recorded float. Throws if one is already open. */
export async function openShift(input: OpenShiftInput): Promise<Shift> {
  const db = await getDb();
  const existing = await getOpenShift();
  if (existing) throw new Error('A shift is already open on this device');

  const id = uuidv4();
  await db.runAsync(
    'INSERT INTO shift (id, outlet_id, device_id, cashier_id, opened_at, float_minor) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.outletId, input.deviceId, input.cashierId, Date.now(), Math.max(0, Math.round(input.floatMinor))],
  );
  const shift = await getShift(id);
  if (!shift) throw new Error('Shift vanished after insert (should be impossible)');
  return shift;
}

/** FR-201: a cash movement during the shift (top-up, tips out, etc.). */
export async function addCashMove(shiftId: string, type: CashMoveType, amountMinor: number, reason: string): Promise<CashMove> {
  const db = await getDb();
  const shift = await getShift(shiftId);
  if (!shift) throw new Error('Shift not found');
  if (shift.closedAt !== null) throw new Error('Shift is closed');
  if (amountMinor <= 0) throw new Error('Cash amount must be positive');
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A reason is required');

  const id = uuidv4();
  await db.runAsync(
    'INSERT INTO cash_move (id, shift_id, type, amount_minor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, shiftId, type, Math.round(amountMinor), trimmed, Date.now()],
  );
  return { id, type, amountMinor: Math.round(amountMinor), reason: trimmed, createdAt: Date.now() };
}

export async function listCashMoves(shiftId: string): Promise<CashMove[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string; type: string; amount_minor: number; reason: string; created_at: number;
  }>('SELECT id, type, amount_minor, reason, created_at FROM cash_move WHERE shift_id = ? ORDER BY created_at ASC', [
    shiftId,
  ]);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as CashMoveType,
    amountMinor: r.amount_minor,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** Sales totals by payment method for a shift (Σ payment.amount by method). */
export async function getShiftSalesByMethod(shiftId: string): Promise<SalesByMethod> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ method: string; total: number }>(
    `SELECT p.method AS method, COALESCE(SUM(p.amount_minor), 0) AS total
     FROM payment p JOIN sale s ON s.id = p.sale_id
     WHERE s.shift_id = ? AND s.status = 'completed'
     GROUP BY p.method`,
    [shiftId],
  );
  const out: SalesByMethod = {};
  for (const r of rows) {
    if (r.total > 0) out[r.method] = r.total;
  }
  return out;
}

export interface CloseShiftInput {
  shiftId: string;
  countedMinor: number;
  notes: string | null;
}

/**
 * FR-202: close the shift. Drawer math (src/lib/shift): expected = float +
 * cash sales + in − out; variance = counted − expected. The Z-report is
 * built and stored as JSON on the shift row (the single source of truth for
 * the printed/exported report).
 */
export async function closeShift(input: CloseShiftInput): Promise<Shift> {
  const db = await getDb();

  const shift = await getShift(input.shiftId);
  if (!shift) throw new Error('Shift not found');
  if (shift.closedAt !== null) throw new Error('Shift is already closed');

  const salesByMethod = await getShiftSalesByMethod(shift.id);
  const cashSaleMinor = salesByMethod['cash'] ?? 0;
  const moves = await listCashMoves(shift.id);
  const cashInMinor = moves.filter((m) => m.type === 'in').reduce((s, m) => s + m.amountMinor, 0);
  const cashOutMinor = moves.filter((m) => m.type === 'out').reduce((s, m) => s + m.amountMinor, 0);
  // M6 (FR-110): refunds recorded against this shift's sales feed the Z-report.
  const refundsRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COALESCE(SUM(r.amount_minor), 0) AS n
       FROM refund r JOIN sale s ON s.id = r.sale_id
      WHERE s.shift_id = ?`,
    [shift.id],
  );
  const refundsMinor = refundsRow?.n ?? 0;

  const closedAt = Date.now();
  const totals = { floatMinor: shift.floatMinor, cashSaleMinor, cashInMinor, cashOutMinor };
  const expected = expectedCashMinor(totals);
  const report = buildZReport({
    shiftId: shift.id,
    deviceId: shift.deviceId,
    cashierName: shift.cashierName,
    openedAt: shift.openedAt,
    closedAt,
    salesByMethod,
    cashMoves: moves,
    totals,
    countedMinor: Math.round(input.countedMinor),
    notes: input.notes?.trim() ? input.notes.trim() : null,
    refundsMinor,
  });

  // withTransactionAsync is void-returning, so the single write (UPDATE shift)
  // is the atomic unit; the computed Z-report is already final.
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE shift SET closed_at = ?, counted_minor = ?, expected_minor = ?, variance_minor = ?,
       notes = ?, z_report_json = ? WHERE id = ?`,
      [closedAt, report.countedMinor, report.expectedMinor, report.varianceMinor, report.notes, JSON.stringify(report), shift.id],
    );
  });

  const done = await getShift(shift.id);
  if (!done) throw new Error('Shift vanished after close (should be impossible)');
  return done;
}

/** Live drawer snapshot for the open shift (X-report input + drawer card). */
export interface DrawerSnapshot {
  shift: Shift;
  salesByMethod: SalesByMethod;
  moves: CashMove[];
  totals: { floatMinor: number; cashSaleMinor: number; cashInMinor: number; cashOutMinor: number };
  expectedCashMinor: number;
}

export async function getShiftDrawerSnapshot(shiftId: string): Promise<DrawerSnapshot | null> {
  const shift = await getShift(shiftId);
  if (!shift) return null;
  const salesByMethod = await getShiftSalesByMethod(shiftId);
  const moves = await listCashMoves(shiftId);
  const cashSaleMinor = salesByMethod['cash'] ?? 0;
  const cashInMinor = moves.filter((m) => m.type === 'in').reduce((s, m) => s + m.amountMinor, 0);
  const cashOutMinor = moves.filter((m) => m.type === 'out').reduce((s, m) => s + m.amountMinor, 0);
  const totals = { floatMinor: shift.floatMinor, cashSaleMinor, cashInMinor, cashOutMinor };
  return { shift, salesByMethod, moves, totals, expectedCashMinor: expectedCashMinor(totals) };
}
