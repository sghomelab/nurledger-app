import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NumberText } from '../NumberText';
import { formatMoney, formatMoneyBare, parseMoneyToMinor } from '../../lib/money';
import {
  acquirerFor,
  changeDue,
  evenSplit,
  paymentMethodsFor,
  type QRPrep,
} from '../../lib/payment';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import type { PaymentAllocation, PaymentMethodId } from '../../types';

type Method = PaymentMethodId | 'split';
type IconName = ComponentProps<typeof Ionicons>['name'];

interface MethodEntry {
  id: Method;
  label: string;
  icon: IconName;
  kind: 'cash' | 'card' | 'qr' | 'other';
  qrAcquirer?: string;
}

interface Props {
  totalMinor: number;
  currency: string;
  /** Outlet BCP-47 locale — selects the method list (FR-601). */
  locale?: string | null;
  onClose: () => void;
  /** Called with the payment allocations (summing to total) + cash change due. */
  onComplete: (payments: PaymentAllocation[], changeMinor: number) => void;
}

/**
 * Payment sheet (S-02, FR-107 + FR-601).
 *
 * The method list comes from the outlet's locale (Cash / Card / PayNow QR in
 * en-SG, Touch 'n Go in en-MY, generic fallback elsewhere). QR runs through
 * the `QRAcquirer` seam — the M5 stub shows a reference code + note, and the
 * reference is recorded on the payment row (auditable, no live acquirer —
 * ADR-006).
 */
