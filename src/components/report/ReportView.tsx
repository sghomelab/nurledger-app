import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '../../lib/money';
import type { CashMove, SalesByMethod, XReport, ZReport } from '../../lib/shift';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

interface Props {
  report: ZReport | XReport;
  currency: string;
}

/**
 * Renders a Z-report (close of shift) or X-report (interim snapshot) — FR-202/
 * FR-203. Pure presentational: the numbers come pre-computed from src/lib/shift.
 * The Z-report is also the printed report (the JSON on the shift row is the
 * source of truth; this view is one faithful rendering of it).
 */
export function ReportView({ report, currency }: Props) {
  const isZ = report.kind === 'Z';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Ionicons name={isZ ? 'document-text' : 'pulse'} size={20} color={colors.primary} />
        <Text style={styles.header}>{isZ ? 'Z-Report — Shift Close' : 'X-Report — Snapshot'}</Text>
      </View>
      <Text style={styles.sub}>
        {report.cashierName ?? 'Unknown'} · {fmtRange(report.openedAt, report.kind === 'Z' ? report.closedAt : report.generatedAt, report.kind === 'Z')}
      </Text>

      {/* Sales by method */}
      <Text style={styles.section}>Sales by payment method</Text>
      <View style={styles.card}>
        {Object.keys(report.salesByMethod).length === 0 ? (
          <Text style={styles.empty}>No sales this shift</Text>
        ) : (
          Object.entries(report.salesByMethod).map(([method, minor]) => (
            <Row key={method} label={methodLabel(method)} value={formatMoney(minor, currency)} />
          ))
        )}
        <Divider />
        <Row label="Total sales" value={formatMoney(totalByMethod(report.salesByMethod), currency)} strong />
        {isZ && (
          <>
            <Divider />
            <Row label="Refunds" value={`−${formatMoney(report.refundsMinor, currency)}`} />
          </>
        )}
      </View>

      {/* Cash movements */}
      <Text style={styles.section}>Cash drawer</Text>
      <View style={styles.card}>
        <Row label="Opening float" value={formatMoney(report.floatMinor, currency)} />
        <Row label="Cash sales" value={formatMoney(report.cashSaleMinor, currency)} />
        {isZ ? (
          <>
            {report.cashMoves.map((m) => (
              <Row key={m.id} label={`${m.type === 'in' ? '+' : '−'} ${m.reason}`} value={formatMoney(m.amountMinor, currency)} indent />
            ))}
            {report.cashMoves.length === 0 && <Text style={styles.empty}>No cash movements</Text>}
            <Divider />
            <Row label="Expected cash" value={formatMoney(report.expectedMinor, currency)} strong />
            <Row label="Counted cash" value={formatMoney(report.countedMinor, currency)} strong />
            <Divider />
            <VarianceRow varianceMinor={report.varianceMinor} varianceClass={report.varianceClass} currency={currency} />
          </>
        ) : (
          <>
            {(report as XReport).cashInMinor > 0 && <Row label="Cash in" value={formatMoney((report as XReport).cashInMinor, currency)} />}
            {(report as XReport).cashOutMinor > 0 && <Row label="Cash out" value={formatMoney((report as XReport).cashOutMinor, currency)} />}
            <Divider />
            <Row label="Expected cash now" value={formatMoney((report as XReport).expectedCashMinor, currency)} strong />
          </>
        )}
      </View>

      {isZ && report.notes ? (
        <>
          <Text style={styles.section}>Shift notes</Text>
          <View style={styles.card}>
            <Text style={styles.note}>{report.notes}</Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function totalByMethod(m: SalesByMethod): number {
  return Object.values(m).reduce((s, v) => s + v, 0);
}

function methodLabel(m: string): string {
  switch (m) {
    case 'cash': return 'Cash';
    case 'card': return 'Card';
    case 'mobile': return 'Mobile / e-wallet';
    case 'qr': return 'QR / scan-pay';
    default: return m;
  }
}

function fmtRange(openedAt: number, endAt: number | null, isZ: boolean): string {
  const o = new Date(openedAt).toLocaleString();
  if (!isZ || endAt == null) return o;
  return `${o} → ${new Date(endAt).toLocaleString()}`;
}

function Row({ label, value, strong, indent }: { label: string; value: string; strong?: boolean; indent?: boolean }) {
  return (
    <View style={[styles.row, indent && styles.rowIndent]}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  );
}

function VarianceRow({ varianceMinor, varianceClass, currency }: { varianceMinor: number; varianceClass: 'exact' | 'over' | 'short'; currency: string }) {
  const color = varianceClass === 'exact' ? colors.positive : varianceClass === 'over' ? colors.warning : colors.danger;
  const label = varianceClass === 'exact' ? 'Exact' : varianceClass === 'over' ? 'Over' : 'Short';
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.slate900, fontFamily: fonts.sansBold }]}>{`Variance (${label})`}</Text>
      <Text style={[styles.rowValue, { color, fontFamily: fonts.monoSemiBold }]}>
        {formatMoney(varianceMinor, currency)}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  header: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  sub: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate500 },
  section: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700, marginTop: spacing.sm },
  card: { backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.slate200, padding: spacing.md, gap: spacing.sm },
  empty: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  rowIndent: { paddingLeft: spacing.lg },
  rowLabel: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, flexShrink: 1 },
  rowValue: { fontFamily: fonts.mono, fontSize: typography.caption, color: colors.slate900 },
  rowStrong: { fontFamily: fonts.sansSemiBold, color: colors.slate900 },
  divider: { height: 1, backgroundColor: colors.slate200, marginVertical: spacing.xs },
  note: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate700 },
});
