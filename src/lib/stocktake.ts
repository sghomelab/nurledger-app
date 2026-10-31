/**
 * Stocktake math (FR-304) — pure, no DB/RN.
 *
 * A stocktake counts the book stock (base units for unit-based products,
 * grams for weighed — see FR-103) against the counted quantity and produces
 * variances. The repository applies non-zero variances as 'adjustment'
 * ledger rows (immutable, ADR-002); stock is the projection.
 *
 * Blind count (FR-304): the book quantity is hidden from the counter; the
 * reveal happens in the variance review (the approver sees book vs counted).
 * Blindness is a display concern only — the math here is identical either way.
 */

/** One product line of a stocktake. `bookQty` is in the product's stock unit. */
export interface StocktakeLineInput {
  bookQty: number;
  countedQty: number | null;
}

/** Variance = counted − book. Null when the line has not been counted yet. */
export function lineVariance(line: StocktakeLineInput): number | null {
  if (line.countedQty === null) return null;
  return line.countedQty - line.bookQty;
}

export interface StocktakeSummary {
  /** Total lines in scope. */
  total: number;
  /** Lines with a count entered. */
  counted: number;
  /** Counted lines with a positive variance (found more than book). */
  gains: number;
  /** Counted lines with a negative variance (shrinkage). */
  losses: number;
  /** Net variance across counted lines (gains − losses), in stock units.
   *  Mixing unit and weighed products in one total is display-only — the
   *  per-line rows are the source of truth. */
  netVariance: number;
}

export function summarizeVariance(lines: StocktakeLineInput[]): StocktakeSummary {
  let counted = 0;
  let gains = 0;
  let losses = 0;
  let net = 0;
  for (const line of lines) {
    const v = lineVariance(line);
    if (v === null) continue;
    counted += 1;
    if (v > 0) gains += 1;
    else if (v < 0) losses += 1;
    net += v;
  }
  return { total: lines.length, counted, gains, losses, netVariance: net };
}
