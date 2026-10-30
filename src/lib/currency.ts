/**
 * Currency + tax-locale catalogs (FR-600, FR-602, ADR-004).
 *
 * Pure data + pure helpers — no DB/RN imports. The catalogs are DATA, not
 * logic: they list convenient choices the owner can pick in Store Settings,
 * and the ACTUAL behavior still flows through the TaxEngine (tax.ts) resolved
 * from the outlet's engine id. Anything not listed can be entered free-form
 * (any ISO-4217 code, any flat rate), so no country or rate is hardcoded
 * into the register.
 *
 * The reference locale (SG / SGD / GST 9% inclusive) is just the FIRST preset
 * and the seed default (ADR-004) — not a constant the register depends on.
 */

import { ZERO_DECIMAL_CURRENCIES } from './money';
import type { TaxMode } from './tax';

export interface CurrencyOption {
  /** ISO-4217 code. */
  code: string;
  /** Display name. */
  name: string;
}

/**
 * Curated picker list (region-relevant first, then majors). Zero-decimal
 * codes (JPY/KRW/VND) are included — display handles them (see money.ts).
 * Anything else is accepted via the free-form "Other" entry.
 */
export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'VND', name: 'Vietnamese Dong' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'BDT', name: 'Bangladeshi Taka' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'MOP', name: 'Macanese Pataca' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
];

/** Normalize a free-form currency entry to an uppercase ISO code ('' if invalid). */
export function normalizeCurrencyCode(input: string): string {
  const code = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

/** True when Intl can format the code (i.e. it is a recognized currency). */
export function isFormattableCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** True when the currency has no subunit (display rounds to whole units). */
export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency);
}

export interface TaxPreset {
  /** Stable preset id (UI key). */
  id: string;
  /** Human label shown in the picker. */
  label: string;
  /** The engine id stored on the outlet (behavior lives in tax.ts). */
  engineId: string;
  /** Suggested currency when the preset is applied (owner can override). */
  suggestedCurrency: string | null;
  /** Suggested BCP-47 locale when the preset is applied. */
  suggestedLocale: string;
}

/**
 * Convenience tax presets. These are selectable DATA — the register only ever
 * computes via the engine id, and any unlisted rate is available through the
 * custom-rate entry (no hardcoded country/tax in the math).
 */
export const TAX_PRESETS: TaxPreset[] = [
  {
    id: 'none',
    label: 'No tax (zero rate)',
    engineId: 'none',
    suggestedCurrency: null,
    suggestedLocale: 'en',
  },
  {
    id: 'sg',
    label: 'Singapore GST 9% — inclusive',
    engineId: 'flat:sg-gst-9-inclusive',
    suggestedCurrency: 'SGD',
    suggestedLocale: 'en-SG',
  },
  {
    id: 'my',
    label: 'Malaysia SST 10% — inclusive',
    engineId: 'flat:my-sst-10-inclusive',
    suggestedCurrency: 'MYR',
    suggestedLocale: 'en-MY',
  },
  {
    id: 'us',
    label: 'US flat sales tax 8.25% — exclusive',
    engineId: 'flat:us-sales-8.25-exclusive',
    suggestedCurrency: 'USD',
    suggestedLocale: 'en-US',
  },
  {
    id: 'eu',
    label: 'EU VAT 21% — exclusive',
    engineId: 'flat:eu-vat-21-exclusive',
    suggestedCurrency: 'EUR',
    suggestedLocale: 'en',
  },
];

/** Engine id for the zero-tax preset (resolves to the zero-rate engine). */
export const NO_TAX_ENGINE_ID = 'none';

/** Build a custom flat-rate engine id, e.g. (7.5, 'inclusive') → 'flat:custom-7.5-inclusive'. */
export function buildCustomEngineId(ratePct: number, mode: TaxMode): string {
  return `flat:custom-${ratePct}-${mode}`;
}

/** True when a custom rate entry is valid: 0–40 with up to 2 decimals. */
export function isValidCustomRate(input: string): boolean {
  const m = /^(\d{1,2})(\.\d{1,2})?$/.exec(input.trim());
  if (!m) return false;
  const rate = Number.parseFloat(input.trim());
  return Number.isFinite(rate) && rate >= 0 && rate <= 40;
}

/**
 * Human label for an outlet's engine id (settings + operator surfaces).
 * Preset ids get their preset label; `flat:<label>-<rate>-<mode>` ids get
 * "Custom X% inclusive/exclusive"; anything unrecognized → "No tax".
 */
export function taxEngineLabel(engineId: string): string {
  const preset = TAX_PRESETS.find((p) => p.engineId === engineId);
  if (preset) return preset.label;
  const m = /^flat:(.+)-(\d+(?:\.\d+)?)-(inclusive|exclusive)$/.exec(engineId);
  if (m) return `Custom ${m[2]}% ${m[3]}`;
  return 'No tax';
}
