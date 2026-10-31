/**
 * FR-314 (M6) — product CSV import/export. Pure round-trip + validation
 * tests: serialize → parse must be lossless for clean data, and every
 * documented validation rule gets a case (money in major units, strict
 * integers, enums, duplicate SKUs, zero-decimal currencies, quoting).
 */

import {
  parseProductsCsv,
  planProductImport,
  PRODUCT_CSV_HEADER,
  serializeProductsToCsv,
  splitCsv,
  type ParsedProductRow,
} from '../lib/productCsv';
import type { Product } from '../types';

const C = 'SGD';

function mkProduct(over: Partial<Product>): Product {
  return {
    id: 'p1',
    outletId: 'o1',
    sku: 'BEV-OAT-03',
    name: 'Barista Oat Milk 1L',
    categoryId: 'c1',
    unitType: 'each',
    isWeighed: false,
    barcode: '012000000355',
    cartonBarcode: '012000000362',
    cartonSize: 6,
    supplierId: null,
    costMinor: 320,
    priceMinor: 550,
    taxCategory: 'standard',
    minQty: 12,
    maxQty: 24,
    velocityClass: 'A',
    description: 'Plain oat milk',
    active: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const catName = (id: string | null) => (id === 'c1' ? 'Beverages' : null);

describe('splitCsv', () => {
  it('splits simple rows', () => {
    expect(splitCsv('a,b,c\nd,e,f')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('handles CRLF and lone CR', () => {
    expect(splitCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(splitCsv('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(splitCsv('\uFEFFsku,name')).toEqual([['sku', 'name']]);
  });

  it('supports commas, quotes and newlines inside quoted fields', () => {
    expect(splitCsv('"x,y","say ""hi""","a\nb"')).toEqual([['x,y', 'say "hi"', 'a\nb']]);
  });

  it('does not create a trailing row for a final newline', () => {
    expect(splitCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('empty string → no rows', () => {
    expect(splitCsv('')).toEqual([]);
  });
});

describe('serializeProductsToCsv', () => {
  it('writes the canonical header + one row per product (money in major units)', () => {
    const csv = serializeProductsToCsv([mkProduct({})], catName, C);
    const rows = splitCsv(csv);
    expect(rows[0]).toEqual([...PRODUCT_CSV_HEADER]);
    expect(rows[1]).toEqual([
      'BEV-OAT-03',
      'Barista Oat Milk 1L',
      'Beverages',
      '012000000355',
      '012000000362',
      '6',
      'each',
      '3.20',
      '5.50',
      '12',
      '24',
      'A',
      'Plain oat milk',
      '1',
    ]);
  });

  it('escapes commas and quotes in name/description', () => {
    const csv = serializeProductsToCsv(
      [mkProduct({ name: 'Milk, full-cream', description: 'Say "hi"' })],
      catName,
      C,
    );
    const rows = splitCsv(csv);
    expect(rows[1]![1]).toBe('Milk, full-cream');
    expect(rows[1]![12]).toBe('Say "hi"');
  });

  it('writes whole numbers for zero-decimal currencies', () => {
    const csv = serializeProductsToCsv([mkProduct({ costMinor: 50000, priceMinor: 80000 })], catName, 'JPY');
    const rows = splitCsv(csv);
    expect(rows[1]![7]).toBe('500');
    expect(rows[1]![8]).toBe('800');
  });

  it('writes 0 for the active flag of deactivated products', () => {
    const csv = serializeProductsToCsv([mkProduct({ active: false })], catName, C);
    expect(splitCsv(csv)[1]![13]).toBe('0');
  });
});

describe('parseProductsCsv — happy path', () => {
  it('round-trips serialized products losslessly', () => {
    const products = [
      mkProduct({}),
      mkProduct({
        id: 'p2',
        sku: 'DRY-FLR-01',
        name: 'Basmati Rice 5kg',
        categoryId: null,
        barcode: null,
        cartonBarcode: null,
        cartonSize: 1,
        costMinor: 1800,
        priceMinor: 2950,
        minQty: 4,
        maxQty: 10,
        velocityClass: null,
        description: null,
        active: false,
      }),
    ];
    const parsed = parseProductsCsv(serializeProductsToCsv(products, catName, C), C);
    expect(parsed.fatal).toBeNull();
    expect(parsed.okCount).toBe(2);
    expect(parsed.errorCount).toBe(0);
    const first = parsed.rows[0]!.row as ParsedProductRow;
    expect(first).toMatchObject({
      sku: 'BEV-OAT-03',
      name: 'Barista Oat Milk 1L',
      categoryName: 'Beverages',
      barcode: '012000000355',
      cartonBarcode: '012000000362',
      cartonSize: 6,
      unitType: 'each',
      costMinor: 320,
      priceMinor: 550,
      minQty: 12,
      maxQty: 24,
      velocityClass: 'A',
      description: 'Plain oat milk',
      active: true,
      line: 2,
    });
    const second = parsed.rows[1]!.row as ParsedProductRow;
    expect(second).toMatchObject({
      sku: 'DRY-FLR-01',
      categoryName: null,
      barcode: null,
      cartonSize: 1,
      velocityClass: null,
      description: null,
      active: false,
      line: 3,
    });
  });

  it('accepts flexible column order, extra columns, CRLF and blank lines', () => {
    const csv = [
      'price,sku,name,unknown_col',
      '5.50,SKU-1,"Name, Inc.",x',
      '',
      '1.00,SKU-2,Other,y',
    ].join('\r\n');
    const parsed = parseProductsCsv(csv, C);
    expect(parsed.fatal).toBeNull();
    expect(parsed.okCount).toBe(2);
    expect(parsed.rows[0]!.row).toMatchObject({ sku: 'SKU-1', name: 'Name, Inc.', priceMinor: 550, line: 2 });
    expect(parsed.rows[1]!.row).toMatchObject({ sku: 'SKU-2', line: 4 });
  });

  it('applies defaults for optional columns', () => {
    const parsed = parseProductsCsv('sku,name,price\nX-1,Thing,1.00', C);
    expect(parsed.okCount).toBe(1);
    expect(parsed.rows[0]!.row).toMatchObject({
      categoryName: null,
      barcode: null,
      cartonBarcode: null,
      cartonSize: 1,
      costMinor: 0,
      unitType: 'each',
      minQty: 0,
      maxQty: 0,
      velocityClass: null,
      description: null,
      active: true,
    });
  });
});

describe('parseProductsCsv — fatal file problems', () => {
  it('empty file', () => {
    expect(parseProductsCsv('', C).fatal).toBe('File is empty');
  });

  it('missing required columns', () => {
    const r = parseProductsCsv('sku,name\nX-1,Thing', C);
    expect(r.fatal).toContain('price');
  });

  it('header only → no rows, no errors', () => {
    const r = parseProductsCsv('sku,name,price', C);
    expect(r.fatal).toBeNull();
    expect(r.okCount).toBe(0);
    expect(r.errorCount).toBe(0);
  });
});

describe('parseProductsCsv — row validation', () => {
  const header = 'sku,name,price';
  const issuesOf = (r: ReturnType<typeof parseProductsCsv>, i: number) => r.rows[i]?.issues ?? [];

  it('requires sku and name', () => {
    const r = parseProductsCsv(`${header}\n,Thing,1.00\nNoName,,1.00`, C);
    expect(r.errorCount).toBe(2);
    expect(issuesOf(r, 0)).toEqual(['sku: required']);
    expect(issuesOf(r, 1)).toEqual(['name: required']);
  });

  it('price must parse and be > 0', () => {
    const r = parseProductsCsv(`${header}\nA,One,0\nB,Two,abc\nC,Three,12.34.56\nD,Four,-5`, C);
    expect(r.errorCount).toBe(4);
    expect(issuesOf(r, 0)).toEqual(['price: must be greater than 0']);
    expect(issuesOf(r, 1)).toEqual(['price: must be a non-negative number']);
    expect(issuesOf(r, 2)).toEqual(['price: must be a non-negative number']);
    expect(issuesOf(r, 3)).toEqual(['price: must be a non-negative number']);
  });

  it('cost must be a non-negative number when present', () => {
    const r = parseProductsCsv('sku,name,price,cost\nA,One,1.00,oops', C);
    expect(r.errorCount).toBe(1);
    expect(issuesOf(r, 0)).toEqual(['cost: must be a non-negative number']);
  });

  it('rejects duplicate SKUs in the file (case-insensitive)', () => {
    const r = parseProductsCsv(`${header}\nX-1,One,1.00\nx-1,Two,2.00`, C);
    expect(r.okCount).toBe(1);
    expect(r.errorCount).toBe(1);
    expect(issuesOf(r, 1)).toEqual(['sku: duplicate in file (x-1)']);
  });

  it('validates carton_size, min_qty, max_qty as whole numbers', () => {
    const r = parseProductsCsv(
      'sku,name,price,carton_size,min_qty,max_qty\nA,One,1.00,0,2,2\nB,Two,1.00,1.5,-1,3',
      C,
    );
    expect(issuesOf(r, 0)).toEqual(['carton_size: must be a whole number >= 1']);
    expect(issuesOf(r, 1)).toEqual(['carton_size: must be a whole number >= 1', 'min_qty: must be a whole number >= 0']);
  });

  it('validates unit_type and velocity_class enums (case-insensitive)', () => {
    const r = parseProductsCsv(
      'sku,name,price,unit_type,velocity_class\nA,One,1.00,bogus,?\nB,Two,1.00,KG,b',
      C,
    );
    expect(issuesOf(r, 0)).toEqual(['unit_type: must be one of each, kg, carton', 'velocity_class: must be one of A, B, C']);
    expect(r.rows[1]!.row).toMatchObject({ unitType: 'kg', velocityClass: 'B' });
  });

  it('validates the active flag', () => {
    const r = parseProductsCsv('sku,name,price,active\nA,One,1.00,maybe\nB,Two,1.00,no', C);
    expect(issuesOf(r, 0)).toEqual(['active: must be 0 or 1']);
    expect(r.rows[1]!.row).toMatchObject({ active: false });
  });

  it('reports the file line number (header = line 1, blank lines counted)', () => {
    const r = parseProductsCsv(`${header}\n\nA,One,0`, C);
    expect(r.rows[0]!.line).toBe(3);
  });

  it('zero-decimal currency: whole numbers only', () => {
    const ok = parseProductsCsv('sku,name,price\nA,One,500', 'JPY');
    expect(ok.rows[0]!.row).toMatchObject({ priceMinor: 50000 });
    const bad = parseProductsCsv('sku,name,price\nA,One,500.5', 'JPY');
    expect(bad.errorCount).toBe(1);
  });

  it('two-decimal currency: truncates to cents on export, parses 1-2 dp', () => {
    const r = parseProductsCsv('sku,name,price\nA,One,12.5', C);
    expect(r.rows[0]!.row).toMatchObject({ priceMinor: 1250 });
  });
});

describe('planProductImport (CR-13 — duplicate SKU in one batch)', () => {
  const existing = [
    { sku: 'MILK', id: 'p-milk' },
    { sku: 'bread', id: 'p-bread' }, // stored lowercase, must match case-insensitively
  ];

  it('updates an existing product by SKU (case-insensitive)', () => {
    const d = planProductImport([{ sku: 'MILK' }], existing);
    expect(d).toEqual([{ action: 'update', id: 'p-milk' }]);
    expect(planProductImport([{ sku: 'BREAD' }], existing)).toEqual([
      { action: 'update', id: 'p-bread' },
    ]);
  });

  it('creates a new product with a fresh id', () => {
    const d = planProductImport([{ sku: 'JAM' }], existing);
    expect(d).toHaveLength(1);
    expect(d[0]!.action).toBe('create');
    if (d[0]!.action === 'create') expect(typeof d[0]!.id).toBe('string');
  });

  it('a NEW SKU repeated in the same batch creates once, then updates the SAME id', () => {
    const d = planProductImport([{ sku: 'JAM' }, { sku: 'jam' }, { sku: 'Jam' }], existing);
    expect(d).toHaveLength(3);
    expect(d[0]!.action).toBe('create');
    expect(d[1]!.action).toBe('update');
    expect(d[2]!.action).toBe('update');
    const firstId = d[0]!.action === 'create' ? d[0]!.id : '';
    expect(d[1]!.action === 'update' && d[1]!.id).toBe(firstId);
    expect(d[2]!.action === 'update' && d[2]!.id).toBe(firstId);
  });

  it('an EXISTING SKU repeated in the same batch updates the same product every time', () => {
    const d = planProductImport([{ sku: 'MILK' }, { sku: 'milk' }], existing);
    expect(d).toEqual([
      { action: 'update', id: 'p-milk' },
      { action: 'update', id: 'p-milk' },
    ]);
  });

  it('mixed batch: existing, new, and a duplicate of the new one', () => {
    const d = planProductImport(
      [{ sku: 'MILK' }, { sku: 'JAM' }, { sku: 'jAM' }, { sku: 'TEA' }],
      existing,
    );
    expect(d.map((x) => x.action)).toEqual(['update', 'create', 'update', 'create']);
    const jamId = d[1]!.action === 'create' ? d[1]!.id : '';
    expect(d[2]!.action === 'update' && d[2]!.id).toBe(jamId);
  });
});
