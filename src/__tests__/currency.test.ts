import {
  CURRENCY_OPTIONS,
  TAX_PRESETS,
  NO_TAX_ENGINE_ID,
  buildCustomEngineId,
  isFormattableCurrency,
  isZeroDecimal,
  isValidCustomRate,
  normalizeCurrencyCode,
  taxEngineLabel,
} from '../lib/currency';
import { taxEngineFor } from '../lib/tax';

/**
 * Currency + tax-locale catalogs (FR-600, FR-602).
 * The catalogs are data; behavior flows through taxEngineFor + formatMoney.
 */

describe('normalizeCurrencyCode', () => {
  it('uppercases and trims valid codes', () => {
    expect(normalizeCurrencyCode('myr ')).toBe('MYR');
    expect(normalizeCurrencyCode(' usd')).toBe('USD');
  });

  it('rejects anything that is not a 3-letter code', () => {
    expect(normalizeCurrencyCode('SG')).toBe('');
    expect(normalizeCurrencyCode('SGDX')).toBe('');
    expect(normalizeCurrencyCode('S$')).toBe('');
    expect(normalizeCurrencyCode('')).toBe('');
  });
});

describe('CURRENCY_OPTIONS', () => {
  it('lists unique, well-formed ISO codes (SGD first — the reference locale)', () => {
    expect(CURRENCY_OPTIONS.length).toBeGreaterThanOrEqual(15);
    const first = CURRENCY_OPTIONS[0]!;
    expect(first.code).toBe('SGD');
    const codes = CURRENCY_OPTIONS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of CURRENCY_OPTIONS) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(isFormattableCurrency(c.code)).toBe(true);
    }
  });
});

describe('isFormattableCurrency / isZeroDecimal', () => {
  it('accepts real ISO codes and rejects garbage', () => {
    expect(isFormattableCurrency('SGD')).toBe(true);
    expect(isFormattableCurrency('TWD')).toBe(true);
    expect(isFormattableCurrency('QQ1')).toBe(false);
  });

  it('flags the zero-decimal set', () => {
    expect(isZeroDecimal('JPY')).toBe(true);
    expect(isZeroDecimal('VND')).toBe(true);
    expect(isZeroDecimal('SGD')).toBe(false);
  });
});

describe('TAX_PRESETS (data, not hardcoded math)', () => {
  it('every preset engine id resolves to a concrete TaxEngine with the advertised rate', () => {
    for (const p of TAX_PRESETS) {
      const e = taxEngineFor(p.engineId);
      if (p.id === 'none') {
        expect(e.ratePct).toBe(0);
      } else {
        expect(e.ratePct).toBeGreaterThan(0);
      }
      // idempotent: label round-trips
      expect(taxEngineLabel(p.engineId)).toBe(p.label);
    }
  });

  it('includes the SG reference locale and a no-tax option', () => {
    expect(TAX_PRESETS.some((p) => p.engineId === 'flat:sg-gst-9-inclusive')).toBe(true);
    expect(TAX_PRESETS.some((p) => p.engineId === NO_TAX_ENGINE_ID)).toBe(true);
  });
});

describe('buildCustomEngineId + isValidCustomRate', () => {
  it('builds a resolvable flat engine id', () => {
    const id = buildCustomEngineId(7.75, 'exclusive');
    expect(id).toBe('flat:custom-7.75-exclusive');
    const e = taxEngineFor(id);
    expect(e.ratePct).toBe(7.75);
    expect(e.mode).toBe('exclusive');
  });

  it('accepts 0–40 with up to 2 decimals', () => {
    expect(isValidCustomRate('0')).toBe(true);
    expect(isValidCustomRate('7.75')).toBe(true);
    expect(isValidCustomRate('40')).toBe(true);
    expect(isValidCustomRate('40.01')).toBe(false);
    expect(isValidCustomRate('100')).toBe(false);
    expect(isValidCustomRate('7.755')).toBe(false);
    expect(isValidCustomRate('abc')).toBe(false);
    expect(isValidCustomRate('')).toBe(false);
  });
});

describe('taxEngineLabel (display for settings/operator surfaces)', () => {
  it('labels preset ids', () => {
    expect(taxEngineLabel('flat:sg-gst-9-inclusive')).toBe('Singapore GST 9% — inclusive');
    expect(taxEngineLabel(NO_TAX_ENGINE_ID)).toBe('No tax (zero rate)');
  });

  it('labels non-preset flat ids generically', () => {
    expect(taxEngineLabel('flat:custom-7.5-inclusive')).toBe('Custom 7.5% inclusive');
    expect(taxEngineLabel('flat:au-gst-10-exclusive')).toBe('Custom 10% exclusive');
  });

  it('falls back to No tax for unrecognized ids (matches the zero-rate engine)', () => {
    expect(taxEngineLabel('mystery')).toBe('No tax');
    expect(taxEngineLabel('')).toBe('No tax');
  });
});
