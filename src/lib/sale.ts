/**
 * Cart + sale math (M2 register). Pure, integer minor units only (ADR-004),
 * unit-testable in node. No DB / RN imports (module-map rule).
 */

import { marginPct, roundDivide } from './money';
import { consumeFifo, type LayerInput } from './stock';
import type { TaxEngine, TaxResult } from './tax';
import type { CartLine } from '../types';

/** The fields allocateCogs needs from a cost layer (matches LayerInput). */
export type CostLayerLike = Pick<LayerInput, 'id' | 'unitCostMinor' | 'qtyRemaining' | 'receivedAt'>;

export interface CogsAllocation {
  cogsMinor: number;
  unitCostMinor: number | null;
  lotId: string | null;
  short: boolean;
  shortageQty: number;
}

/**
 * Cumulative FIFO COGS allocation across a product's cart lines (FR-321 live margin).
 *
 * Consumes the oldest cost layer first across the product's lines, in line order:
 * once a line fully consumes a layer, the next line continues from what remains.
 * This mirrors exactly what `stockRepository.applySaleInTx` commits, so the live
 * margin in the cart is the margin the completed sale will record.
 *
 * `lotId` (the FEFO first lot, best-effort traceability) is attached to any line
 * that draws at least one unit from a layer; null lines (no coverage) get null.
 */
export function allocateCogs(
  layers: CostLayerLike[],
  lines: Array<{ qty: number }>,
  lotId: string | null,
): CogsAllocation[] {
  const working: LayerInput[] = layers.map((l) => ({
    id: l.id,
    unitCostMinor: l.unitCostMinor,
    qtyRemaining: l.qtyRemaining,
    receivedAt: l.receivedAt,
  }));

  return lines.map((line) => {
    const result = consumeFifo(working, line.qty);
    const first = result.consumed[0];
    const unitCostMinor = first ? first.unitCostMinor : null;
    if (!result.short) {
      for (const c of result.consumed) {
        const wl = working.find((w) => w.id === c.layerId);
        if (wl) wl.qtyRemaining -= c.qty;
      }
    }
    return {
      cogsMinor: result.cogsMinor,
      unitCostMinor,
      lotId: first ? lotId : null,
      short: result.short,
      shortageQty: result.shortageQty,
    };
  });
}

export interface SaleTotals {
  subtotalMinor: number;
  lineDiscountMinor: number;
  orderDiscountMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  cogsMinor: number;
  /** Gross margin % relative to the amount the customer pays (documented choice). */
  marginPct: number;
  unitCount: number;
  /** Tax breakdown (per category / rate) for the receipt (FR-108). */
  tax: TaxResult;
}

/**
 * Live cart totals (M2). Order of operations:
 *   1. subtotal = Σ qty × unitPrice (gross; tax-inclusive for the reference locale)
 *   2. per-line discounts reduce the base
 *   3. order discount clamped to the post-line-discount gross, allocated
 *      pro-rata per line by POST-line-discount net amount (a fully line-
 *      discounted line takes no order-discount share — CR-10)
 *   4. tax = TaxEngine over the per-category post-discount amounts
 *   5. total = base − order discounts; in EXCLUSIVE tax mode the engine's
 *      tax is ADDED on top (tax is not a portion of the total — CR-01)
 *   6. cogs = Σ projected line COGS (FIFO) → live margin
 */
export function computeTotals(
  lines: CartLine[],
  orderDiscountMinor: number,
  taxEngine: TaxEngine,
): SaleTotals {
  const subtotalMinor = lines.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0);
  const lineDiscountMinor = lines.reduce((s, l) => s + Math.max(0, l.discountMinor), 0);
  const grossAfterLineDiscount = Math.max(0, subtotalMinor - lineDiscountMinor);

  const order = Math.min(Math.max(0, orderDiscountMinor), grossAfterLineDiscount);

  const byCategory = new Map<string, number>();
  for (const l of lines) {
    const lineGross = l.unitPriceMinor * l.qty;
    const afterLine = Math.max(0, lineGross - Math.max(0, l.discountMinor));
    // PR-2026-11 (CR-10): prorate by post-line-discount net amounts. Prorating
    // by pre-discount gross (the old base) assigned order-discount shares to
    // lines whose own discount had already removed their net — the shares were
    // then clamped to zero and the order discount was NOT fully deducted from
    // the remaining lines' taxable base.
    const orderShare =
      grossAfterLineDiscount > 0 ? roundDivide(order * afterLine, grossAfterLineDiscount) : 0;
    const taxable = Math.max(0, afterLine - orderShare);
    byCategory.set(l.taxCategory, (byCategory.get(l.taxCategory) ?? 0) + taxable);
  }

  const tax = taxEngine.compute({
    categories: [...byCategory.entries()].map(([category, amountMinor]) => ({ category, amountMinor })),
  });

  // PR-2026-11 (CR-01): in exclusive mode the tax is on TOP of the base —
  // total = base + tax (the customer pays both). Inclusive mode is unchanged:
  // the base already contains the tax.
  const baseTotal = Math.max(0, grossAfterLineDiscount - order);
  const totalMinor = tax.mode === 'exclusive' ? baseTotal + tax.taxMinor : baseTotal;
  const cogsMinor = lines.reduce((s, l) => s + Math.max(0, l.cogsMinor), 0);
  const unitCount = lines.reduce((s, l) => s + l.qty, 0);

  return {
    subtotalMinor,
    lineDiscountMinor,
    orderDiscountMinor: order,
    discountMinor: lineDiscountMinor + order,
    taxMinor: tax.taxMinor,
    totalMinor,
    cogsMinor,
    marginPct: marginPct(totalMinor, cogsMinor),
    unitCount,
    tax,
  };
}
