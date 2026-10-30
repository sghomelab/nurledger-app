/**
 * Shift math (FR-200…FR-204, pure — integer minor units, ADR-004).
 *
 * Drawer invariant: expected cash = float + cash sales + cash in − cash out.
 * Variance = counted − expected (FR-202: "expected vs counted variance").
 *
 * Z-report (FR-202): sales by payment method, cash movements, variance,
 * refunds. Refunds land in M6 (FR-110/FR-111) — the field is present with 0
 * so the report shape is stable from day one.
 */

export type CashMoveType = 'in' | 'out';

export interface CashMove {
  id: string;
  type: CashMoveType;
  amountMinor: number;
  reason: string;
  createdAt: number;
}

export interface CashTotals {
  floatMinor: number;
  /** Cash-method sales of the shift (Σ payment rows where method='cash'). */
  cashSaleMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
}

/** FR-202 drawer math: float + cash sales + cash in − cash out. */
export function expectedCashMinor(t: CashTotals): number {
  return t.floatMinor + t.cashSaleMinor + t.cashInMinor - t.cashOutMinor;
}

export type VarianceClass = 'exact' | 'over' | 'short';

export function classifyVariance(varianceMinor: number): VarianceClass {
  if (varianceMinor === 0) return 'exact';
  return varianceMinor > 0 ? 'over' : 'short';
}

/** Signed variance: counted − expected (FR-202). */
export function varianceMinor(countedMinor: number, t: CashTotals): number {
  return countedMinor - expectedCashMinor(t);
}

export interface SalesByMethod {
  /** method id (cash/card/mobile/qr) → minor. Zero keys omitted. */
  [method: string]: number;
}

/** Z-report (FR-202) — serializable; stored as z_report_json on the shift. */
export interface ZReport {
  kind: 'Z';
  shiftId: string;
  deviceId: string | null;
  cashierName: string | null;
  openedAt: number;
  closedAt: number;
  salesByMethod: SalesByMethod;
  cashSaleMinor: number;
  cashMoves: CashMove[];
  floatMinor: number;
  expectedMinor: number;
  countedMinor: number;
  varianceMinor: number;
  varianceClass: VarianceClass;
  /** FR-110/FR-111 refunds land in M6 — 0 keeps the report shape stable. */
  refundsMinor: number;
  notes: string | null;
}

export interface ZReportInput {
  shiftId: string;
  deviceId: string | null;
  cashierName: string | null;
  openedAt: number;
  closedAt: number;
  salesByMethod: SalesByMethod;
  cashMoves: CashMove[];
  totals: CashTotals;
  countedMinor: number;
  notes: string | null;
}

export function buildZReport(input: ZReportInput): ZReport {
  const v = varianceMinor(input.countedMinor, input.totals);
  return {
    kind: 'Z',
    shiftId: input.shiftId,
    deviceId: input.deviceId,
    cashierName: input.cashierName,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
    salesByMethod: input.salesByMethod,
    cashSaleMinor: input.totals.cashSaleMinor,
    cashMoves: input.cashMoves,
    floatMinor: input.totals.floatMinor,
    expectedMinor: expectedCashMinor(input.totals),
    countedMinor: input.countedMinor,
    varianceMinor: v,
    varianceClass: classifyVariance(v),
    refundsMinor: 0,
    notes: input.notes,
  };
}

/** X-report (FR-203) — interim snapshot of the OPEN shift (no counted/variance). */
export interface XReport {
  kind: 'X';
  shiftId: string;
  cashierName: string | null;
  openedAt: number;
  generatedAt: number;
  salesByMethod: SalesByMethod;
  cashSaleMinor: number;
  floatMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  expectedCashMinor: number;
}

export function buildXReport(
  shiftId: string,
  cashierName: string | null,
  openedAt: number,
  salesByMethod: SalesByMethod,
  totals: CashTotals,
  generatedAt: number,
): XReport {
  return {
    kind: 'X',
    shiftId,
    cashierName,
    openedAt,
    generatedAt,
    salesByMethod,
    cashSaleMinor: totals.cashSaleMinor,
    floatMinor: totals.floatMinor,
    cashInMinor: totals.cashInMinor,
    cashOutMinor: totals.cashOutMinor,
    expectedCashMinor: expectedCashMinor(totals),
  };
}
