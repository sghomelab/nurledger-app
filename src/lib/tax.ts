/**
 * TaxEngine (spec §4.4, FR-108, FR-600, ADR-004).
 *
 * Locale behavior is pluggable — NO rate is hardcoded in the register. The
 * outlet carries a tax-engine id (e.g. 'flat:sg-gst-9-inclusive'); this module
 * resolves it to a concrete engine. The reference locale is SG / SGD / GST 9%
 * inclusive (spec: one reference locale fully wired; the prototype's 8.25% was
 * a demo fixture, never a constant — ADR-004).
 *
 * Pure + integer minor units only — unit-testable in node.
 */

import { roundDivide } from './money';

export type TaxMode = 'inclusive' | 'exclusive';

export interface TaxCategoryAmount {
  /** Tax category key (product.tax_category). */
  category: string;
  /** Post-discount taxable amount for this category (minor). */
  amountMinor: number;
}

export interface TaxInput {
  /** Per-category post-discount amounts. */
  categories: TaxCategoryAmount[];
  /** Optional rate override (e.g. tests, or a temporary 0% promo). Falls back to the engine rate. */
  ratePctOverride?: number;
}

export interface TaxLine {
  category: string;
  ratePct: number;
  /** Post-discount amount in this bucket (minor). */
  amountMinor: number;
  /** Tax component for this bucket (minor). */
  taxMinor: number;
}

export interface TaxResult {
  mode: TaxMode;
  ratePct: number;
  /** Total taxable base = Σ categories (minor). */
  amountMinor: number;
  /** Total tax (minor). */
  taxMinor: number;
  /** amount − tax (inclusive) or amount (exclusive) (minor). */
  netMinor: number;
  /** Per-category / per-rate breakdown for the receipt (FR-108). */
  lines: TaxLine[];
}

export interface TaxEngine {
  id: string;
  mode: TaxMode;
  /** Flat percentage (0–100+, e.g. 9 for 9% GST). */
  ratePct: number;
  compute(input: TaxInput): TaxResult;
}

/**
 * Flat-rate engine (covers GST / VAT / sales tax — FR-600).
 * - inclusive: prices already contain tax; extract tax = amount × rate / (100 + rate).
 * - exclusive: tax added on top; tax = amount × rate / 100.
 */
export function flatRateTaxEngine(id: string, ratePct: number, mode: TaxMode): TaxEngine {
  return {
    id,
    mode,
    ratePct,
    compute(input) {
      const rate = input.ratePctOverride ?? ratePct;
      const lines: TaxLine[] = [];
      let amountMinor = 0;
      let taxMinor = 0;
      for (const c of input.categories) {
        if (c.amountMinor <= 0) continue;
        const lineTax =
          mode === 'inclusive'
            ? roundDivide(c.amountMinor * rate, 100 + rate)
            : roundDivide(c.amountMinor * rate, 100);
        lines.push({ category: c.category, ratePct: rate, amountMinor: c.amountMinor, taxMinor: lineTax });
        amountMinor += c.amountMinor;
        taxMinor += lineTax;
      }
      const netMinor = mode === 'inclusive' ? amountMinor - taxMinor : amountMinor;
      return { mode, ratePct: rate, amountMinor, taxMinor, netMinor, lines };
    },
  };
}

/**
 * Resolve an engine id to a TaxEngine.
 *
 * Recognized form: `flat:<label>-<rate>-<mode>` e.g. `flat:sg-gst-9-inclusive`
 * → 9% GST, inclusive. Anything unrecognized resolves to a ZERO-rate engine so
 * the register never blocks and never invents a tax (SPEC-DEVIATION note).
 */
export function taxEngineFor(engineId: string): TaxEngine {
  const m = /^flat:(.+)-(\d+(?:\.\d+)?)-(inclusive|exclusive)$/.exec(engineId);
  if (m) {
    return flatRateTaxEngine(engineId, Number(m[2]), m[3] as TaxMode);
  }
  return flatRateTaxEngine(engineId || 'none', 0, 'inclusive');
}
