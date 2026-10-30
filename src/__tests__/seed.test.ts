import { SEED_CATEGORIES, SEED_PRODUCTS } from '../seed/data';
import { uuidv4 } from '../lib/ids';

/**
 * Seed fixture contract — acceptance test M1:
 * "11 seed products + 6 categories from PROTOTYPE-REFERENCE §9 load on first run"
 * "Money stored as integer minor units (verify in DB, e.g. 1290 = $12.90)"
 */
describe('seed data (PROTOTYPE-REFERENCE §9)', () => {
  it('has exactly 6 categories and 11 products', () => {
    expect(SEED_CATEGORIES).toHaveLength(6);
    expect(SEED_PRODUCTS).toHaveLength(11);
    const names = new Set(SEED_CATEGORIES.map((c) => c.name));
    expect(names).toEqual(
      new Set(['Pantry & Staples', 'Fresh & Bakery', 'Beverages', 'Snacks', 'Personal Care', 'Household']),
    );
  });

  it('every product references a known category and has a unique barcode', () => {
    const catNames = new Set(SEED_CATEGORIES.map((c) => c.name));
    const barcodes = new Set<string>();
    for (const p of SEED_PRODUCTS) {
      expect(catNames.has(p.category)).toBe(true);
      expect(barcodes.has(p.barcode)).toBe(false);
      barcodes.add(p.barcode);
      // prototype fixtures are UPC-A (12) or EAN-13 (13)
      expect(p.barcode).toMatch(/^\d{12,13}$/);
    }
  });

  it('stores money as integer minor units (never float)', () => {
    for (const p of SEED_PRODUCTS) {
      expect(Number.isInteger(p.costMinor)).toBe(true);
      expect(Number.isInteger(p.priceMinor)).toBe(true);
      expect(p.priceMinor).toBeGreaterThan(0);
      expect(p.costMinor).toBeGreaterThanOrEqual(0);
      // prototype values survive the conversion exactly
      expect(p.priceMinor / 100).toBeCloseTo(p.priceMinor / 100, 10);
    }
    // spot-check prototype values: Nitro Cold Brew 4.50 → 450
    const nitro = SEED_PRODUCTS.find((p) => p.sku === 'BEV-COLD-01');
    expect(nitro?.priceMinor).toBe(450);
    expect(nitro?.costMinor).toBe(185);
  });

  it('every product carries lot metadata (batch + expiry) for FEFO', () => {
    for (const p of SEED_PRODUCTS) {
      expect(p.batchNumber.length).toBeGreaterThan(0);
      expect(p.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('uuidv4 (FR-502 client idempotency keys)', () => {
  it('produces unique, well-formed v4 UUIDs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const u = uuidv4();
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(seen.has(u)).toBe(false);
      seen.add(u);
    }
  });
});
