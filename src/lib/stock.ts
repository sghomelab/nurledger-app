/**
 * Pure stock & costing math (FR-316, FR-319, FR-321, ADR-002/003).
 * Kept dependency-free (type-only import) so it is unit-testable in node.
 */

import type { ExpiryRadarSummary, ExpiryUrgency } from '../types';
import { marginPct } from './money';

export interface LayerInput {
  id: string;
  unitCostMinor: number;
  qtyRemaining: number;
  receivedAt: number;
}

export interface ConsumeResult {
  /** Which layer lost how much, oldest first. */
  consumed: Array<{ layerId: string; qty: number; unitCostMinor: number }>;
  /** Total COGS in minor units. */
  cogsMinor: number;
  /** True if requested qty exceeded available layers (oversell guard). */
  short: boolean;
  /** Shortage in base units. */
  shortageQty: number;
}

/**
 * FIFO consumption (ADR-003, spec §4.3.1): consume the oldest layer first.
 * Layers are matched by receivedAt then id for deterministic ordering.
 */
export function consumeFifo(layers: LayerInput[], qty: number): ConsumeResult {
  const ordered = [...layers]
    .filter((l) => l.qtyRemaining > 0)
    .sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id));

  const consumed: ConsumeResult['consumed'] = [];
  let remaining = qty;
  let cogsMinor = 0;

  for (const layer of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(layer.qtyRemaining, remaining);
    if (take > 0) {
      consumed.push({ layerId: layer.id, qty: take, unitCostMinor: layer.unitCostMinor });
      cogsMinor += take * layer.unitCostMinor;
      remaining -= take;
    }
  }

  return {
    consumed,
    cogsMinor,
    short: remaining > 0,
    shortageQty: remaining,
  };
}

/** Apply a ConsumeResult back into layer rows (returns new qty_remaining map). */
export function applyConsumption(
  layers: LayerInput[],
  result: ConsumeResult,
): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const l of layers) remaining.set(l.id, l.qtyRemaining);
  for (const c of result.consumed) {
    const cur = remaining.get(c.layerId);
    if (cur !== undefined) remaining.set(c.layerId, cur - c.qty);
  }
  return remaining;
}

/** Project on-hand stock from immutable ledger rows (ADR-002). */
export function projectStock(qtyDeltas: Array<number | null>): number {
  return qtyDeltas.reduce<number>((sum, d) => sum + (d ?? 0), 0);
}

export type StockStatus = 'in_stock' | 'low_stock' | 'depleted' | 'sold_out';

/**
 * Prototype status chips (PROTOTYPE-REFERENCE §4):
 * In Stock / Low Stock / Depleted / Sold Out.
 * - qty <= 0 and product active → 'depleted'
 * - qty <= 0 and product inactive → 'sold_out'
 * - qty <= reorderPoint → 'low_stock'
 * - else → 'in_stock'
 */
export function stockStatus(qty: number, reorderPoint: number, active: boolean): StockStatus {
  if (qty <= 0) return active ? 'depleted' : 'sold_out';
  if (qty <= reorderPoint) return 'low_stock';
  return 'in_stock';
}

/** FEFO: earliest-expiry-first ranking (nulls last, then receivedAt). */
export function fefoRank<T extends { expiryDate: string | null; receivedAt: number; id: string }>(
  lots: T[],
): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiryDate === null && b.expiryDate === null) return a.receivedAt - b.receivedAt;
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    const cmp = a.expiryDate.localeCompare(b.expiryDate);
    return cmp !== 0 ? cmp : a.receivedAt - b.receivedAt;
  });
}

/**
 * Reorder suggestion (FR-308, Min/Max policy): when on-hand < min,
 * suggest qty = max − on-hand. Returns 0 when nothing to suggest.
 */
export function reorderSuggestion(onHand: number, minQty: number, maxQty: number): number {
  if (onHand >= minQty) return 0;
  return Math.max(0, maxQty - onHand);
}

/**
 * Calendar days until expiry (date-only): 0 = expires today, negative = expired.
 */
export function daysUntil(expiryDate: string, now: Date = new Date()): number {
  const [y, m, d] = expiryDate.split('-').map(Number);
  if (!y || !m || !d) return Number.POSITIVE_INFINITY;
  const expMidnight = new Date(y, m - 1, d).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((expMidnight - nowMidnight) / 86_400_000);
}

/** Default FEFO urgency windows (calendar days). FR-307 / prototype §5. */
export const EXPIRY_THRESHOLDS = { criticalDays: 7, soonDays: 30 } as const;

