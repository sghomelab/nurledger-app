/**
 * Outlet repository — the store's identity and locale settings (FR-600/FR-602).
 *
 * The outlet carries the ISO currency code, BCP-47 locale, and the tax-engine
 * id. Currency and tax are first-class per-outlet settings, NOT constants:
 * the register computes via the engine resolved from `tax_engine` (tax.ts)
 * and formats via `outlet.currency` (money.ts). Changing them here re-points
 * every screen without touching any product/sale data (owner re-prices as
 * needed — amounts are always integer minor units of the active currency).
 */

import { getDb } from '../db/database';
import type { Outlet } from '../types';

/** The outlet's mutable locale/identity settings (all optional on update). */
export interface OutletSettingsPatch {
  name?: string;
  currency?: string;
  locale?: string;
  taxEngine?: string;
}

export async function getOutlet(): Promise<Outlet | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    id: string; name: string; currency: string; locale: string; tax_engine: string; created_at: number;
  }>('SELECT id, name, currency, locale, tax_engine, created_at FROM outlet LIMIT 1');
  if (!row) return null;
  return {
    id: row.id, name: row.name, currency: row.currency, locale: row.locale,
    taxEngine: row.tax_engine, createdAt: row.created_at,
  };
}

/**
 * Apply a partial settings patch to the outlet. Only provided fields change.
 * Returns the updated outlet (null if no outlet exists — first-run seed
 * guarantees one, so this is defensive).
 */
export async function updateOutlet(patch: OutletSettingsPatch): Promise<Outlet | null> {
  const current = await getOutlet();
  if (!current) return null;

  const name = patch.name?.trim() || current.name;
  const currency = patch.currency?.trim().toUpperCase() || current.currency;
  const locale = patch.locale?.trim() || current.locale;
  const taxEngine = patch.taxEngine ?? current.taxEngine;

  const db = await getDb();
  await db.runAsync(
    'UPDATE outlet SET name = ?, currency = ?, locale = ?, tax_engine = ? WHERE id = ?',
    [name, currency, locale, taxEngine, current.id],
  );

  return { ...current, name, currency, locale, taxEngine };
}
