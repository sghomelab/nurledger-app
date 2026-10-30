/**
 * Weighed-item money math (FR-103) — pure, integer minor units (ADR-004).
 *
 * A weighed product's `priceMinor` / `costMinor` are PER-KG rates. A weighed
 * cart line holds qty = 1 + `qtyG` grams at a per-line unit price of
 * `linePriceForWeight` (owner-overridable like any other line, FR-105).
 * COGS is recorded as a fact at sale time (FR-321) from the per-kg cost —
 * weighed units bypass fractional FIFO layer consumption (documented
 * approximation: the per-kg cost is the current product cost; stock itself
 * stays exact via the ledger's `qty_g_delta`).
 */

/** Per-line unit price for `weightG` grams at a per-kg rate (minor). */
export function linePriceForWeight(pricePerKgMinor: number, weightG: number): number {
  return Math.round((pricePerKgMinor * weightG) / 1000);
}

/** Recorded COGS fact for a weighed line (per-kg cost × grams, minor). */
export function cogsForWeight(costPerKgMinor: number, weightG: number): number {
  return Math.round((costPerKgMinor * weightG) / 1000);
}

/** Human display: 250 → '250 g', 1250 → '1.25 kg'. */
export function formatWeight(weightG: number): string {
  if (weightG >= 1000) {
    const kg = weightG / 1000;
    const s = kg % 1 === 0 ? kg.toFixed(0) : String(kg);
    return `${s} kg`;
  }
  return `${weightG} g`;
}

/**
 * Parse a manual weight entry (kg, one decimal allowed) into grams.
 * '0.25' → 250 · '1' → 1000 · '' → null. Returns null on garbage.
 */
export function parseWeightToG(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const g = Math.round(n * 1000);
  return g > 0 ? g : null;
}
