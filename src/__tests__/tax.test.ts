import { flatRateTaxEngine, taxEngineFor } from '../lib/tax';

/**
 * TaxEngine (FR-108, FR-600, ADR-004) — reference locale SG/SGD/GST 9% inclusive.
 * Money is integer minor units; no float.
 */

describe('flatRateTaxEngine — inclusive (SG GST 9%)', () => {
  const gst = flatRateTaxEngine('flat:sg-gst-9-inclusive', 9, 'inclusive');

  it('extracts tax from a tax-inclusive amount: S$1.09 → S$1.00 + S$0.09', () => {
    const r = gst.compute({ categories: [{ category: 'standard', amountMinor: 109 }] });
    expect(r.taxMinor).toBe(9); // 109 × 9/109 = 9
    expect(r.netMinor).toBe(100);
    expect(r.amountMinor).toBe(109);
    expect(r.ratePct).toBe(9);
  });

  it('extracts tax from S$100.00 inclusive → S$8.26 (825688→826 rounded)', () => {
    const r = gst.compute({ categories: [{ category: 'standard', amountMinor: 10_000 }] });
    expect(r.taxMinor).toBe(826); // 10000 × 9/109 = 825.69 → 826
    expect(r.netMinor).toBe(9174); // 10000 − 826
    expect(r.amountMinor).toBe(10_000);
  });

  it('produces a per-category breakdown (FR-108 receipt breakdown)', () => {
    const r = gst.compute({
      categories: [
        { category: 'standard', amountMinor: 10_900 },
        { category: 'reduced', amountMinor: 5_450 },
      ],
    });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ category: 'standard', amountMinor: 10_900, taxMinor: 900 });
    expect(r.lines[1]).toMatchObject({ category: 'reduced', amountMinor: 5_450, taxMinor: 450 });
    expect(r.taxMinor).toBe(1350); // 900 + 450
  });

  it('skips zero/negative buckets and returns zeros for an empty cart', () => {
    const r = gst.compute({ categories: [{ category: 'standard', amountMinor: 0 }] });
    expect(r.taxMinor).toBe(0);
    expect(r.netMinor).toBe(0);
    expect(r.lines).toHaveLength(0);
  });
});

describe('flatRateTaxEngine — exclusive (added on top)', () => {
  const vat = flatRateTaxEngine('flat:de-vat-19-exclusive', 19, 'exclusive');

  it('adds tax on top of the net amount', () => {
    const r = vat.compute({ categories: [{ category: 'standard', amountMinor: 1000 }] });
    expect(r.taxMinor).toBe(190); // 1000 × 19/100
    expect(r.netMinor).toBe(1000); // net is the input for exclusive
    expect(r.ratePct).toBe(19);
  });
});

describe('flatRateTaxEngine — zero rate', () => {
  const none = flatRateTaxEngine('none', 0, 'inclusive');
  it('passes the amount through with no tax', () => {
    const r = none.compute({ categories: [{ category: 'standard', amountMinor: 5000 }] });
    expect(r.taxMinor).toBe(0);
    expect(r.netMinor).toBe(5000);
  });
});

describe('ratePctOverride (e.g. a temporary 0% promo)', () => {
  it('uses the override rate when provided', () => {
    const gst = flatRateTaxEngine('flat:sg-gst-9-inclusive', 9, 'inclusive');
    const r = gst.compute({ categories: [{ category: 'standard', amountMinor: 1090 }], ratePctOverride: 0 });
    expect(r.taxMinor).toBe(0);
    expect(r.netMinor).toBe(1090);
  });
});

describe('non-reference locales (multi-currency/multi-tax support — FR-600/FR-602)', () => {
  it('MY SST 10% inclusive: RM110.00 → RM100.00 + RM10.00', () => {
    const sst = taxEngineFor('flat:my-sst-10-inclusive');
    expect(sst.ratePct).toBe(10);
    const r = sst.compute({ categories: [{ category: 'standard', amountMinor: 11_000 }] });
    expect(r.taxMinor).toBe(1000); // 11000 × 10/110
    expect(r.netMinor).toBe(10_000);
  });

  it('EU VAT 21% exclusive: €100.00 + €21.00 (switching locale switches the rate)', () => {
    const eu = taxEngineFor('flat:eu-vat-21-exclusive');
    expect(eu.ratePct).toBe(21);
    const r = eu.compute({ categories: [{ category: 'standard', amountMinor: 10_000 }] });
    expect(r.taxMinor).toBe(2100); // 10000 × 21/100
    expect(r.netMinor).toBe(10_000);
  });

  it('custom-built engine id (from Store Settings) resolves: 7.5% inclusive', () => {
    const e = taxEngineFor('flat:custom-7.5-inclusive');
    expect(e.ratePct).toBe(7.5);
    const r = e.compute({ categories: [{ category: 'standard', amountMinor: 10_000 }] });
    expect(r.taxMinor).toBe(698); // 10000 × 7.5/107.5 = 697.67 → 698
    expect(r.netMinor).toBe(10_000 - r.taxMinor);
  });

  it('EU VAT 21% exclusive: €100.00 + €21.00', () => {
    const eu = taxEngineFor('flat:eu-vat-21-exclusive');
    const r = eu.compute({ categories: [{ category: 'standard', amountMinor: 10_000 }] });
    expect(r.taxMinor).toBe(2100);
    expect(r.netMinor).toBe(10_000);
  });
});

describe('taxEngineFor (ADR-004 — rate comes from the engine id, never hardcoded)', () => {
  it('parses flat:sg-gst-9-inclusive → 9% inclusive (the reference locale)', () => {
    const e = taxEngineFor('flat:sg-gst-9-inclusive');
    expect(e.ratePct).toBe(9);
    expect(e.mode).toBe('inclusive');
  });

  it('parses flat:us-sales-8-exclusive → 8% exclusive', () => {
    const e = taxEngineFor('flat:us-sales-8-exclusive');
    expect(e.ratePct).toBe(8);
    expect(e.mode).toBe('exclusive');
  });

  it('parses a decimal rate', () => {
    const e = taxEngineFor('flat:gb-vat-20.5-inclusive');
    expect(e.ratePct).toBe(20.5);
    expect(e.mode).toBe('inclusive');
  });

  it('falls back to a ZERO-rate engine for unknown ids (never invents tax, never crashes)', () => {
    const e = taxEngineFor('mystery-engine');
    expect(e.ratePct).toBe(0);
    const r = e.compute({ categories: [{ category: 'standard', amountMinor: 1000 }] });
    expect(r.taxMinor).toBe(0);
    expect(r.netMinor).toBe(1000);
  });
});
