import { StyleSheet, Text, View } from 'react-native';
import { NumberText } from '../NumberText';
import { formatMoney } from '../../lib/money';
import type { SaleTotals } from '../../lib/sale';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, accent ? { color: accent } : null]}>{label}</Text>
      <NumberText style={[styles.value, accent ? { color: accent } : null]}>{value}</NumberText>
    </View>
  );
}

/** Subtotal / Discount / Tax / TOTAL + live gross margin (FIFO, FR-321/FR-108). */
export function TotalsBlock({ totals, currency }: { totals: SaleTotals; currency: string }) {
  const taxLabel = `Tax (${totals.tax.ratePct}%, ${totals.tax.mode === 'inclusive' ? 'incl.' : 'excl.'})`;
  const grossProfit = totals.totalMinor - totals.cogsMinor;
  return (
    <View style={styles.block}>
      <Row label="Subtotal" value={formatMoney(totals.subtotalMinor, currency)} />
      {totals.discountMinor > 0 && (
        <Row label="Discount" value={`−${formatMoney(totals.discountMinor, currency)}`} accent={colors.positive} />
      )}
      <Row label={taxLabel} value={formatMoney(totals.taxMinor, currency)} />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <NumberText style={styles.totalValue}>{formatMoney(totals.totalMinor, currency)}</NumberText>
      </View>
      {totals.subtotalMinor > 0 && (
        <View style={styles.marginRow}>
          <Text style={styles.marginLabel}>Gross margin (FIFO)</Text>
          <NumberText style={styles.marginValue}>
            {totals.marginPct}% · {formatMoney(grossProfit, currency)}
          </NumberText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 6,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 },
  value: { fontSize: typography.body },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.slate200,
  },
  totalLabel: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  totalValue: { fontFamily: fonts.monoSemiBold, fontSize: 22, color: colors.slate900 },
  marginRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  marginLabel: { fontFamily: fonts.sansMedium, fontSize: typography.caption, color: colors.slate500 },
  marginValue: { fontFamily: fonts.monoMedium, fontSize: typography.caption, color: colors.positive },
});
