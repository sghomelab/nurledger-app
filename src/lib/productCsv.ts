/**
 * FR-314 (M6) — product CSV import/export. Pure string in / out (module map:
 * `src/lib/` never touches the DB or RN; the UI orchestrates file I/O and
 * `productRepository.importProducts` applies parsed rows).
 *
 * Format: one row per product, header required (column order flexible —
 * mapped by name). Money is written in MAJOR units (the CSV is a data file,
 * not a display — see csv.ts convention). Zero-decimal currencies must use
 * whole numbers in cost/price.
 *
 * Import semantics (applied by the repository, not here): upsert by SKU
 * (case-insensitive). A category name that doesn't exist is auto-created.
 * Rows with validation errors are skipped and reported with their line
 * number — a bad row never blocks the good ones.
 */

import { isZeroDecimal } from './currency';
import { toCsv, toMajor } from './csv';
import { uuidv4 } from './ids';
import type { Product, UnitType, VelocityClass } from '../types';

/** Header columns in canonical export order (import maps by name, so order is free). */
export const PRODUCT_CSV_HEADER = [
  'sku',
  'name',
  'category',
  'barcode',
  'carton_barcode',
  'carton_size',
  'unit_type',
  'cost',
  'price',
  'min_qty',
  'max_qty',
  'velocity_class',
  'description',
  'active',
] as const;

const UNIT_TYPES: UnitType[] = ['each', 'kg', 'carton'];
const VELOCITY_CLASSES: VelocityClass[] = ['A', 'B', 'C'];

/**
 * Split CSV text into rows of fields. RFC-4180 state machine: quoted fields
 * may contain commas, newlines and doubled quotes (`""` → `"`). Handles
 * CRLF, LF and lone CR line endings, and an optional UTF-8 BOM.
 */
export function splitCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++; // CRLF is one line break
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Strict money parse: major-unit decimal → integer minor units, or null. */
function parseMoneyStrict(input: string, currency: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  if (isZeroDecimal(currency) && s.includes('.')) return null;
  const [whole, frac = ''] = s.split('.');
  const f = frac ? parseInt((frac + '00').slice(0, 2), 10) : 0;
  return parseInt(whole ?? '0', 10) * 100 + f;
}

/** Strict non-negative integer parse, or null. */
function parseQtyStrict(input: string): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

function parseActiveStrict(input: string): boolean | null {
  const s = input.trim().toLowerCase();
  if (s === '') return true; // default
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return null;
}

export interface ParsedProductRow {
  /** 1-based line number in the file (header = line 1). */
  line: number;
  sku: string;
  name: string;
  categoryName: string | null;
  barcode: string | null;
  cartonBarcode: string | null;
  cartonSize: number;
  unitType: UnitType;
  costMinor: number;
  priceMinor: number;
  minQty: number;
  maxQty: number;
  velocityClass: VelocityClass | null;
  description: string | null;
  active: boolean;
}

export interface ParsedCsvRow {
  line: number;
  ok: boolean;
  row?: ParsedProductRow;
  /** Human-readable problems, e.g. `price: must be a number greater than 0`. */
  issues: string[];
}

export interface ParseResult {
  /** Set when the file itself is unusable (no header, empty, missing required columns). */
  fatal: string | null;
  rows: ParsedCsvRow[];
  okCount: number;
  errorCount: number;
}

/** One row's decision in a product import (CR-13). */
export type ProductImportDecision =
  | { action: 'update'; id: string }
  | { action: 'create'; id: string };

/**
 * CR-13 — plan a product import: for each row, UPDATE an existing product
 * (same SKU, case-insensitive) or CREATE a new one (fresh id).
 *
 * A SKU is claimed for the WHOLE batch and never released: when a row matches
 * a product already in the DB — or one created by an EARLIER row of the same
 * batch — every occurrence updates that one product. The old repository code
 * deleted the claim on match, so a duplicate SKU in one file fell through to
 * the insert branch and crashed with `UNIQUE constraint failed:
 * product.outlet_id, product.sku`, rolling back the ENTIRE import. (The CSV
 * parser ALSO flags in-file duplicates in its user report; this makes the
 * repository itself safe for any caller.)
 *
 * `existingProducts`: current DB products (their ids are authoritative).
 * Returns one decision per row, in row order.
 */
export function planProductImport(
  rows: Array<{ sku: string }>,
  existingProducts: Array<{ sku: string; id: string }>,
): ProductImportDecision[] {
  const bySku = new Map(existingProducts.map((p) => [p.sku.toLowerCase(), p.id]));
  return rows.map((row) => {
    const key = row.sku.toLowerCase();
    const id = bySku.get(key);
    if (id !== undefined) return { action: 'update', id };
    const newId = uuidv4();
    bySku.set(key, newId); // claim the SKU for the rest of the batch
    return { action: 'create', id: newId };
  });
}

/**
 * Parse a product CSV. The first row must be a header containing at least
 * `sku`, `name` and `price` (case-insensitive). Unknown columns are ignored;
 * missing optional columns fall back to their defaults.
 */
