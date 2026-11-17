import { useT } from '../../src/hooks/useT';
import { centeredColumn } from '../../src/lib/layout';
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../src/components/Screen';
import { NumberText } from '../../src/components/NumberText';
import { useOutlet } from '../../src/hooks/useAppData';
import { useUsers } from '../../src/hooks/useShift';
import { getSale } from '../../src/repositories/saleRepository';
import { getRefundContext } from '../../src/repositories/refundRepository';
import { paymentMethodLabel } from '../../src/lib/receipt';
import { formatMoney } from '../../src/lib/money';
import { useTheme } from '../../src/theme/ThemeContext';
import { fonts, radius, spacing, typography, type Palette } from '../../src/theme/tokens';
import type { CompletedSale } from '../../src/types';

/**
 * Sale detail (issue #20) — the history rows now open HERE instead of
 * jumping straight into the refund flow. The refund is an explicit action
 * (the button below); the sale itself is read-only and never mutated
 * (ADR-002).
 */
export default function SaleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { outlet } = useOutlet();
  const { users } = useUsers();

  const [sale, setSale] = useState<CompletedSale | null>(null);
  // null = loading · true = refund still possible · false = fully refunded.
  const [refundable, setRefundable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSale(id);
      if (cancelled) return;
      setSale(s);
      if (s) {
        const ctx = await getRefundContext(id);
        if (!cancelled) setRefundable(ctx !== null);
      } else {
        setRefundable(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currency = outlet?.currency ?? 'SGD';
  const number = sale ? sale.uuid.slice(0, 8).toUpperCase() : '';
  const stamp = sale
    ? new Date(sale.createdAt).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const cashierName = sale?.cashierId
    ? users?.find((u) => u.id === sale.cashierId)?.name ?? '—'
    : null;

  if (!sale && refundable === null) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!sale) {
    return (
      <View style={[styles.flex, styles.center]}>
        <Ionicons name="receipt-outline" size={40} color={colors.slate400} />
        <Text style={styles.emptyText}>{t('sale.noSale')}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.content, centeredColumn]}>
      {/* Header: number · date · status */}
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headNumber}>#{number}</Text>
          <Text style={styles.headStamp}>{stamp}</Text>
        </View>
        {refundable === false && (
          <View style={styles.refundedChip}>
            <Ionicons name="checkmark-done" size={14} color={colors.danger} />
            <Text style={styles.refundedChipText}>{t('sale.fullyRefunded')}</Text>
          </View>
        )}
      </View>

      {/* Lines */}
      <Card>
        <Text style={styles.cardTitle}>{t('sale.items')}</Text>
        {sale.lines.map((l) => (
          <View key={l.id} style={styles.lineRow}>
            <View style={styles.lineTexts}>
              <Text style={styles.lineName}>{l.name}</Text>
              <Text style={styles.lineMeta}>
                {l.qty}× {formatMoney(l.unitPriceMinor, currency)}
                {l.qtyG != null ? ` · ${l.qtyG} g` : ''}
              </Text>
            </View>
            <NumberText style={styles.lineTotal}>{formatMoney(l.lineTotalMinor, currency)}</NumberText>
          </View>
        ))}
      </Card>

      {/* Totals + payment */}
      <Card>
        <TotalRow label={t('totals.subtotal')} amount={sale.subtotalMinor} currency={currency} style={styles.totalRow} amountStyle={styles.totalAmount} />
        {sale.discountMinor > 0 && (
          <TotalRow label={t('totals.discount')} amount={-sale.discountMinor} currency={currency} style={styles.totalRow} amountStyle={styles.totalAmount} />
        )}
        {sale.taxMinor > 0 && (
          <TotalRow label={t('settings.tax')} amount={sale.taxMinor} currency={currency} style={styles.totalRow} amountStyle={styles.totalAmount} />
        )}
        <TotalRow
          label={t('totals.total')}
          amount={sale.totalMinor}
          currency={currency}
          style={[styles.totalRow, styles.totalRowGrand, { borderTopColor: colors.slate200 }]}
          amountStyle={[styles.totalAmount, { fontFamily: fonts.monoSemiBold, color: colors.positive }]}
        />
        <View style={[styles.totalRow, { paddingTop: spacing.sm, borderTopWidth: 0 }]}>
          <Text style={styles.metaLabel}>{t('sale.paidWith')}</Text>
          <Text style={styles.metaValue}>
            {sale.payments.map((p) => paymentMethodLabel(p.method, outlet?.locale ?? null)).join(' + ')}
          </Text>
        </View>
        {cashierName && (
          <View style={styles.totalRow}>
            <Text style={styles.metaLabel}>{t('sale.cashier')}</Text>
            <Text style={styles.metaValue}>{cashierName}</Text>
          </View>
        )}
      </Card>

      {/* Explicit refund action (issue #20) */}
      {refundable === true && (
        <Pressable
          style={({ pressed }) => [styles.refundBtn, pressed && { opacity: 0.85 }]}
          onPress={() => router.push(`/refund/${sale.id}`)}
        >
          <Ionicons name="return-up-back-outline" size={18} color={colors.danger} />
          <Text style={styles.refundBtnText}>{t('refund.refundSale')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function TotalRow({
  label,
  amount,
  currency,
  style,
  amountStyle,
}: {
  label: string;
  amount: number;
  currency: string;
  style: object;
  amountStyle?: object;
}) {
  const { colors } = useTheme();
  return (
    <View style={style}>
      <Text style={[{ fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 }]}>{label}</Text>
      <NumberText style={[{ fontFamily: fonts.mono, fontSize: typography.body, color: colors.slate900 }, amountStyle]}>
        {amount < 0 ? '−' : ''}
        {formatMoney(Math.abs(amount), currency)}
      </NumberText>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.slate50 },
    center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    content: { padding: spacing.lg, paddingBottom: 40 },
    emptyText: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 },
    headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    headNumber: { fontFamily: fonts.monoSemiBold, fontSize: typography.title, color: colors.slate900 },
    headStamp: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, marginTop: 2 },
    refundedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.chip,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    refundedChipText: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger },
    cardTitle: { fontFamily: fonts.sansBold, fontSize: typography.caption, color: colors.slate500, marginBottom: spacing.sm },
    lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
    lineTexts: { flex: 1 },
    lineName: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
    lineMeta: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, marginTop: 2 },
    lineTotal: { fontFamily: fonts.mono, fontSize: typography.body, color: colors.slate900 },
    totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm + 2, gap: spacing.sm },
    totalRowGrand: { marginTop: spacing.xs, paddingTop: spacing.md, borderTopWidth: 1 },
    totalAmount: { fontFamily: fonts.mono, fontSize: typography.body, color: colors.slate900 },
    metaLabel: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
    metaValue: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700 },
    refundBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 54,
      borderRadius: radius.control,
      borderWidth: 1.5,
      borderColor: colors.danger,
      backgroundColor: colors.white,
      marginTop: spacing.lg,
    },
    refundBtnText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.danger },
  });
}
