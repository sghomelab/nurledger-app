/**
 * Money handling — integer minor units only (ADR-004, NFR-8).
 * No float math anywhere on money paths.
 */

/**
 * Zero-decimal ISO-4217 currencies (no subunit in circulation).
 * FR-602: storage stays uniform 1/100 major unit for ALL currencies; only the
 * display rounds to the currency's actual decimal places.
 */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'JPY', 'KRW', 'VND', 'ISK', 'CLP',
]);

/** Format integer minor units as a display string, e.g. 1290 + 'SGD' → 'S$12.90'. */
export function formatMoney(minor: number, currency: string): string {
  try {
    if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(Math.round(minor / 100));
    }
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    // Unknown currency code fallback
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/** Compact variant for tight UI: '12.90' without symbol. */
export function formatMoneyBare(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Round a division of minor units to nearest minor unit.
 * Uses integer math: round(num / den) = floor((num*2 + den) / (den*2)) for positive den.
 */
export function roundDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const sign = (numerator < 0) !== (denominator < 0) && numerator !== 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((n * 2 + d) / (d * 2));
}

/** Percent (integer 0–100+) of a minor-amount, rounded to nearest minor unit. */
export function percentOf(amountMinor: number, percent: number): number {
  return roundDivide(amountMinor * percent, 100);
}

/** Gross margin % from revenue and COGS (both minor). Returns integer percent. */
export function marginPct(revenueMinor: number, cogsMinor: number): number {
  if (revenueMinor <= 0) return 0;
  return roundDivide((revenueMinor - cogsMinor) * 100, revenueMinor);
}

/**
 * Parse a decimal string ("12.5", "12.50", "12") → integer minor units (no float).
 * Invalid/empty input → 0. The inverse of formatMoneyBare.
 */
export function parseMoneyToMinor(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const [whole, frac = ''] = cleaned.split('.');
  const w = parseInt(whole || '0', 10) || 0;
  const f = parseInt((frac + '00').slice(0, 2), 10) || 0;
  return w * 100 + f;
}