export function PaymentSheet({ totalMinor, currency, locale, onClose, onComplete }: Props) {
  const [method, setMethod] = useState<Method>('cash');
  const [tender, setTender] = useState('');
  /** QR stub preparation (reference code) — required before "confirm paid". */
  const [qrPrep, setQrPrep] = useState<QRPrep | null>(null);

  // Locale methods + a Split entry (even split across the first two non-QR).
  const entries: MethodEntry[] = useMemo(() => {
    const base = paymentMethodsFor(locale).map((m) => ({ ...m, icon: m.icon as IconName }));
    return [...base, { id: 'split' as const, label: 'Split', icon: 'swap-vertical-outline' as IconName, kind: 'other' as const }];
  }, [locale]);

  const activeEntry = entries.find((m) => m.id === method);
  const qrAcquirer = activeEntry?.qrAcquirer ? acquirerFor(activeEntry.qrAcquirer) : null;

  // A fresh QR is needed per transaction — reset when the method changes.
  useEffect(() => {
    setQrPrep(null);
  }, [method]);

  const tenderMinor = parseMoneyToMinor(tender);
  const change = changeDue(tenderMinor, totalMinor);
  const cashOk = tenderMinor >= totalMinor;
  const qrOk = qrPrep != null;
  const canComplete = method === 'cash' ? cashOk : method === 'qr' ? qrOk : true;

  const quick = useMemo(() => {
    const set = new Set<number>([totalMinor]);
    for (const d of [1000, 2000, 5000, 10000, 20000, 50000]) if (d > totalMinor) set.add(d);
    return [...set].sort((a, b) => a - b).slice(0, 4);
  }, [totalMinor]);

  // Split across the first two real (non-QR, non-split) methods.
  const splitAllocs = useMemo(() => {
    const ids = entries
      .filter((m) => m.kind !== 'qr' && m.id !== 'split')
      .map((m) => m.id as PaymentMethodId)
      .slice(0, 2);
    return evenSplit(totalMinor, ids);
  }, [entries, totalMinor]);

  function complete() {
    if (!canComplete) return;
    if (method === 'cash') onComplete([{ method: 'cash', amountMinor: totalMinor }], change);
    else if (method === 'split') onComplete(splitAllocs, 0);
    else if (method === 'qr') {
      // The stub's reference rides on the payment row (payment.reference).
      onComplete([{ method: 'qr', amountMinor: totalMinor, reference: qrPrep!.reference }], 0);
    } else onComplete([{ method, amountMinor: totalMinor }], 0);
  }

  const stubIcon: IconName =
    method === 'card' ? 'card-outline' : method === 'qr' ? 'qr-code-outline' : 'phone-portrait-outline';

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>TOTAL DUE</Text>
        <NumberText style={styles.headerValue}>{formatMoney(totalMinor, currency)}</NumberText>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <View style={styles.grid}>
          {entries.map((m) => {
            const active = m.id === method;
            return (
              <Pressable
                key={m.id}
                onPress={() => setMethod(m.id)}
                style={({ pressed }) => [styles.gridBtn, active && styles.gridBtnActive, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name={m.icon} size={20} color={active ? colors.white : colors.slate700} />
                <Text style={[styles.gridLabel, active && { color: colors.white }]} numberOfLines={1}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {method === 'cash' && (
          <View style={styles.panel}>
            <View style={styles.quickRow}>
              {quick.map((q) => (
                <Pressable key={q} onPress={() => setTender(formatMoneyBare(q))} style={styles.quickBtn}>
                  <NumberText style={styles.quickText}>{formatMoney(q, currency)}</NumberText>
                </Pressable>
              ))}
            </View>
            <View style={styles.tenderRow}>
              <Text style={styles.tenderLabel}>Cash tendered</Text>
              <TextInput
                value={tender}
                onChangeText={setTender}
                keyboardType="decimal-pad"
                placeholder="0.00"
                style={styles.tenderInput}
              />
            </View>
            <View style={styles.changeRow}>
              <Text style={styles.changeLabel}>Change due</Text>
              <NumberText style={[styles.changeValue, change > 0 ? { color: colors.positive } : null]}>
                {formatMoney(change, currency)}
              </NumberText>
            </View>
          </View>
        )}

        {method === 'split' && (
          <View style={styles.panel}>
            {splitAllocs.map((a) => {
              const label = entries.find((m) => m.id === a.method)?.label ?? a.method;
              return (
                <View key={a.method} style={styles.splitRow}>
                  <Text style={styles.splitLabel}>{label}</Text>
                  <NumberText style={styles.splitValue}>{formatMoney(a.amountMinor, currency)}</NumberText>
                </View>
              );
            })}
            <Text style={styles.hint}>Split evenly across the first two methods (FR-107).</Text>
          </View>
        )}

        {method === 'qr' && (
          <View style={styles.panel}>
            {!qrPrep ? (
              <>
                <Ionicons name="qr-code-outline" size={40} color={colors.slate300} />
                <Text style={styles.stubTitle}>{activeEntry?.label}</Text>
                <Text style={styles.hint}>Prepare the payment to show the customer a reference.</Text>
                <Pressable
                  style={styles.qrPrepareBtn}
                  onPress={() => {
                    if (qrAcquirer) setQrPrep(qrAcquirer.prepare(totalMinor, currency));
                  }}
                >
                  <Text style={styles.qrPrepareText}>Prepare QR</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.qrRefLabel}>REFERENCE</Text>
                <Text style={styles.qrRef}>{qrPrep.reference}</Text>
                <Text style={styles.qrAmount}>{formatMoney(totalMinor, currency)} due</Text>
                <Text style={styles.hint}>{qrPrep.note}</Text>
              </>
            )}
          </View>
        )}

        {(method === 'card' || method === 'mobile') && (
          <View style={styles.panel}>
            <Ionicons name={stubIcon} size={40} color={colors.slate300} />
            <Text style={styles.stubTitle}>
              {method === 'card' ? 'Charge on terminal' : 'Mobile wallet'}
            </Text>
            <Text style={styles.hint}>
              MVP stub (ADR-006):{' '}
              {method === 'card'
                ? 'tender via the external card terminal'
                : 'confirm the wallet payment at the counter'}{' '}
              — no live acquirer is wired.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.completeBtn, !canComplete && { opacity: 0.5 }]}
          onPress={complete}
          disabled={!canComplete}
        >
          <Text style={styles.completeText}>
            {method === 'cash' ? 'Complete sale' : method === 'qr' && !qrPrep ? 'Prepare first' : 'Confirm paid'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50, padding: spacing.lg, gap: spacing.md },
  header: { alignItems: 'center', gap: 2, paddingVertical: spacing.sm },
  headerLabel: { fontFamily: fonts.sansMedium, fontSize: typography.caption, color: colors.slate500, letterSpacing: 1 },
  headerValue: { fontFamily: fonts.monoSemiBold, fontSize: 30, color: colors.slate900 },
  scroll: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridBtn: {
    flexBasis: '30%',
    flexGrow: 1,
    height: 72,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  gridBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  gridLabel: { fontFamily: fonts.sansMedium, fontSize: typography.caption, color: colors.slate700 },
  panel: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.lg,
    gap: spacing.md,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickBtn: {
    flexBasis: '46%',
    flexGrow: 1,
    height: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.slate50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { fontSize: typography.body, color: colors.slate700 },
  tenderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  tenderLabel: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 },
  tenderInput: {
    flex: 1,
    fontFamily: fonts.monoSemiBold,
    fontSize: 22,
    color: colors.slate900,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: colors.slate300,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  changeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeLabel: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 },
  changeValue: { fontFamily: fonts.monoSemiBold, fontSize: 22, color: colors.slate900 },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  splitLabel: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate700 },
  splitValue: { fontSize: typography.body },
  stubTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900, textAlign: 'center' },
  hint: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, textAlign: 'center', lineHeight: 17 },
  qrPrepareBtn: {
    height: 48,
    borderRadius: radius.control,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrPrepareText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
  qrRefLabel: { fontFamily: fonts.sansMedium, fontSize: typography.caption, color: colors.slate500, letterSpacing: 1, textAlign: 'center' },
  qrRef: { fontFamily: fonts.monoSemiBold, fontSize: 26, color: colors.slate900, textAlign: 'center', letterSpacing: 1 },
  qrAmount: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.slate700, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: {
    flex: 1,
    height: 54,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate300,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  completeBtn: {
    flex: 2,
    height: 54,
    borderRadius: radius.control,
    backgroundColor: colors.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
});
