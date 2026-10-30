/**
 * Receipt template engine tests (FR-604, FR-109).
 *
 * The engine is parameterized by TaxEngine output (FR-108) — no tax-specific
 * behavior is hardcoded. 58mm = 32 cols, 80mm = 48 cols.
 */

import { layoutReceipt, renderReceiptText, WIDTH_COLS, type ReceiptData } from '../lib/receipt';
import type { TaxLine } from '../lib/tax';

const fmt = (minor: number) => `$${(minor / 100).toFixed(2)}`;

function baseData(over: Partial<ReceiptData> = {}): ReceiptData {
  return {
    outletName: 'Test Grocer',
    address: '123 Main Road',
    number: 'SL-0001',
    stamp: '2026-10-31 12:00',
    cashierName: 'Jun',
    lines: [
      { name: 'Croissant', qty: 2, qtyG: null, unitPriceMinor: 400, lineTotalMinor: 800 },
      { name: 'Apple (weighed)', qty: 1, qtyG: 250, unitPriceMinor: 300, lineTotalMinor: 75 },
    ],
    subtotalMinor: 875,
    discountMinor: 0,
    mode: 'inclusive',
    ratePct: 9,
    taxLines: [{ category: 'standard', ratePct: 9, amountMinor: 803, taxMinor: 72 }],
    taxMinor: 72,
    totalMinor: 875,
    payments: [{ label: 'Cash', amountMinor: 1000 }],
    changeMinor: 125,
    currency: 'SGD',
    fmt,
    ...over,
  };
}

describe('widths (FR-109: 58mm + 80mm templates)', () => {
  it('32 cols at 58mm, 48 cols at 80mm', () => {
    expect(WIDTH_COLS['58mm']).toBe(32);
    expect(WIDTH_COLS['80mm']).toBe(48);
  });

  it('58mm truncates long item names; 80mm keeps them', () => {
    // 25 chars: over the 58mm budget (~18) but under the 80mm budget (~34).
    const name = 'X'.repeat(25);
    const rows58 = layoutReceipt(baseData({ lines: [{ name, qty: 1, qtyG: null, unitPriceMinor: 100, lineTotalMinor: 100 }], taxLines: [] }), '58mm');
    const rows80 = layoutReceipt(baseData({ lines: [{ name, qty: 1, qtyG: null, unitPriceMinor: 100, lineTotalMinor: 100 }], taxLines: [] }), '80mm');
    // Item row: the first row whose left text starts with the long name.
    const item58 = rows58.find((r) => (r.left ?? '').startsWith('X'));
    const item80 = rows80.find((r) => (r.left ?? '').startsWith('X'));
    expect(item58).toBeDefined();
    expect(item80).toBeDefined();
    expect((item58!.left ?? '').length).toBeLessThanOrEqual(32);
    expect(item58!.left).toContain('…'); // truncated to fit 58mm
    expect(item80!.left).toContain(name); // full name survives at 80mm
    expect((item80!.left ?? '')).not.toContain('…');
  });
});

describe('layout (FR-604)', () => {
  it('emits header, item rows, tax, total and payments in order', () => {
    const rows = layoutReceipt(baseData(), '80mm');
    expect(rows[0]?.center).toBe('Test Grocer');
    const text = renderReceiptText(rows, 48);
    const idx = (needle: string) => text.indexOf(needle);
    expect(idx('Croissant')).toBeGreaterThanOrEqual(0);
    expect(idx('250 g')).toBeGreaterThanOrEqual(0); // weighed line shows grams
    expect(idx('Tax 9% incl. (standard)')).toBeGreaterThanOrEqual(0);
    expect(idx('TOTAL')).toBeGreaterThanOrEqual(idx('Tax 9% incl. (standard)'));
    expect(idx('Cash $')).toBeGreaterThanOrEqual(idx('TOTAL'));
    expect(idx('Change')).toBeGreaterThanOrEqual(idx('Cash $'));
  });

  it('weighed lines show grams, not x-qty', () => {
    const rows = layoutReceipt(baseData(), '80mm');
    const weighed = rows.find((r) => (r.left ?? '').includes('Apple'));
    expect(weighed?.left).toContain('250 g');
    expect(weighed?.left).not.toContain('x1');
  });

  it('discount row only when discount > 0', () => {
    const noDisc = renderReceiptText(layoutReceipt(baseData(), '80mm'), 48);
    expect(noDisc).not.toContain('Discount');
    const disc = renderReceiptText(layoutReceipt(baseData({ discountMinor: 50 }), '80mm'), 48);
    expect(disc).toContain('Discount');
  });
});

describe('tax section parameterized by TaxEngine output (FR-108)', () => {
  it('single category → one compact line with the category named', () => {
    const text = renderReceiptText(layoutReceipt(baseData(), '80mm'), 48);
    expect(text).toContain('Tax 9% incl. (standard)');
    expect(text).toContain('$0.72');
  });

  it('zero-rate engine → tax line at 0 with no rate noise', () => {
    const d = baseData({ ratePct: 0, taxLines: [], taxMinor: 0 });
    const text = renderReceiptText(layoutReceipt(d, '80mm'), 48);
    expect(text).toContain('Tax 0%');
    expect(text).toContain('$0.00');
  });

  it('multiple categories → total line + indented per-category breakdown', () => {
    const taxLines: TaxLine[] = [
      { category: 'standard', ratePct: 9, amountMinor: 500, taxMinor: 45 },
      { category: 'zero', ratePct: 0, amountMinor: 300, taxMinor: 0 },
    ];
    const text = renderReceiptText(layoutReceipt(baseData({ taxLines, taxMinor: 45 }), '80mm'), 48);
    expect(text).toContain('Tax 9% incl.');
    expect(text).toContain('standard @ 9%');
    expect(text).toContain('zero @ 0%');
    // The category rows are indented (start with whitespace).
    expect(text.split('\n').some((l) => l.startsWith('  standard @ 9%'))).toBe(true);
  });

  it('exclusive mode shows no "incl." suffix', () => {
    const d = baseData({ mode: 'exclusive' });
    const text = renderReceiptText(layoutReceipt(d, '80mm'), 48);
    expect(text).toContain('Tax 9% (standard)');
    expect(text).not.toContain('incl.');
  });
});

describe('payment + change rows (FR-107)', () => {
  it('QR payments carry the reference on the line', () => {
    const d = baseData({
      payments: [
        { label: 'Cash', amountMinor: 500 },
        { label: 'PayNow QR', amountMinor: 375, reference: 'QR-AB12CD34' },
      ],
      changeMinor: undefined,
    });
    const text = renderReceiptText(layoutReceipt(d, '80mm'), 48);
    expect(text).toContain('PayNow QR (QR-AB12CD34)');
    expect(text).not.toContain('Change');
  });
});

describe('renderReceiptText alignment', () => {
  it('amount columns right-align to the width edge', () => {
    const rows = layoutReceipt(baseData(), '80mm');
    const text = renderReceiptText(rows, 48);
    const totalLine = text.split('\n').find((l) => l.trimStart().startsWith('TOTAL'))!;
    expect(totalLine).toMatch(/\$8\.75$/); // total 875 → ends at the right edge
    const cashLine = text.split('\n').find((l) => l.startsWith('Cash '))!;
    expect(cashLine).toMatch(/\$10\.00$/);
  });
});
