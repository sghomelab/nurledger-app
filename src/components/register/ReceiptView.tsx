import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { layoutReceipt, renderReceiptText, WIDTH_COLS, receiptDataFrom, type ReceiptWidth } from '../../lib/receipt';
import { useT } from '../../hooks/useT';
import type { SaleReceipt } from '../../repositories/saleRepository';
import { fonts, radius, spacing, typography, type Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

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
  /** Optional: offer to email the receipt (issue #19). Renders an extra button. */
  onEmail?: () => void;
  onDone: () => void;
}

/**
 * On-screen receipt (FR-109) — renders the SAME rows the thermal printer
 * would get (FR-604): `layoutReceipt` + `renderReceiptText` at the chosen
 * width, in the app's monospace face. The tax section is TaxEngine output
 * (FR-108), weighed lines show grams (FR-103), QR payments carry their
 * reference (FR-601).
 */
export function ReceiptView({ receipt, currency, changeMinor, outletName, cashierName, locale, width, onEmail, onDone }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();
  const { sale } = receipt;
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
    const data = receiptDataFrom(receipt, { outletName, cashierName, locale, currency, changeMinor });
    return renderReceiptText(layoutReceipt(data, width), WIDTH_COLS[width]);
  }, [receipt, outletName, cashierName, locale, changeMinor, currency, width]);

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

      {onEmail && (
        <Pressable style={styles.emailBtn} onPress={onEmail}>
          <Ionicons name="mail-outline" size={18} color={colors.primary} />
          <Text style={styles.emailText}>{t('receipt.email')}</Text>
        </Pressable>
      )}
      <Pressable style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneText}>{t('common.done')}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({

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
    emailBtn: { minHeight: 48, borderRadius: radius.control, borderWidth: 1.5, borderColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    emailText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.primary },

  });
}