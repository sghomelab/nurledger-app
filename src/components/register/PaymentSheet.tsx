import { useMemo, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NumberText } from '../NumberText';
import { formatMoney, formatMoneyBare, parseMoneyToMinor } from '../../lib/money';
import { changeDue, evenSplit } from '../../lib/payment';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import type { PaymentAllocation, PaymentMethodId } from '../../types';

type Method = PaymentMethodId | 'split';
type IconName = ComponentProps<typeof Ionicons>['name'];

const METHODS: { id: Method; label: string; icon: IconName }[] = [
  { id: 'cash', label: 'Cash', icon: 'cash-outline' },
  { id: 'card', label: 'Card', icon: 'card-outline' },
  { id: 'mobile', label: 'Mobile', icon: 'phone-portrait-outline' },
  { id: 'qr', label: 'QR Pay', icon: 'qr-code-outline' },
  { id: 'split', label: 'Split', icon: 'swap-vertical-outline' },
];

interface Props {
  totalMinor: number;
  currency: string;
  onClose: () => void;
  /** Called with the payment allocations (summing to total) + cash change due. */
  onComplete: (payments: PaymentAllocation[], changeMinor: number) => void;
}

/** Payment sheet (S-02, FR-107). Card/QR are ADR-006 stubs (no live acquirer). */
export function PaymentSheet({ totalMinor, currency, onClose, onComplete }: Props) {
  const [method, setMethod] = useState<Method>('cash');
  const [tender, setTender] = useState('');

  const tenderMinor = parseMoneyToMinor(tender);
  const change = changeDue(tenderMinor, totalMinor);
  const cashOk = tenderMinor >= totalMinor;
  const canComplete = method !== 'cash' ? true : cashOk;

  const quick = useMemo(() => {
    const set = new Set<number>([totalMinor]);
    for (const d of [1000, 2000, 5000, 10000, 20000, 50000]) if (d > totalMinor) set.add(d);
    return [...set].sort((a, b) => a - b).slice(0, 4);
  }, [totalMinor]);

  const splitAllocs = useMemo(() => evenSplit(totalMinor, ['cash', 'card']), [totalMinor]);

  function complete() {
    if (!canComplete) return;
    if (method === 'cash') onComplete([{ method: 'cash', amountMinor: totalMinor }], change);
    else if (method === 'split') onComplete(splitAllocs, 0);
    else onComplete([{ method, amountMinor: totalMinor }], 0);
  }

  const stubIcon: IconName =
    method === 'card' ? 'card-outline' : method === 'qr' ? 'qr-code-outline' : 'phone-portrait-outline';

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>TOTAL DUE</Text>
        <NumberText style={styles.headerValue}>{formatMoney(totalMinor, currency)}</NumberText>
      </View>

      <View style={styles.grid}>
        {METHODS.map((m) => {
          const active = m.id === method;
          return (
            <Pressable
              key={m.id}
              onPress={() => setMethod(m.id)}
              style={({ pressed }) => [styles.gridBtn, active && styles.gridBtnActive, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name={m.icon} size={20} color={active ? colors.white : colors.slate700} />
              <Text style={[styles.gridLabel, active && { color: colors.white }]}>{m.label}</Text>
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
          {splitAllocs.map((a) => (
            <View key={a.method} style={styles.splitRow}>
              <Text style={styles.splitLabel}>{a.method === 'cash' ? 'Cash' : 'Card'}</Text>
              <NumberText style={styles.splitValue}>{formatMoney(a.amountMinor, currency)}</NumberText>
            </View>
          ))}
          <Text style={styles.hint}>Split evenly across Cash + Card (FR-107).</Text>
        </View>
      )}

      {(method === 'card' || method === 'mobile' || method === 'qr') && (
        <View style={styles.panel}>
          <Ionicons name={stubIcon} size={40} color={colors.slate300} />
          <Text style={styles.stubTitle}>
            {method === 'card' ? 'Charge on terminal' : method === 'qr' ? 'Customer pays QR' : 'Mobile wallet'}
          </Text>
          <Text style={styles.hint}>
            MVP stub (ADR-006):{' '}
            {method === 'card'
              ? 'tender via the external card terminal'
              : 'confirm the wallet / QR payment at the counter'}{' '}
            — no live acquirer is wired.
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.completeBtn, !canComplete && { opacity: 0.5 }]}
          onPress={complete}
          disabled={!canComplete}
        >
          <Text style={styles.completeText}>{method === 'cash' ? 'Complete sale' : 'Confirm paid'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50, padding: spacing.lg, gap: spacing.lg },
  header: { alignItems: 'center', gap: 2, paddingVertical: spacing.sm },
  headerLabel: { fontFamily: fonts.sansMedium, fontSize: typography.caption, color: colors.slate500, letterSpacing: 1 },
  headerValue: { fontFamily: fonts.monoSemiBold, fontSize: 30, color: colors.slate900 },
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
  hint: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: 'auto' },
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