export function parseProductsCsv(text: string, currency: string): ParseResult {
  const rows = splitCsv(text);
  if (rows.length === 0) return { fatal: 'File is empty', rows: [], okCount: 0, errorCount: 0 };

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const required = ['sku', 'name', 'price'].filter((n) => col(n) === -1);
  if (required.length > 0) {
    return {
      fatal: `Missing required column(s): ${required.join(', ')} (header: ${rows[0]!.filter(Boolean).join(', ') || 'empty'})`,
      rows: [],
      okCount: 0,
      errorCount: 0,
    };
  }

  const get = (cells: string[], name: string): string | null => {
    const i = col(name);
    if (i === -1) return null;
    const v = (cells[i] ?? '').trim();
    return v === '' ? null : v;
  };

  const result: ParseResult = { fatal: null, rows: [], okCount: 0, errorCount: 0 };
  const seenSkus = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r] ?? [];
    // Skip fully blank lines.
    if (cells.every((c) => c.trim() === '')) continue;
    const line = r + 1;
    const issues: string[] = [];

    const sku = (get(cells, 'sku') ?? '').trim();
    const name = (get(cells, 'name') ?? '').trim();
    if (!sku) issues.push('sku: required');
    if (!name) issues.push('name: required');

    const skuKey = sku.toLowerCase();
    if (sku && seenSkus.has(skuKey)) issues.push(`sku: duplicate in file (${sku})`);

    const priceStr = get(cells, 'price');
    const priceMinor = priceStr === null ? null : parseMoneyStrict(priceStr, currency);
    if (priceStr === null) issues.push('price: required');
    else if (priceMinor === null) issues.push('price: must be a non-negative number');
    else if (priceMinor <= 0) issues.push('price: must be greater than 0');

    const costStr = get(cells, 'cost');
    const costMinor =
      costStr === null ? 0 : parseMoneyStrict(costStr, currency) ?? -1;
    if (costStr !== null && costMinor < 0) issues.push('cost: must be a non-negative number');

    const cartonSizeStr = get(cells, 'carton_size');
    const cartonSize =
      cartonSizeStr === null ? 1 : parseQtyStrict(cartonSizeStr) ?? -1;
    if (cartonSizeStr !== null && (cartonSize < 1 || cartonSize > 100000)) {
      issues.push('carton_size: must be a whole number >= 1');
    }

    const minQtyStr = get(cells, 'min_qty');
    const minQty = minQtyStr === null ? 0 : parseQtyStrict(minQtyStr) ?? -1;
    if (minQtyStr !== null && minQty < 0) issues.push('min_qty: must be a whole number >= 0');

    const maxQtyStr = get(cells, 'max_qty');
    const maxQty = maxQtyStr === null ? 0 : parseQtyStrict(maxQtyStr) ?? -1;
    if (maxQtyStr !== null && maxQty < 0) issues.push('max_qty: must be a whole number >= 0');

    const unitRaw = (get(cells, 'unit_type') ?? '').toLowerCase();
    const unitType = UNIT_TYPES.find((u) => u.toLowerCase() === unitRaw);
    if (unitRaw !== '' && unitType === undefined) {
      issues.push(`unit_type: must be one of ${UNIT_TYPES.join(', ')}`);
    }

    const velocityRaw = (get(cells, 'velocity_class') ?? '').toUpperCase();
    const velocityClass = VELOCITY_CLASSES.find((v) => v === velocityRaw);
    if (velocityRaw !== '' && velocityClass === undefined) {
      issues.push(`velocity_class: must be one of ${VELOCITY_CLASSES.join(', ')}`);
    }

    const activeRaw = get(cells, 'active');
    const active = activeRaw === null ? true : parseActiveStrict(activeRaw);
    if (activeRaw !== null && active === null) issues.push('active: must be 0 or 1');

    if (issues.length > 0) {
      result.rows.push({ line, ok: false, issues });
      result.errorCount++;
      continue;
    }

    if (sku) seenSkus.add(skuKey);
    result.rows.push({
      line,
      ok: true,
      issues: [],
      row: {
        line,
        sku,
        name,
        categoryName: get(cells, 'category'),
        barcode: get(cells, 'barcode'),
        cartonBarcode: get(cells, 'carton_barcode'),
        cartonSize,
        unitType: unitType ?? 'each',
        costMinor,
        priceMinor: priceMinor as number,
        minQty,
        maxQty,
        velocityClass: velocityClass ?? null,
        description: get(cells, 'description'),
        active: active as boolean,
      },
    });
    result.okCount++;
  }

  return result;
}

/**
 * Serialize products to the canonical CSV. `categoryName` resolves a
 * category id to its display name (the CSV stores names, not ids — files are
 * human-editable; ids are per-device).
 */
export function serializeProductsToCsv(
  products: Product[],
  categoryName: (id: string | null) => string | null,
  currency: string,
): string {
  const rows: (string | number)[][] = [[...PRODUCT_CSV_HEADER]];
  for (const p of products) {
    rows.push([
      p.sku,
      p.name,
      categoryName(p.categoryId) ?? '',
      p.barcode ?? '',
      p.cartonBarcode ?? '',
      p.cartonSize,
      p.unitType,
      toMajor(p.costMinor, currency),
      toMajor(p.priceMinor, currency),
      p.minQty,
      p.maxQty,
      p.velocityClass ?? '',
      p.description ?? '',
      p.active ? 1 : 0,
    ]);
  }
  return toCsv(rows);
}
