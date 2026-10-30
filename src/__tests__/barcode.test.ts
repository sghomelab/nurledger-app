/**
 * BarcodeParser tests (FR-103, FR-104, FR-603) — the per-locale scale engine.
 *
 * SG reference rules (GS1 norm):
 *  - plain GTIN-8/12/13/14 → exact product match
 *  - EAN-13 in the in-store range (first digit '2') with a non-zero 5-digit
 *    weight tail → weighed (itemKey = first 8 digits, weightG = last 5)
 */

import { parserForLocale, parseBarcodeSg, type ParsedBarcode } from '../lib/barcode';

describe('parseBarcodeSg — plain GTINs (FR-101/102, FR-322)', () => {
  it('accepts GTIN-8, 12, 13 (trade), 14', () => {
    expect(parseBarcodeSg('02111111')).toEqual({ kind: 'plain', code: '02111111' });
    expect(parseBarcodeSg('021111111111')).toEqual({ kind: 'plain', code: '021111111111' });
    expect(parseBarcodeSg('8991234567890')).toEqual({ kind: 'plain', code: '8991234567890' });
    expect(parseBarcodeSg('12345678901234')).toEqual({ kind: 'plain', code: '12345678901234' });
  });

  it('trims scanner whitespace', () => {
    expect(parseBarcodeSg('  8991234567890  ')).toEqual({ kind: 'plain', code: '8991234567890' });
  });
});

describe('parseBarcodeSg — weighed EAN-13 in-store (FR-104: prefix 2, weight = last 5 digits)', () => {
  it('parses weight from the 5-digit tail, itemKey = first 8 digits', () => {
    // 20012345 + 250 g
    expect(parseBarcodeSg('2001234500250')).toEqual({
      kind: 'weighed', code: '2001234500250', itemKey: '20012345', weightG: 250,
    });
    // 1.25 kg
    const r = parseBarcodeSg('2901234501250');
    expect(r).toEqual({ kind: 'weighed', code: '2901234501250', itemKey: '29012345', weightG: 1250 });
  });

  it('the spec\'s "29" prefix is a subset of the in-store range (2xxx…)', () => {
    const r = parseBarcodeSg('2900000000500');
    expect(r.kind).toBe('weighed');
    if (r.kind === 'weighed') expect(r.weightG).toBe(500);
  });

  it('all-zero tail = plain in-store price code (no weight embedded)', () => {
    expect(parseBarcodeSg('2001234500000')).toEqual({ kind: 'plain', code: '2001234500000' });
  });

  it('an EAN-13 starting with 2 and an all-zero tail is plain (in-store price code)', () => {
    const r = parseBarcodeSg('2999999000000');
    expect(r).toEqual({ kind: 'plain', code: '2999999000000' });
  });
});

describe('parseBarcodeSg — unrecognized input', () => {
  const unknowns = ['ABC', '12A34', '12345', '123456789012345', ''];
  for (const code of unknowns) {
    it(`rejects ${JSON.stringify(code)}`, () => {
      expect(parseBarcodeSg(code).kind).toBe('unknown');
    });
  }
});

describe('parserForLocale (FR-603 pluggable registry)', () => {
  it('resolves en-SG and en-MY to a working parser', () => {
    for (const locale of ['en-SG', 'en-MY', 'my-MY', null, undefined, 'xx-XX']) {
      const p = parserForLocale(locale);
      const r: ParsedBarcode = p.parse('2001234500250');
      expect(r.kind).toBe('weighed');
    }
  });

  it('registry keys are normalized (case, dash/underscore)', () => {
    expect(parserForLocale('EN_SG').parse('8991234567890').kind).toBe('plain');
    expect(parserForLocale('en.sg').parse('8991234567890').kind).toBe('plain');
  });
});
