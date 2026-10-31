/**
 * CR-09 — structural guards for the insights repository (source-level,
 * same style as cloudSchema.test.ts — jest runs in node, no SQLite).
 *
 * expo-sqlite keys result rows by the column name OR alias exactly as it
 * appears in the SELECT list. A bare column like `rl.qty_g` therefore lands
 * under the key `qty_g` — reading it as `row.qtyG` silently yields undefined
 * (observed in live verification: weighed-refund units fell back to the
 * unit-count branch and were under-counted). These guards pin the invariant
 * that every property the getPeriodTotals refund loop reads is an explicit
 * alias in the query.
 */

// The tsconfig pins "types": ["jest"] (no node types), but jest itself runs
// in a CJS node context — declare the tiny surface this source-level guard
// needs.
declare const __dirname: string;
declare const require: (id: string) => any;

const { readFileSync } = require('fs');
const { join } = require('path');

const src = readFileSync(join(__dirname, '..', 'repositories', 'insightsRepository.ts'), 'utf8');

describe('getPeriodTotals — refund queries alias every column the loop reads (CR-09)', () => {
  /** The SELECT list of the refund-lines query (up to FROM). */
  const select = () => {
    const start = src.indexOf('SELECT rl.qty');
    expect(start).toBeGreaterThan(-1);
    const from = src.indexOf('FROM refund_line', start);
    return src.slice(start, from);
  };

  it('aliases rl.qty_g as qtyG (the live-verification bug)', () => {
    expect(select()).toContain('rl.qty_g AS qtyG');
  });

  it('aliases every column the per-line loop reads', () => {
    const s = select();
    // rl.qty and rl.restock are read bare and must stay bare (key = column).
    expect(s).toMatch(/\brl\.qty\b/);
    expect(s).toContain('rl.restock');
    expect(s).toContain('sl.qty AS lineQty');
    expect(s).toContain('sl.qty_g AS lineQtyG');
    expect(s).toContain('AS cogs');
    // No un-aliased snake_case column that the TS type reads as camelCase.
    expect(s).not.toMatch(/rl\.qty_g(?!\s+AS)/);
    expect(s).not.toMatch(/sl\.qty_g(?!\s+AS)/);
  });
});
