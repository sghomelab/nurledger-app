/**
 * Purchase-order math (FR-306, FR-318, FR-322). Pure, integer base units + minor
 * money (ADR-004), unit-testable in node. No DB / RN imports (module-map rule).
 *
 * A PO line is always in BASE units: "receiving 1 carton = +N base units" is done
 * by the UI converting cartons→base with `cartonsToBase` before it is stored.
 * Receiving one line creates exactly one lot (batch) + one FIFO cost layer.
 */

import { formatMoney } from './money';

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

// ── FR-306: PO print/share ──────────────────────────────────────────────────

/** Minimal product reference for the PO document (UI resolves from useProducts). */
export interface PoProductRef {
  name?: string;
  sku?: string;
}

/** The PO fields the document needs (PurchaseOrder is a structural superset). */
export interface PoDocumentInput {
  supplierName: string;
  status: string;
  terms: string;
  createdAt: number;
  receivedAt: number | null;
  totalCostMinor: number;
  lines: Array<{
    productId: string;
    qtyOrdered: number;
    qtyReceived: number;
    unitCostMinor: number;
    lotCode: string | null;
    expiryDate: string | null;
  }>;
}

/** Date used in PO documents, e.g. "31 Oct 2026" (matches the PO detail screen). */
export function formatPoDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * FR-306: build a human-readable PO document (plain text — friendly to
 * WhatsApp / email / print from the share sheet). Pure: product names are
 * resolved through `productRef`, so no DB or RN imports here.
 *
 * Money is always rendered in major units via `formatMoney`; a line's
 * extended cost (qty × unit cost) is computed here, in integer minor units.
 */
export function buildPoText(
  po: PoDocumentInput,
  currency: string,
  productRef: (productId: string) => PoProductRef | undefined,
  storeName?: string,
): string {
  const out: string[] = ['PURCHASE ORDER'];
  if (storeName) out.push(`Store: ${storeName}`);
  out.push(`Supplier: ${po.supplierName}`);
  out.push(`Terms: ${po.terms}`);
  out.push(`Created: ${formatPoDate(po.createdAt)}`);
  if (po.receivedAt) out.push(`Received: ${formatPoDate(po.receivedAt)}`);
  out.push(`Status: ${po.status.toUpperCase()}`);
  out.push('');

  po.lines.forEach((l, i) => {
    const ref = productRef(l.productId);
    const name = ref?.name ?? l.productId;
    const label = ref?.sku ? `${name} (${ref.sku})` : name;
    out.push(`${i + 1}. ${label}`);
    out.push(`   ${l.qtyOrdered} @ ${formatMoney(l.unitCostMinor, currency)} = ${formatMoney(l.qtyOrdered * l.unitCostMinor, currency)}`);
    const extras: string[] = [];
    if (l.lotCode) extras.push(`lot ${l.lotCode}`);
    if (l.expiryDate) extras.push(`exp ${l.expiryDate}`);
    if (l.qtyReceived > 0) extras.push(`received ${l.qtyReceived}/${l.qtyOrdered}`);
    if (extras.length > 0) out.push(`   ${extras.join(' · ')}`);
  });

  out.push('');
  const totalUnits = po.lines.reduce((s, l) => s + l.qtyOrdered, 0);
  out.push(`Total: ${formatMoney(po.totalCostMinor, currency)} (${po.lines.length} line${po.lines.length === 1 ? '' : 's'}, ${totalUnits} units)`);
  return out.join('\n');
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
