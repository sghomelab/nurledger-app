import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NumberText } from '../NumberText';
import { formatMoney } from '../../lib/money';
import { PAYMENT_METHODS } from '../../lib/payment';
import type { SaleReceipt } from '../../repositories/saleRepository';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

function methodLabel(id: string): string {
  return PAYMENT_METHODS.find((m) => m.id === id)?.label ?? id;
}

/** On-screen receipt (FR-109 "no printer" fallback) shown after a sale. */
export function ReceiptView({
  receipt,
  currency,
  changeMinor,
  onDone,
}: {
  receipt: SaleReceipt;
  currency: string;
  changeMinor: number;
  onDone: () => void;
}) {
  const { sale, totals } = receipt;
  const number = sale.uuid.slice(0, 8).toUpperCase();
  const dt = new Date(sale.createdAt);
  const stamp = dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const multipleTaxCats = totals.tax.lines.length > 1;

  return (
    <View style={styles.wrap}>
      <View style={styles.success}>
        <Ionicons name="checkmark-circle" size={54} color={colors.positive} />
        <Text style={styles.successTitle}>Payment successful</Text>
        <Text style={styles.successSub}>
          Receipt #{number} · {stamp}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.receipt}>
        <Text style={styles.brand}>NURLEDGER</Text>
        <View style={styles.divider} />

        {sale.lines.map((l) => (
          <View key={l.id} style={styles.itemRow}>
            <View style={styles.itemNameCol}>
              <Text style={styles.itemName} numberOfLines={1}>
                {l.name}
              </Text>
              <NumberText style={styles.itemQty}>
                {l.qty} × {formatMoney(l.unitPriceMinor, currency)}
              </NumberText>
            </View>
            <NumberText style={styles.itemTotal}>{formatMoney(l.lineTotalMinor, currency)}</NumberText>
          </View>
        ))}

        <View style={styles.divider} />
        <Row label="Subtotal" value={formatMoney(sale.subtotalMinor, currency)} />
        {sale.discountMinor > 0 && (
          <Row label="Discount" value={`−${formatMoney(sale.discountMinor, currency)}`} accent={colors.positive} />
        )}
        <Row label={`Tax (${totals.tax.ratePct}%, ${totals.tax.mode})`} value={formatMoney(sale.taxMinor, currency)} />
        {multipleTaxCats &&
          totals.tax.lines.map((t) => (
            <Row key={t.category} label={`  ${t.category} (${t.ratePct}%)`} value={formatMoney(t.taxMinor, currency)} muted />
          ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <NumberText style={styles.totalValue}>{formatMoney(sale.totalMinor, currency)}</NumberText>
        </View>
        <View style={styles.divider} />

        {sale.payments.map((p, i) => (
          <Row key={i} label={methodLabel(p.method)} value={formatMoney(p.amountMinor, currency)} />
        ))}
        {changeMinor > 0 && <Row label="Change" value={formatMoney(changeMinor, currency)} accent={colors.positive} />}

        <Text style={styles.foot}>Thank you — offline-first, synced when online.</Text>
      </ScrollView>

      <Pressable style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value, accent, muted }: { label: string; value: string; accent?: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted ? { color: colors.slate400 } : null, accent ? { color: accent } : null]}>
        {label}
      </Text>
      <NumberText style={[styles.rowValue, accent ? { color: accent } : null]}>{value}</NumberText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50, padding: spacing.lg, gap: spacing.lg },
  success: { alignItems: 'center', gap: 4, paddingVertical: spacing.sm },
  successTitle: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 },
  successSub: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  receipt: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.lg,
    gap: 8,
  },
  brand: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900, letterSpacing: 2, textAlign: 'center' },
  divider: { height: 1, backgroundColor: colors.slate100, marginVertical: spacing.xs },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  itemNameCol: { flex: 1, gap: 1 },
  itemName: { fontFamily: fonts.sansMedium, fontSize: typography.body, color: colors.slate900 },
  itemQty: { fontSize: typography.caption, color: colors.slate500 },
  itemTotal: { fontSize: typography.body },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 },
  rowValue: { fontSize: typography.body },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  totalLabel: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  totalValue: { fontFamily: fonts.monoSemiBold, fontSize: 22, color: colors.slate900 },
  foot: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, textAlign: 'center', marginTop: spacing.sm },
  doneBtn: { height: 54, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
});
