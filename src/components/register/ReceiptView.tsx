import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '../../lib/money';
import { layoutReceipt, renderReceiptText, WIDTH_COLS, type ReceiptData, type ReceiptWidth } from '../../lib/receipt';
import { PAYMENT_METHODS, paymentMethodsFor } from '../../lib/payment';
import { useT } from '../../hooks/useT';
import type { SaleReceipt } from '../../repositories/saleRepository';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

/** Locale-aware payment label (FR-601): 'PayNow QR' in en-SG, etc. */
function methodLabel(id: string, locale: string | null | undefined): string {
  return (
    paymentMethodsFor(locale).find((m) => m.id === id)?.label ??
    PAYMENT_METHODS.find((m) => m.id === id)?.label ??
    id
  );
}

interface Props {
  receipt: SaleReceipt;
  currency: string;
  changeMinor: number;
  outletName: string;
  cashierName?: string | null;
  /** Outlet locale — localizes payment labels on the receipt. */
  locale?: string | null;
  /** Chosen printer width (FR-109; Settings → Receipt). */
  width: ReceiptWidth;
  onDone: () => void;
}

/**
 * On-screen receipt (FR-109) — renders the SAME rows the thermal printer
 * would get (FR-604): `layoutReceipt` + `renderReceiptText` at the chosen
 * width, in the app's monospace face. The tax section is TaxEngine output
 * (FR-108), weighed lines show grams (FR-103), QR payments carry their
 * reference (FR-601).
 */
export function ReceiptView({ receipt, currency, changeMinor, outletName, cashierName, locale, width, onDone }: Props) {
  const { t } = useT();
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

  const text = useMemo(() => {
    const data: ReceiptData = {
      outletName,
      number,
      stamp,
      cashierName: cashierName ?? null,
      lines: sale.lines.map((l) => ({
        name: l.name,
        qty: l.qty,
        qtyG: l.qtyG,
        unitPriceMinor: l.unitPriceMinor,
        lineTotalMinor: l.lineTotalMinor,
      })),
      subtotalMinor: sale.subtotalMinor,
      discountMinor: sale.discountMinor,
      mode: totals.tax.mode,
      ratePct: totals.tax.ratePct,
      taxLines: totals.tax.lines,
      taxMinor: sale.taxMinor,
      totalMinor: sale.totalMinor,
      payments: sale.payments.map((p) => ({
        label: methodLabel(p.method, locale),
        amountMinor: p.amountMinor,
        reference: p.reference ?? null,
      })),
      changeMinor: changeMinor > 0 ? changeMinor : undefined,
      currency,
      fmt: (minor) => formatMoney(minor, currency),
    };
    return renderReceiptText(layoutReceipt(data, width), WIDTH_COLS[width]);
  }, [receipt, outletName, number, stamp, cashierName, locale, changeMinor, currency, width, totals]);

  return (
    <View style={styles.wrap}>
      <View style={styles.success}>
        <Ionicons name="checkmark-circle" size={54} color={colors.positive} />
        <Text style={styles.successTitle}>{t('receipt.success')}</Text>
        <Text style={styles.successSub}>
          Receipt #{number} · {stamp}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.receipt}>
        <Text style={styles.paper}>{text}</Text>
      </ScrollView>

      <Pressable style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneText}>{t('common.done')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50, padding: spacing.lg, gap: spacing.lg },
  success: { alignItems: 'center', gap: 4, paddingVertical: spacing.sm },
  successTitle: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 },
  successSub: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  receipt: {
    flexGrow: 1,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.lg,
  },
  paper: { fontFamily: fonts.mono, fontSize: 11, color: colors.slate900, lineHeight: 16 },
  doneBtn: { height: 54, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
});