export interface ExpiryThresholds {
  /** Expired-or-within-this-many-days → 'critical' (rose). */
  criticalDays: number;
  /** Within this many days → 'soon' (amber). */
  soonDays: number;
}

/**
 * Urgency band from days-until-expiry. FR-307 / prototype §5:
 * expired (rose) · critical (≤ criticalDays, rose) · soon (≤ soonDays, amber) · ok.
 */
export function expiryUrgency(
  daysLeft: number,
  th: ExpiryThresholds = EXPIRY_THRESHOLDS,
): ExpiryUrgency {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= th.criticalDays) return 'critical';
  if (daysLeft <= th.soonDays) return 'soon';
  return 'ok';
}

/** Expiring / Expired / Other breakdown + expired-waste qty (prototype §5). */
export function summarizeRadar(
  entries: Array<{ qtyRemaining: number; urgency: ExpiryUrgency }>,
): ExpiryRadarSummary {
  let expiredQty = 0;
  let expiringQty = 0;
  let otherQty = 0;
  for (const e of entries) {
    if (e.urgency === 'expired') expiredQty += e.qtyRemaining;
    else if (e.urgency === 'critical' || e.urgency === 'soon') expiringQty += e.qtyRemaining;
    else otherQty += e.qtyRemaining;
  }
  return {
    expiredQty,
    expiringQty,
    otherQty,
    expiredWasteQty: expiredQty,
    batchCount: entries.length,
  };
}

// ── FR-320: margin compression (cost layer vs stable selling price) ─────────

export interface MarginAnalysis {
  /** Unit cost of the OLDEST layer — the cost the price was originally set against. */
  baselineCostMinor: number;
  /** Unit cost of the NEWEST layer (most recent receipt, whether or not it has qty left). */
  currentCostMinor: number;
  /** Margin % at the baseline cost. */
  baselineMarginPct: number;
  /** Margin % at the current (newest) cost. */
  currentMarginPct: number;
  /** True when the newest cost has risen above the baseline, compressing the margin. */
  compressed: boolean;
  /**
   * Suggested price (minor units) that would restore the baseline margin at the
   * current cost: `price × (1 − baselineMarginPct/100)` recomputed off the newest
   * cost → `newCost / (1 − baselineMargin)`. null when not worth suggesting.
   */
  suggestedPriceMinor: number | null;
}

/**
 * FR-320: compare a product's FIFO cost layers against its owner-set selling
 * price. The price is NEVER auto-derived (ADR-003) — this only SURFACES margin
 * compression and SUGGESTS a reprice to hold the original (baseline) margin.
 * Applying the suggestion is a separate, owner-confirmed step (UI gate).
 *
 * Baseline = oldest layer (what the price was set against). Current = newest
 * layer (the cost future sales will draw from once older layers deplete).
 */
export function analyzeMargin(priceMinor: number, layers: LayerInput[]): MarginAnalysis {
  const none: MarginAnalysis = {
    baselineCostMinor: 0,
    currentCostMinor: 0,
    baselineMarginPct: 0,
    currentMarginPct: 0,
    compressed: false,
    suggestedPriceMinor: null,
  };
  if (priceMinor <= 0 || layers.length === 0) return none;

  // FIFO order (oldest first) — same rule as consumeFifo.
  const ordered = [...layers].sort(
    (a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id),
  );
  const baseline = ordered[0]!;
  const current = ordered[ordered.length - 1]!;

  const baselineMarginPct = marginPct(priceMinor, baseline.unitCostMinor);
  const currentMarginPct = marginPct(priceMinor, current.unitCostMinor);
  const compressed = current.unitCostMinor > baseline.unitCostMinor;

  // Suggest a price that holds the baseline margin at the current cost.
  // margin = (P − C)/P = baselineMargin  →  P = C / (1 − baselineMargin).
  let suggestedPriceMinor: number | null = null;
  if (compressed && baselineMarginPct > 0 && baselineMarginPct < 100) {
    const keep = 100 - baselineMarginPct; // cost is (100 − margin)% of price
    suggestedPriceMinor = Math.ceil((current.unitCostMinor * 100) / keep);
  }

  return {
    baselineCostMinor: baseline.unitCostMinor,
    currentCostMinor: current.unitCostMinor,
    baselineMarginPct,
    currentMarginPct,
    compressed,
    suggestedPriceMinor,
  };
}
