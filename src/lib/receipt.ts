/**
 * Receipt template engine (FR-604, spec §4.4) — pure, unit-testable.
 *
 * Layouts a receipt for a 58mm (32 cols) or 80mm (48 cols) thermal printer,
 * PARAMETERIZED BY TAXENGINE OUTPUT: the tax section renders the engine's
 * per-category breakdown + its mode/rate (FR-108) — nothing tax-specific is
 * hardcoded here. On-screen fallback (FR-109) renders the same rows.
 */

import type { TaxLine, TaxMode } from './tax';

export type ReceiptWidth = '58mm' | '80mm';

/** Cols per width (ESC/POS thermal: ~12.7mm per 12 cols at 384-dot width). */
export const WIDTH_COLS: Record<ReceiptWidth, number> = {
  '58mm': 32,
  '80mm': 48,
};

export interface ReceiptLineInput {
  name: string;
  qty: number;
  /** Weighed lines: the weighed amount in grams (FR-103). */
  qtyG: number | null;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface ReceiptData {
  outletName: string;
  address?: string | null;
  /** e.g. 'SL-1234'. */
  number: string;
  /** Pre-formatted stamp (keep the engine locale-free). */
  stamp: string;
  cashierName?: string | null;
  lines: ReceiptLineInput[];
  subtotalMinor: number;
  discountMinor: number;
  /** TaxEngine output — the parameterized tax section (FR-108/FR-604). */
  mode: TaxMode;
  ratePct: number;
  taxLines: TaxLine[];
  taxMinor: number;
  totalMinor: number;
  payments: Array<{ label: string; amountMinor: number; reference?: string | null }>;
  changeMinor?: number;
  currency: string;
  /** Currency display, e.g. 'SGD 12.34' (callers use formatMoney). */
  fmt: (minor: number) => string;
}

export interface ReceiptRow {
  /** Left text (already truncated to fit the width). Omit for centered rows. */
  left?: string;
  /** Right-aligned text (amounts). Omit for full-width rows. */
  right?: string;
  /** Centered single-text row (header). */
  center?: string;
  /** Dashed divider. */
  rule?: boolean;
  bold?: boolean;
  /** Indented continuation (tax categories, notes). */
  indent?: boolean;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, Math.max(0, n - 1))}…`;
}

/** Right-pad / right-align a value column inside a fixed width. */
function padRight(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function dashRule(cols: number): string {
  return '-'.repeat(cols);
}

/**
 * Layout the receipt. Returns ordered rows; the caller (printer driver or
 * on-screen view) just prints them. 58mm truncates names; 80mm rarely does.
 */
export function layoutReceipt(d: ReceiptData, width: ReceiptWidth): ReceiptRow[] {
  const cols = WIDTH_COLS[width];
  const rule: ReceiptRow = { left: dashRule(cols), rule: true };
  const rows: ReceiptRow[] = [];

  // Header
  rows.push({ center: d.outletName, bold: true });
  if (d.address) rows.push({ center: d.address });
  rows.push({ left: d.number, right: d.stamp });
  if (d.cashierName) rows.push({ left: `Cashier: ${d.cashierName}` });
  rows.push(rule);

  // Item lines: name (left, truncated) + line total (right).
  const amountW = 10;
  for (const l of d.lines) {
    const qtyLabel = l.qtyG != null ? `${l.qtyG} g` : `x${l.qty}`;
    const name = truncate(l.name, cols - amountW - qtyLabel.length - 2);
    rows.push({ left: `${name}  ${qtyLabel}`, right: d.fmt(l.lineTotalMinor) });
  }
  rows.push(rule);

  // Totals (tax section = TaxEngine output — inclusive or exclusive, FR-108)
  rows.push({ left: 'Subtotal', right: d.fmt(d.subtotalMinor) });
  if (d.discountMinor > 0) {
    rows.push({ left: 'Discount', right: `-${d.fmt(d.discountMinor)}` });
  }
  const modeLabel = d.mode === 'inclusive' ? ' incl.' : '';
  if (d.taxLines.length === 1 && d.taxLines[0]) {
    const t = d.taxLines[0];
    rows.push({
      left: `Tax ${d.ratePct}%${modeLabel} (${t.category})`,
      right: d.fmt(t.taxMinor),
    });
  } else if (d.taxLines.length > 1) {
    rows.push({ left: `Tax ${d.ratePct}%${modeLabel}`, right: d.fmt(d.taxMinor), bold: true });
    for (const t of d.taxLines) {
      rows.push({
        left: truncate(`  ${t.category} @ ${t.ratePct}%`, cols - amountW - 1),
        right: d.fmt(t.taxMinor),
        indent: true,
      });
    }
  } else {
    rows.push({ left: `Tax ${d.ratePct}%${modeLabel}`, right: d.fmt(d.taxMinor) });
  }
  rows.push({ left: 'TOTAL', right: d.fmt(d.totalMinor), bold: true });
  rows.push(rule);

  // Payments + change
  for (const p of d.payments) {
    rows.push({
      left: p.reference ? `${p.label} (${p.reference})` : p.label,
      right: d.fmt(p.amountMinor),
    });
  }
  if ((d.changeMinor ?? 0) > 0) {
    rows.push({ left: 'Change', right: d.fmt(d.changeMinor!) });
  }

  rows.push(rule);
  rows.push({ center: 'Thank you — come again!' });
  return rows;
}

/** Plain-text rendering (tests, print-driver handoff, shareable text). */
export function renderReceiptText(rows: ReceiptRow[], cols = 48): string {
  return rows
    .map((r) => {
      if (r.rule) return r.left ?? '';
      if (r.center) return r.center.length <= cols ? r.center.padStart(Math.ceil((cols + r.center.length) / 2)) : r.center;
      if (r.right != null) {
        const leftPart = truncate(r.left ?? '', Math.max(0, cols - r.right.length - 1));
        return `${leftPart} ${r.right}`;
      }
      return r.left ?? '';
    })
    .join('\n');
}
