import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  TextInput,
  Switch,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOutlet } from '../../src/hooks/useAppData';
import { getRefundContext, createRefund, type RefundableLine } from '../../src/repositories/refundRepository';
import {
  REFUND_REASONS,
  lineFullRefundValues,
  validateRefundLine,
  type RefundLineInput,
  type RefundReason,
} from '../../src/lib/refund';
import { roleCanAct } from '../../src/lib/roles';
import { formatMoney } from '../../src/lib/money';
import { NumberText } from '../../src/components/NumberText';
import { Chip } from '../../src/components/Chip';
import { PickerOverlay } from '../../src/components/PickerOverlay';
import { PinPrompt } from '../../src/components/PinPrompt';
import { getActiveUser, listActiveUsers } from '../../src/repositories/userRepository';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';
import type { AppUser } from '../../src/types';

const REASON_LABELS: Record<RefundReason, string> = {
  customer_return: 'Customer return',
  wrong_item: 'Wrong item',
  damaged: 'Damaged',
  pricing_error: 'Pricing error',
  order_mistake: 'Order mistake',
  other: 'Other',
};

/** Per-line local edit state. */
interface LineState {
  /** Each items: units selected (0 = not refunded). */
  qty: number;
  /** Weighed items: grams, as typed ("" = not selected). */
  grams: string;
  restock: boolean;
}

/**
 * Refund a sale (FR-110/FR-111) — fully offline.
 *
 * Entry: Insights → sales history row. The sale is never mutated (ADR-002):
 * this writes an append-only refund record (+ per-line restock stock moves,
 * re-entering the FIFO layers at sale-time cost) and queues the sync op.
 * Gated: cashiers need the owner/manager PIN (FR-501, `refund` gate).
 */
