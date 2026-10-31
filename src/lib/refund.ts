/**
 * Refunds (FR-110, FR-111) — pure, testable. No DB, no RN.
 *
 * A refund is its own append-only record referencing a sale (the sale is
 * NEVER mutated — ADR-002). Full or per-line; a reason code is required; a
 * restock toggle per line decides whether the goods go back to stock
 * (restocked units re-enter the FIFO cost layers at the cost recorded at
 * sale time). Works fully offline (FR-111): the write lands in the local
 * DB + outbox like every other write.
 *
 * Money = integer minor units throughout.
 *
 * AMOUNT MODEL: `sale_line.line_total_minor` is the tax-EXCLUDE line subtotal
 * (unit price × qty − discount); the sale HEADER carries the authoritative
 * tax (FR-108). A refund refunds a share of what the customer actually paid:
 * each line's full-refund value = round(saleTotal × lineTotal / Σ lineTotals),
 * the LAST line absorbing the rounding remainder — so a full refund of the
 * whole sale sums to EXACTLY sale.total_minor. A partial refund refunds
 * round(lineFullValue × k / lineQty).
 */

/** Reason codes (FR-110 "reason code required"). */
export const REFUND_REASONS = [
  'customer_return',
  'wrong_item',
  'damaged',
  'pricing_error',
  'order_mistake',
  'other',
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

/** One refund line: how many units of one sale line are being refunded. */
export interface RefundLineInput {
  saleLineId: string;
  /** Units to refund, 0 < qty <= line.qty − already refunded (each items). */
  qty: number;
  /** Weighed items (FR-103): grams to refund (weighed lines). */
  qtyG: number | null;
  /** Restock this line's goods (default = the screen's master toggle). */
  restock: boolean;
}

/** A sale line as the refund math needs it. */
export interface RefundSaleLine {
  id: string;
  qty: number;
  qtyG: number | null;
  /** Tax-EXCLUDE line subtotal (unit price × qty − discount). */
  lineTotalMinor: number;
  /** Units/grams already refunded by previous refunds of this sale. */
  refundedQty: number;
  refundedQtyG: number | null;
  unitCostMinor: number | null;
}

/**
 * Each line's FULL-refund value in minor units (incl. its tax share), such
 * that Σ values === saleTotalMinor exactly (last line absorbs the remainder).
 * Order matters: pass lines in their stable stored order.
 */
export function lineFullRefundValues(
  lines: Array<Pick<RefundSaleLine, 'lineTotalMinor'>>,
  saleTotalMinor: number,
): number[] {
  const weight = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  if (weight <= 0) throw new Error('Sale has no refundable weight');
  const values = lines.map((l) =>
    Math.round((saleTotalMinor * l.lineTotalMinor) / weight),
  );
  const last = values.length - 1;
  values[last] = values[last]! + saleTotalMinor - values.reduce((a, b) => a + b, 0);
  return values;
}

/**
 * PRORATE a refund amount (incl. tax) from a line's full value by units:
 * round(fullValue × refundedUnits / lineUnits). A refund of the whole line
 * = exactly its full value (no cent left behind, no double charge).
 */
export function prorateRefundMinor(
  lineFullValueMinor: number,
  lineUnits: number,
  refundedUnits: number,
): number {
  if (lineUnits <= 0) throw new Error('lineUnits must be > 0');
  return refundedUnits >= lineUnits
    ? lineFullValueMinor
    : Math.round((lineFullValueMinor * refundedUnits) / lineUnits);
}

/**
 * Validation result for a refund line against its sale line.
 * `amountMinor` is the INCREMENTAL value of THIS refund (full value of the
 * previously-unrefunded units it now covers).
 */
export function validateRefundLine(
  lineFullValueMinor: number,
  lineUnits: number,
  alreadyRefundedUnits: number,
  requestedUnits: number,
): { ok: true; amountMinor: number } | { ok: false; error: string } {
  if (!Number.isInteger(requestedUnits) || requestedUnits <= 0) {
    return { ok: false, error: 'Enter how many to refund.' };
  }
  const remaining = lineUnits - alreadyRefundedUnits;
  if (requestedUnits > remaining) {
    return {
      ok: false,
      error: `Only ${remaining} unit${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'remains' : 'remain'} refundable on this line.`,
    };
  }
  return {
    ok: true,
    amountMinor:
      prorateRefundMinor(lineFullValueMinor, lineUnits, alreadyRefundedUnits + requestedUnits) -
      (alreadyRefundedUnits > 0
        ? prorateRefundMinor(lineFullValueMinor, lineUnits, alreadyRefundedUnits)
        : 0),
  };
}

/** A complete, validated refund request (pure — the repository executes it). */
export interface RefundPlan {
  reasonCode: RefundReason;
  lines: Array<{
    input: RefundLineInput;
    /** Incremental refunded amount (incl. tax share), minor units. */
    amountMinor: number;
  }>;
  totalMinor: number;
}

/**
 * Validate + price the whole refund. Throws on the first bad line.
 * `saleTotalMinor` is the sale header total (incl. tax); lines in stored order.
 */
export function planRefund(
  lines: RefundSaleLine[],
  saleTotalMinor: number,
  inputs: RefundLineInput[],
  reasonCode: RefundReason,
): RefundPlan {
  if (inputs.length === 0) throw new Error('Refund at least one line.');
  const fullValues = lineFullRefundValues(lines, saleTotalMinor);
  const plan: RefundPlan['lines'] = [];
  for (const input of inputs) {
    const idx = lines.findIndex((l) => l.id === input.saleLineId);
    const saleLine = idx >= 0 ? lines[idx] : undefined;
    if (!saleLine) throw new Error(`Unknown sale line ${input.saleLineId}`);
    // Weighed lines are prorated by grams (FR-103); each lines by units.
    const units = saleLine.qtyG != null ? saleLine.qtyG : saleLine.qty;
    const already = saleLine.qtyG != null ? (saleLine.refundedQtyG ?? 0) : saleLine.refundedQty;
    const requested = saleLine.qtyG != null ? input.qtyG ?? 0 : input.qty;
    const fullValue = fullValues[idx]!;
    const v = validateRefundLine(fullValue, units, already, requested);
    if (!v.ok) throw new Error(v.error);
    plan.push({ input, amountMinor: v.amountMinor });
  }
  return {
    reasonCode,
    lines: plan,
    totalMinor: plan.reduce((sum, l) => sum + l.amountMinor, 0),
  };
}
