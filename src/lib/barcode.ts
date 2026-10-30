/**
 * BarcodeParser (FR-103, FR-104, spec §4.4) — the per-locale scale/barcode
 * engine. Pure + unit-testable: no DB, no RN.
 *
 * SG reference implementation (the launch locale):
 *  - **plain** — GTIN-8/12/13/14: exact product lookup by `barcode` /
 *    `carton_barcode` (FR-101/102, FR-322).
 *  - **weighed** — EAN-13 in the GS1 IN-STORE range (first digit `2`, which
 *    covers the spec's "prefix 2/29" — 29xx… is a subset of 2xxx…). Scales
 *    embed the weight in the LAST FIVE digits (grams); the first 8 digits are
 *    the scale/item key the owner stores on the weighed product's `barcode`
 *    field (so `code.startsWith(product.barcode)` matches it).
 *
 * The parser is PLUGGABLE per locale (spec §4.4): `parserForLocale` resolves
 * the engine from the outlet's BCP-47 locale. Other locales fall back to the
 * reference parser (same in-store-range convention, which is the GS1 norm);
 * a locale with a different scale format adds its own `BarcodeParser` here.
 */

export type ParsedBarcode =
  /** Ordinary GTIN — exact barcode match. */
  | { kind: 'plain'; code: string }
  /** Weighed item: `itemKey` matches the product, `weightG` is the weighed amount. */
  | { kind: 'weighed'; code: string; itemKey: string; weightG: number }
  /** Not a recognizable barcode (letters, bad length, …). */
  | { kind: 'unknown'; code: string };

export interface BarcodeParser {
  /** The locale this parser is the reference for (e.g. 'en-SG'). */
  locale: string;
  parse(raw: string): ParsedBarcode;
}

/** EAN-13 in-store range: first digit 2. Weight = last 5 digits (grams). */
const WEIGHT_TAIL_DIGITS = 5;
const WEIGHT_HEAD_DIGITS = 8;

export function parseBarcodeSg(raw: string): ParsedBarcode {
  const code = raw.trim();
  if (!/^\d+$/.test(code)) return { kind: 'unknown', code };

  // GTIN lengths: 8, 12, 13, 14.
  if (code.length === 8 || code.length === 12 || code.length === 14) {
    return { kind: 'plain', code };
  }
  if (code.length === 13) {
    if (code[0] === '2') {
      const tail = code.slice(code.length - WEIGHT_TAIL_DIGITS);
      const weightG = Number(tail);
      // A trailing 00000 means "no weight embedded" (plain in-store price code).
      if (weightG > 0) {
        return { kind: 'weighed', code, itemKey: code.slice(0, WEIGHT_HEAD_DIGITS), weightG };
      }
    }
    return { kind: 'plain', code };
  }
  return { kind: 'unknown', code };
}

export const SG_BARCODE_PARSER: BarcodeParser = {
  locale: 'en-SG',
  parse: parseBarcodeSg,
};

/**
 * Locale → parser registry (pluggable per spec §4.4). Normalized BCP-47
 * (lowercase, '-' → '_'). Unlisted locales fall back to the SG reference —
 * the GS1 in-store-range convention is the cross-locale norm today.
 */
const PARSER_BY_LOCALE: Record<string, BarcodeParser> = {
  'en_sg': SG_BARCODE_PARSER,
  'en_my': SG_BARCODE_PARSER,
};

export function parserForLocale(locale: string | null | undefined): BarcodeParser {
  if (!locale) return SG_BARCODE_PARSER;
  const key = locale.toLowerCase().replace('-', '_');
  return PARSER_BY_LOCALE[key] ?? SG_BARCODE_PARSER;
}
