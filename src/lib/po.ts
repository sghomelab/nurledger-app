/**
 * Purchase-order math (FR-306, FR-318, FR-322). Pure, integer base units + minor
 * money (ADR-004), unit-testable in node. No DB / RN imports (module-map rule).
 *
 * A PO line is always in BASE units: "receiving 1 carton = +N base units" is done
 * by the UI converting cartons→base with `cartonsToBase` before it is stored.
 * Receiving one line creates exactly one lot (batch) + one FIFO cost layer.
 */

export interface POLineLike {
  qtyOrdered: number;
  qtyReceived: number;
  unitCostMinor: number;
  lotCode: string | null;
  expiryDate: string | null;
}

/** Base units still to receive for a line (never negative). */
export function remainingToReceive(line: Pick<POLineLike, 'qtyOrdered' | 'qtyReceived'>): number {
  return Math.max(0, line.qtyOrdered - line.qtyReceived);
}

/** Total PO value in minor units (Σ qtyOrdered × unitCost). */
export function poTotalCostMinor(lines: Array<Pick<POLineLike, 'qtyOrdered' | 'unitCostMinor'>>): number {
  return lines.reduce((sum, l) => sum + l.qtyOrdered * l.unitCostMinor, 0);
}

/** A PO is fully received when every line has received ≥ ordered. */
export function isFullyReceived(lines: Array<Pick<POLineLike, 'qtyOrdered' | 'qtyReceived'>>): boolean {
  return lines.every((l) => l.qtyReceived >= l.qtyOrdered);
}

/** FR-318: cartons → base units (1 carton = N base). */
export function cartonsToBase(cartons: number, cartonSize: number): number {
  return Math.max(0, Math.round(cartons)) * Math.max(1, Math.round(cartonSize));
}

/** One unit of stock to create on receive (the shape poRepository applies in-tx). */
export interface ReceiveBatch {
  productId: string;
  /** Base units to add. */
  baseQty: number;
  unitCostMinor: number;
  lotCode: string | null;
  expiryDate: string | null;
}

/**
 * Build the receive plan for a PO: for each not-fully-received line, emit one
 * batch (lot) carrying the line's lot code + expiry at `qtyOrdered − qtyReceived`
 * base units. Fully-received lines are skipped (idempotent re-receive).
 */
export function planReceive(
  lines: Array<{ productId: string } & POLineLike>,
): ReceiveBatch[] {
  const plan: ReceiveBatch[] = [];
  for (const l of lines) {
    const qty = remainingToReceive(l);
    if (qty <= 0) continue;
    plan.push({
      productId: l.productId,
      baseQty: qty,
      unitCostMinor: l.unitCostMinor,
      lotCode: l.lotCode,
      expiryDate: l.expiryDate,
    });
  }
  return plan;
}
