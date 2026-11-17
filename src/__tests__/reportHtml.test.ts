/**
 * X/Z report HTML builder tests (issues #13/#14/#2).
 *
 * The HTML is a faithful rendering of the report: same lines as ReportView.
 * These tests pin the values, the X-vs-Z differences, and HTML escaping.
 */

import { buildReportHtml } from '../lib/reportHtml';
import { buildXReport, buildZReport, type CashMove, type SalesByMethod } from '../lib/shift';
import { formatMoney } from '../lib/money';

const T0 = new Date('2026-11-17T09:00:00').getTime();
const T1 = new Date('2026-11-17T18:00:00').getTime();

const SALES: SalesByMethod = { cash: 20_000, qr: 5_500 };
const NO_MOVES: CashMove[] = [];

function zReport(over: Partial<Parameters<typeof buildZReport>[0]> = {}) {
  return buildZReport({
    shiftId: 'sh-1',
    deviceId: null,
    cashierName: 'Jun',
    openedAt: T0,
    closedAt: T1,
    salesByMethod: SALES,
    cashMoves: NO_MOVES,
    totals: { floatMinor: 10_000, cashSaleMinor: 20_000, cashInMinor: 0, cashOutMinor: 0, cashRefundMinor: 0 },
    countedMinor: 30_000,
    notes: null,
    ...over,
  });
}

function xReport() {
  return buildXReport('sh-1', 'Jun', T0, SALES, { floatMinor: 10_000, cashSaleMinor: 20_000, cashInMinor: 0, cashOutMinor: 0, cashRefundMinor: 0 }, T1);
}

describe('buildReportHtml (Z)', () => {
  const html = buildReportHtml(zReport(), 'SGD', { outletName: 'Test Grocer', hint: 'Closes the shift — count the cash first' });

  it('has the title, hint, outlet and cashier', () => {
    expect(html).toContain('Shift Close — Z-Report');
    expect(html).toContain('Closes the shift — count the cash first');
    expect(html).toContain('Test Grocer');
    expect(html).toContain('Jun');
  });

  it('formats money via formatMoney (SGD)', () => {
    expect(html).toContain(formatMoney(25_500, 'SGD')); // total sales
    expect(html).toContain(formatMoney(20_000, 'SGD')); // cash sales
    expect(html).toContain(formatMoney(10_000, 'SGD')); // float
    expect(html).toContain(formatMoney(30_000, 'SGD')); // expected + counted
  });

  it('shows the variance line with its class', () => {
    expect(html).toContain('Variance (Exact)');
  });

  it('includes the refunds row', () => {
    expect(html).toContain('Refunds');
  });
});

describe('buildReportHtml (X)', () => {
  const html = buildReportHtml(xReport(), 'SGD');

  it('uses the snapshot title', () => {
    expect(html).toContain('Shift Snapshot — X-Report');
  });

  it('omits Z-only lines (counted cash, variance, refunds)', () => {
    expect(html).not.toContain('Counted cash');
    expect(html).not.toContain('Variance');
    expect(html).not.toContain('Refunds');
  });

  it('shows expected cash now', () => {
    expect(html).toContain('Expected cash now');
  });
});

describe('buildReportHtml (cash movements + notes)', () => {
  const html = buildReportHtml(
    zReport({
      cashMoves: [
        { id: 'm1', type: 'in', amountMinor: 2_000, reason: 'Bank deposit', createdAt: T1 },
        { id: 'm2', type: 'out', amountMinor: 500, reason: 'Shop supplies', createdAt: T1 },
      ],
      notes: 'Drawer <was> counted by Jun & friends',
    }),
    'SGD',
  );

  it('renders each movement with sign + reason', () => {
    expect(html).toContain('+ Bank deposit');
    expect(html).toContain('− Shop supplies');
  });

  it('escapes free text (no raw HTML in notes/reasons)', () => {
    expect(html).not.toContain('Drawer <was>');
    expect(html).toContain('Drawer &lt;was&gt; counted by Jun &amp; friends');
  });
});

describe('buildReportHtml (empty sales)', () => {
  const html = buildReportHtml(zReport({ salesByMethod: {} }), 'SGD');

  it('shows the no-sales placeholder', () => {
    expect(html).toContain('No sales this shift');
  });
});

describe('buildReportHtml (localized labels, issue #18 follow-up)', () => {
  const html = buildReportHtml(zReport(), 'SGD', {
    labels: {
      totalSales: 'Jumlah jualan',
      expectedCash: 'Tunai dijangka',
      countedCash: 'Tunai dikira',
      variance: 'Perbezaan',
      varianceExact: 'Tepat',
      salesByMethod: 'Jualan mengikut kaedah pembayaran',
      unknownUser: 'Tiada pengguna',
    },
  });

  it('uses the provided labels in place of the English defaults', () => {
    expect(html).toContain('Jumlah jualan');
    expect(html).toContain('Tunai dijangka');
    expect(html).toContain('Tunai dikira');
    expect(html).toContain('Perbezaan (Tepat)');
    expect(html).toContain('Jualan mengikut kaedah pembayaran');
    expect(html).not.toContain('>Total sales<');
    expect(html).not.toContain('>Expected cash<');
    expect(html).not.toContain('Variance (Exact)');
  });

  it('keeps the English default for labels not overridden', () => {
    expect(html).toContain('>Refunds<');
  });
});
