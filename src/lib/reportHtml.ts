/**
 * X/Z report → printable HTML (issues #13/#14/#2).
 *
 * Pure + unit-testable: mirrors `ReportView` line-for-line (sales by method,
 * totals, refunds, cash drawer, variance, notes) so the exported PDF shows
 * exactly what the on-screen sheet shows. Money stays integer minor units;
 * display formatting goes through `formatMoney`.
 */
import { formatMoney } from './money';
import type { XReport, ZReport } from './shift';

export interface ReportHtmlOptions {
  /** Outlet name for the header (optional). */
  outletName?: string | null;
  /** Localized report title (issue #18). Falls back to the English default. */
  title?: string | null;
  /** Localized hint line under the title (e.g. 'Does not close the shift'). */
  hint?: string | null;
}

const VARIANCE_LABEL: Record<ZReport['varianceClass'], string> = {
  exact: 'Exact',
  over: 'Over',
  short: 'Short',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function methodLabel(m: string): string {
  switch (m) {
    case 'cash':
      return 'Cash';
    case 'card':
      return 'Card';
    case 'mobile':
      return 'Mobile / e-wallet';
    case 'qr':
      return 'QR / scan-pay';
    default:
      return m;
  }
}

function fmtStamp(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Builds a self-contained HTML document for `Print.printAsync` /
 * `printToFileAsync`. No external assets, print-friendly monochrome layout.
 */
export function buildReportHtml(
  report: XReport | ZReport,
  currency: string,
  opts: ReportHtmlOptions = {},
): string {
  const isZ = report.kind === 'Z';
  const money = (minor: number) => formatMoney(minor, currency);
  const total = Object.values(report.salesByMethod).reduce((s, v) => s + v, 0);

  const title = opts.title ?? (isZ ? 'Shift Close — Z-Report' : 'Shift Snapshot — X-Report');
  const endAt = isZ ? report.closedAt : report.generatedAt;
  const range = isZ ? `${fmtStamp(report.openedAt)} → ${fmtStamp(endAt)}` : fmtStamp(report.openedAt);

  const salesRows = Object.entries(report.salesByMethod)
    .map(([method, minor]) => `<tr><td>${esc(methodLabel(method))}</td><td class="num">${esc(money(minor))}</td></tr>`)
    .join('');

  const zRows = isZ
    ? [
        ...report.cashMoves.map(
          (m) =>
            `<tr class="indent"><td>${m.type === 'in' ? '+' : '−'} ${esc(m.reason)}</td><td class="num">${esc(money(m.amountMinor))}</td></tr>`,
        ),
        `<tr class="strong"><td>Expected cash</td><td class="num">${esc(money(report.expectedMinor))}</td></tr>`,
        `<tr class="strong"><td>Counted cash</td><td class="num">${esc(money(report.countedMinor))}</td></tr>`,
        `<tr class="strong"><td>Variance (${VARIANCE_LABEL[report.varianceClass]})</td><td class="num">${esc(money(report.varianceMinor))}</td></tr>`,
      ].join('')
    : [
        ...(report.cashInMinor > 0 ? [`<tr><td>Cash in</td><td class="num">${esc(money(report.cashInMinor))}</td></tr>`] : []),
        ...(report.cashOutMinor > 0 ? [`<tr><td>Cash out</td><td class="num">${esc(money(report.cashOutMinor))}</td></tr>`] : []),
        `<tr class="strong"><td>Expected cash now</td><td class="num">${esc(money(report.expectedCashMinor))}</td></tr>`,
      ].join('');

  const refundsRow = isZ ? `<tr><td>Refunds</td><td class="num">−${esc(money(report.refundsMinor))}</td></tr>` : '';
  const notes = isZ && report.notes ? `<h2>Notes</h2><p class="notes">${esc(report.notes)}</p>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 14mm; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #0f172a; font-size: 12px; }
  h1 { font-size: 16px; margin: 0 0 2px 0; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 14px 0 4px 0; }
  .meta { color: #64748b; margin: 0 0 2px 0; }
  .hint { color: #64748b; font-style: italic; margin: 0 0 10px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; border-bottom: 1px solid #e2e8f0; }
  td.num { text-align: right; font-family: 'SF Mono', Menlo, monospace; white-space: nowrap; }
  tr.strong td { font-weight: 600; border-top: 1.5px solid #0f172a; }
  tr.indent td { padding-left: 18px; color: #475569; }
  .notes { white-space: pre-wrap; }
</style>
</head>
<body>
  ${opts.outletName ? `<p class="meta">${esc(opts.outletName)}</p>` : ''}
  <h1>${esc(title)}</h1>
  ${opts.hint ? `<p class="hint">${esc(opts.hint)}</p>` : ''}
  <p class="meta">${esc(report.cashierName ?? 'Unknown')} · ${esc(range)}</p>
  <h2>Sales by payment method</h2>
  <table>
    ${salesRows || '<tr><td colspan="2">No sales this shift</td></tr>'}
    <tr class="strong"><td>Total sales</td><td class="num">${esc(money(total))}</td></tr>
    ${refundsRow}
  </table>
  <h2>Cash drawer</h2>
  <table>
    <tr><td>Opening float</td><td class="num">${esc(money(report.floatMinor))}</td></tr>
    <tr><td>Cash sales</td><td class="num">${esc(money(report.cashSaleMinor))}</td></tr>
    ${zRows}
  </table>
  ${notes}
</body>
</html>`;
}
