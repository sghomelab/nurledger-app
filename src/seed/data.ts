/**
 * Seed data — 6 categories + 11 products from PROTOTYPE-REFERENCE §9.
 * Values are extracted verbatim from the KitePOS prototype bundle (2026-10-30).
 *
 * ADR-004: the prototype's USD prices are DEMO FIXTURES carried over as-is;
 * the app's reference outlet is SG/SGD (GST 9% inclusive). All amounts here
 * are converted to integer minor units.
 */

export interface SeedCategory {
  name: string;
}

export interface SeedProduct {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  costMinor: number;
  priceMinor: number;
  stock: number;
  reorderPoint: number;
  maxQty: number;
  unit: string;
  expiryDate: string;
  batchNumber: string;
  velocityClass: 'A' | 'B' | 'C';
  description: string;
  /** Prototype updatedAt, used as the seed ledger timestamp. */
  updatedAt: string;
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: 'Pantry & Staples' },
  { name: 'Fresh & Bakery' },
  { name: 'Beverages' },
  { name: 'Snacks' },
  { name: 'Personal Care' },
  { name: 'Household' },
];

const M = (dollars: number): number => Math.round(dollars * 100);

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    sku: 'BEV-COLD-01', barcode: '012000000133', name: 'Nitro Cold Brew Coffee 330ml',
    category: 'Beverages', costMinor: M(1.85), priceMinor: M(4.5), stock: 42,
    reorderPoint: 15, maxQty: 48, unit: 'can', expiryDate: '2026-11-04',
    batchNumber: 'BT-2610A', velocityClass: 'A',
    description: 'Single-origin Ethiopian cold brew with nitrogen infusion',
    updatedAt: '2026-10-25T10:00:00Z',
  },
  {
    sku: 'BEV-SPARK-02', barcode: '012000000249', name: 'Sparkling Mineral Water Lime 500ml',
    category: 'Beverages', costMinor: M(0.75), priceMinor: M(2.25), stock: 78,
    reorderPoint: 20, maxQty: 96, unit: 'bottle', expiryDate: '2027-04-15',
    batchNumber: 'BT-2704L', velocityClass: 'A',
    description: 'Natural mineral spring water with organic Mexican lime essence',
    updatedAt: '2026-10-20T14:30:00Z',
  },
  {
    sku: 'BEV-OAT-03', barcode: '012000000355', name: 'Barista Oat Milk 1L',
    category: 'Beverages', costMinor: M(2.1), priceMinor: M(4.95), stock: 24,
    reorderPoint: 12, maxQty: 36, unit: 'carton', expiryDate: '2026-11-02',
    batchNumber: 'BT-2611O', velocityClass: 'A',
    description: 'Creamy foamable oat milk designed for specialty espresso',
    updatedAt: '2026-10-22T09:15:00Z',
  },
  {
    sku: 'BEV-KOMBU-04', barcode: '012000000461', name: 'Raw Ginger Lemon Kombucha 350ml',
    category: 'Beverages', costMinor: M(1.95), priceMinor: M(4.75), stock: 31,
    reorderPoint: 10, maxQty: 40, unit: 'bottle', expiryDate: '2026-11-18',
    batchNumber: 'BT-2611K', velocityClass: 'B',
    description: 'Live probiotic fermented tea with cold-pressed ginger and lemon',
    updatedAt: '2026-10-18T16:00:00Z',
  },
  {
    sku: 'BAK-SOUR-01', barcode: '023000000578', name: 'Artisan Country Sourdough Loaf',
    category: 'Fresh & Bakery', costMinor: M(2.4), priceMinor: M(6.5), stock: 8,
    reorderPoint: 10, maxQty: 30, unit: 'loaf', expiryDate: '2026-10-31',
    batchNumber: 'BK-261028', velocityClass: 'A',
    description: '36-hour slow fermented wild yeast rustic sourdough loaf',
    updatedAt: '2026-10-28T05:00:00Z',
  },
  {
    sku: 'BAK-CROIS-02', barcode: '023000000684', name: 'French Butter Croissant',
    category: 'Fresh & Bakery', costMinor: M(1.2), priceMinor: M(3.5), stock: 14,
    reorderPoint: 10, maxQty: 40, unit: 'pcs', expiryDate: '2026-10-30',
    batchNumber: 'BK-261029', velocityClass: 'A',
    description: 'Laminated with AOP Isigny French butter, crisp flaky layers',
    updatedAt: '2026-10-28T06:00:00Z',
  },
  {
    sku: 'FRESH-YOG-03', barcode: '023000000790', name: 'Organic Greek Strained Yogurt 500g',
    category: 'Fresh & Bakery', costMinor: M(2.8), priceMinor: M(5.95), stock: 19,
    reorderPoint: 8, maxQty: 24, unit: 'tub', expiryDate: '2026-11-12',
    batchNumber: 'GY-2611A', velocityClass: 'B',
    description: 'Grass-fed whole milk Greek yogurt with 18g protein per serving',
    updatedAt: '2026-10-24T11:20:00Z',
  },
  {
    sku: 'FRESH-CHED-04', barcode: '023000000806', name: 'Aged Vermont White Cheddar 200g',
    category: 'Fresh & Bakery', costMinor: M(3.9), priceMinor: M(8.5), stock: 22,
    reorderPoint: 8, maxQty: 30, unit: 'block', expiryDate: '2027-01-20',
    batchNumber: 'CH-2701V', velocityClass: 'B',
    description: 'Sharp aged cheddar aged 18 months, crystal-rich texture',
    updatedAt: '2026-10-15T13:40:00Z',
  },
  {
    sku: 'PAN-OIL-01', barcode: '034000000912', name: 'Cold Pressed EV Olive Oil 500ml',
    category: 'Pantry & Staples', costMinor: M(7.5), priceMinor: M(16.95), stock: 35,
    reorderPoint: 10, maxQty: 48, unit: 'bottle', expiryDate: '2027-09-30',
    batchNumber: 'OL-2709S', velocityClass: 'B',
    description: 'Single-estate early harvest Koroneiki olives, low acidity',
    updatedAt: '2026-10-12T08:00:00Z',
  },
  {
    sku: 'PAN-PASTA-02', barcode: '034000001025', name: 'Bronze Die Rigatoni Pasta 500g',
    category: 'Pantry & Staples', costMinor: M(1.6), priceMinor: M(4.25), stock: 54,
    reorderPoint: 15, maxQty: 72, unit: 'pack', expiryDate: '2027-12-31',
    batchNumber: 'PA-2712G', velocityClass: 'B',
    description: '100% Italian durum wheat semolina, rough bronze extruded surface',
    updatedAt: '2026-10-10T15:20:00Z',
  },
  {
    sku: 'PAN-COFFEE-03', barcode: '034000001131', name: 'Whole Bean House Blend Coffee 340g',
    category: 'Pantry & Staples', costMinor: M(6.2), priceMinor: M(15.0), stock: 28,
    reorderPoint: 10, maxQty: 40, unit: 'bag', expiryDate: '2027-03-15',
    batchNumber: 'CF-2703W', velocityClass: 'C',
    description: 'Medium roast notes of milk chocolate, toasted hazelnut and stone fruit',
    updatedAt: '2026-10-21T10:30:00Z',
  },
];

/** Reference outlet — SG/SGD/GST 9% inclusive (spec: one reference locale, ADR-004). */
export const SEED_OUTLET = {
  name: 'My Provision Store',
  currency: 'SGD',
  locale: 'en-SG',
  taxEngine: 'flat:sg-gst-9-inclusive',
};