export default function RefundScreen() {
  const router = useRouter();
  const { saleId } = useLocalSearchParams<{ saleId: string }>();
  const { outlet } = useOutlet();
  const currency = outlet?.currency ?? 'SGD';

  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getRefundContext>> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [masterRestock, setMasterRestock] = useState(true);
  const [reason, setReason] = useState<RefundReason | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeUser, setActiveUser] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<AppUser[] | null>(null);

  const load = useCallback(async () => {
    const c = saleId ? await getRefundContext(saleId) : null;
    setCtx(c);
    if (c) {
      const init: Record<string, LineState> = {};
      for (const l of c.lines) {
        init[l.saleLineId] = {
          qty: 0,
          grams: '',
          restock: true, // the master toggle (default ON) applies on change
        };
      }
      setLines(init);
      setMasterRestock(true);
    }
    setLoaded(true);
  }, [saleId]);

  useEffect(() => {
    void load();
    void Promise.all([getActiveUser(), listActiveUsers()]).then(([u, all]) => {
      setActiveUser(u);
      setUsers(all);
    });
  }, [load]);

  const setLineQty = (line: RefundableLine, qty: number) => {
    const remaining = line.qty - line.refundedQty;
    setLines((s) => {
      const next: Record<string, LineState> = { ...s };
      const cur = s[line.saleLineId] ?? { qty: 0, grams: '', restock: true };
      next[line.saleLineId] = { ...cur, qty: Math.max(0, Math.min(remaining, qty)) };
      return next;
    });
  };

  const setLineGrams = (line: RefundableLine, grams: string) => {
    // Digits only; clamped against the refundable remainder on submit/display.
    setLines((s) => {
      const next: Record<string, LineState> = { ...s };
      const cur = s[line.saleLineId] ?? { qty: 0, grams: '', restock: true };
      next[line.saleLineId] = { ...cur, grams: grams.replace(/\D/g, '') };
      return next;
    });
  };

  const applyMasterRestock = (on: boolean) => {
    setMasterRestock(on);
    setLines((s) => {
      const next: Record<string, LineState> = {};
      for (const k of Object.keys(s)) {
        const cur = s[k] ?? { qty: 0, grams: '', restock: true };
        next[k] = { ...cur, restock: on };
      }
      return next;
    });
  };

  // ---- live refund total (pure lib, same math the repository will execute) ----
  const totals = useMemo(() => {
    if (!ctx) return { totalMinor: 0, perLine: new Map<string, number>() };
    const fullValues = lineFullRefundValues(ctx.lines, ctx.totalMinor);
    const perLine = new Map<string, number>();
    let total = 0;
    ctx.lines.forEach((l, i) => {
      const st = lines[l.saleLineId];
      if (!st) return;
      const units = l.isWeighed ? (l.qtyG ?? 0) : l.qty;
      const already = l.isWeighed ? (l.refundedQtyG ?? 0) : l.refundedQty;
      const requested = l.isWeighed ? (st.grams === '' ? 0 : parseInt(st.grams, 10) || 0) : st.qty;
      if (requested <= 0) return;
      const v = validateRefundLine(fullValues[i]!, units, already, requested);
      if (v.ok) {
        perLine.set(l.saleLineId, v.amountMinor);
        total += v.amountMinor;
      }
    });
    return { totalMinor: total, perLine };
  }, [ctx, lines]);

  const selectedCount = ctx ? ctx.lines.filter((l) => {
    const st = lines[l.saleLineId];
    if (!st) return false;
    return l.isWeighed ? st.grams !== '' : st.qty > 0;
  }).length : 0;

  const canSubmit = selectedCount > 0 && reason !== null && !busy;

  const doRefund = async () => {
    if (!ctx || !reason) return;
    const inputs: RefundLineInput[] = [];
    for (const l of ctx.lines) {
      const st = lines[l.saleLineId];
      if (!st) continue;
      const qty = l.isWeighed ? 0 : st.qty;
      const qtyG = l.isWeighed ? (st.grams === '' ? 0 : parseInt(st.grams, 10) || 0) : null;
      if (qty <= 0 && (qtyG ?? 0) <= 0) continue;
      inputs.push({ saleLineId: l.saleLineId, qty, qtyG, restock: st.restock });
    }
    setBusy(true);
    try {
      const { totalMinor } = await createRefund({
        saleId: ctx.saleId,
        inputs,
        reasonCode: reason,
        masterRestock,
        userId: activeUser?.id ?? null,
      });
      Alert.alert('Refund complete', `Refunded ${formatMoney(totalMinor, currency)}.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Refund failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const requestRefund = () => {
    // FR-501: refunds are gated for cashiers (owner/manager act directly).
    if (activeUser && roleCanAct(activeUser.role, 'refund')) {
      void doRefund();
      return;
    }
    setGateVisible(true);
  };

  if (loaded && !ctx) {
    return (
      <View style={styles.center}>
        <Ionicons name="checkmark-circle" size={40} color={colors.positive} />
        <Text style={styles.missing}>This sale has no refundable lines left.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!ctx) {
    return <View style={styles.center}><Text style={styles.missing}>Loading…</Text></View>;
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={false} tintColor={colors.slate300} onRefresh={() => void load()} />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.slate700} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Refund sale</Text>
            <Text style={styles.meta}>
              {new Date(ctx.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>
          </View>
          <NumberText style={styles.saleTotal}>{formatMoney(ctx.totalMinor, currency)}</NumberText>
        </View>

        {/* Master restock toggle */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Restock returned goods</Text>
              <Text style={styles.hint}>Refunded items go back to stock (FIFO, at sale-time cost).</Text>
            </View>
            <Switch
              value={masterRestock}
              onValueChange={applyMasterRestock}
              trackColor={{ true: colors.positive, false: colors.slate300 }}
              accessibilityLabel="Restock returned goods"
            />
          </View>

          {/* Reason (required, FR-110) */}
          <Pressable style={styles.reasonBtn} onPress={() => setPickerVisible(true)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.reasonLabel}>Reason * (required)</Text>
              <Text style={reason ? styles.reasonValue : styles.reasonPlaceholder}>
                {reason ? REASON_LABELS[reason] : 'Select a reason…'}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={colors.slate400} />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Lines</Text>
        <View style={styles.card}>
          {ctx.lines.map((l, i) => {
            const st = lines[l.saleLineId];
            const remaining = l.isWeighed ? (l.qtyG ?? 0) - (l.refundedQtyG ?? 0) : l.qty - l.refundedQty;
            const requested = st ? (l.isWeighed ? (st.grams === '' ? 0 : parseInt(st.grams, 10) || 0) : st.qty) : 0;
            const overGrams = l.isWeighed && requested > remaining;
            const amount = totals.perLine.get(l.saleLineId) ?? 0;
            return (
              <View key={l.saleLineId} style={[styles.lineRow, i > 0 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={styles.lineName} numberOfLines={1}>{l.name}</Text>
                    {l.isWeighed && <Chip label="WEIGHED" tone="warning" />}
                  </View>
                  <Text style={styles.lineMeta} numberOfLines={1}>
                    {l.sku} · {formatMoney(l.unitPriceMinor, currency)}
                    {l.isWeighed ? '/kg' : ''} · sold {l.isWeighed ? `${l.qtyG} g` : `${l.qty}`}
                    {(l.refundedQty > 0 || (l.refundedQtyG ?? 0) > 0) &&
                      ` · refunded ${l.isWeighed ? `${l.refundedQtyG} g` : `${l.refundedQty}`}`}
                  </Text>
                </View>
                {requested > 0 && (
                  <NumberText style={[styles.lineAmount, overGrams && { color: colors.danger }]}>
                    {overGrams ? 'too many' : formatMoney(amount, currency)}
                  </NumberText>
                )}
              </View>
            );
          })}
        </View>

        {/* Per-line controls */}
        {ctx.lines.map((l) => {
          const st = lines[l.saleLineId];
          if (!st) return null;
          const remaining = l.isWeighed ? (l.qtyG ?? 0) - (l.refundedQtyG ?? 0) : l.qty - l.refundedQty;
          const requested = l.isWeighed ? (st.grams === '' ? 0 : parseInt(st.grams, 10) || 0) : st.qty;
          const overGrams = l.isWeighed && requested > remaining;
          return (
            <View key={`ctl-${l.saleLineId}`} style={styles.ctlRow}>
              <View style={{ flex: 1, gap: spacing.sm }}>
                {l.isWeighed ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <TextInput
                      style={[styles.gramsInput, overGrams && { borderColor: colors.danger }]}
                      value={st.grams}
                      onChangeText={(v) => setLineGrams(l, v)}
                      placeholder={`0 – ${remaining} g`}
                      placeholderTextColor={colors.slate400}
                      keyboardType="number-pad"
                    />
                    <Pressable style={styles.maxBtn} onPress={() => setLineGrams(l, String(remaining))}>
                      <Text style={styles.maxText}>Max</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <Pressable
                      style={[styles.stepBtn, st.qty === 0 && styles.stepBtnDisabled]}
                      onPress={() => setLineQty(l, st.qty - 1)}
                      disabled={st.qty === 0}
                      accessibilityLabel={`Decrease ${l.name}`}
                    >
                      <Ionicons name="remove" size={18} color={st.qty === 0 ? colors.slate300 : colors.slate700} />
                    </Pressable>
                    <NumberText style={styles.stepVal}>{st.qty}</NumberText>
                    <Pressable
                      style={[styles.stepBtn, st.qty >= remaining && styles.stepBtnDisabled]}
                      onPress={() => setLineQty(l, st.qty + 1)}
                      disabled={st.qty >= remaining}
                      accessibilityLabel={`Increase ${l.name}`}
                    >
                      <Ionicons name="add" size={18} color={st.qty >= remaining ? colors.slate300 : colors.slate700} />
                    </Pressable>
                    <Text style={styles.remaining}>of {remaining} left</Text>
                  </View>
                )}
                <Pressable
                  style={styles.lineRestock}
                  onPress={() =>
                    setLines((s) => {
                      const next: Record<string, LineState> = { ...s };
                      const cur = s[l.saleLineId] ?? { qty: 0, grams: '', restock: true };
                      next[l.saleLineId] = { ...cur, restock: !cur.restock };
                      return next;
                    })
                  }
                >
                  <Ionicons
                    name={st.restock ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={st.restock ? colors.positive : colors.slate400}
                  />
                  <Text style={[styles.lineRestockText, !st.restock && { color: colors.slate400 }]}>
                    Restock this line
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        {/* Total + CTA */}
        <View style={[styles.totalCard, { marginTop: spacing.lg }]}>
          <Text style={styles.totalLabel}>Refund total</Text>
          <NumberText style={styles.totalVal}>{formatMoney(totals.totalMinor, currency)}</NumberText>
          <Text style={styles.linesCount}>
            {selectedCount} line{selectedCount === 1 ? '' : 's'} selected
          </Text>
        </View>
      </ScrollView>

      <View style={styles.ctaBar}>
        <Pressable
          style={[styles.ctaBtn, !canSubmit && styles.ctaBtnDisabled]}
          onPress={requestRefund}
          disabled={!canSubmit}
        >
          <Text style={styles.ctaText}>
            {busy ? 'Refunding…' : `Refund ${formatMoney(totals.totalMinor, currency)}`}
          </Text>
        </Pressable>
      </View>

      {pickerVisible && (
        <PickerOverlay
          title="Refund reason"
          rows={REFUND_REASONS.map((r) => ({
            key: r,
            label: REASON_LABELS[r],
            onPress: () => {
              setReason(r);
              setPickerVisible(false);
            },
          }))}
          onClose={() => setPickerVisible(false)}
        />
      )}

      {gateVisible && (
        <PinPrompt
          visible
          action="refund"
          users={users ?? []}
          onSuccess={() => {
            setGateVisible(false);
            void doRefund();
          }}
          onCancel={() => setGateVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  center: {
    flex: 1,
    backgroundColor: colors.slate50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  missing: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500, textAlign: 'center' },
  backBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate300,
  },
  backText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  title: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 },
  meta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  saleTotal: { fontFamily: fonts.monoSemiBold, fontSize: typography.body, color: colors.slate900 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 2 },
  reasonBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.slate50,
  },
  reasonLabel: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  reasonValue: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
  reasonPlaceholder: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate400 },
  sectionTitle: {
    fontFamily: fonts.sansBold,
    fontSize: typography.micro,
    color: colors.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.slate100 },
  lineName: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
  lineMeta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 2 },
  lineAmount: { fontFamily: fonts.monoSemiBold, fontSize: typography.body, color: colors.slate900 },
  ctlRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  gramsInput: {
    flex: 1,
    height: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate300,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.mono,
    fontSize: typography.body,
    color: colors.slate900,
    backgroundColor: colors.white,
  },
  maxBtn: {
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.control,
    backgroundColor: colors.slate100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maxText: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.slate700 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.slate100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.5 },
  stepVal: { fontFamily: fonts.monoSemiBold, fontSize: typography.body, color: colors.slate900, minWidth: 28, textAlign: 'center' },
  remaining: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  lineRestock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineRestockText: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate700 },
  totalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.lg,
    alignItems: 'center',
  },
  totalLabel: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  totalVal: { fontFamily: fonts.monoSemiBold, fontSize: typography.title, color: colors.slate900, marginVertical: 4 },
  linesCount: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.slate200,
  },
  ctaBtn: {
    height: 52,
    borderRadius: radius.control,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnDisabled: { opacity: 0.45 },
  ctaText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
});
