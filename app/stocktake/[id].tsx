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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getStocktakeDetail,
  saveCount,
  applyStocktake,
  type StocktakeDetail,
} from '../../src/repositories/stocktakeRepository';
import { lineVariance, summarizeVariance } from '../../src/lib/stocktake';
import { roleCanAct } from '../../src/lib/roles';
import { NumberText } from '../../src/components/NumberText';
import { Chip } from '../../src/components/Chip';
import { PinPrompt } from '../../src/components/PinPrompt';
import { getActiveUser, listActiveUsers } from '../../src/repositories/userRepository';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';
import type { AppUser } from '../../src/types';

/**
 * Stocktake detail (FR-304) — count → review variances → apply (gated).
 *
 * Count phase: one numeric field per in-scope product (grams for weighed,
 * units otherwise). Blind stocktakes hide the book quantity while counting.
 *
 * Review: variance = counted − LIVE book (stock_view at review time), so
 * sales that happen mid-count don't skew the applied adjustment. The
 * `expected_qty` snapshot at creation is shown for record only.
 *
 * Apply (gated `stocktake_apply`): one atomic transaction — an 'adjustment'
 * ledger row + 'ledger' sync op per non-zero variance, then the stocktake is
 * marked applied and the screen becomes read-only.
 */
export default function StocktakeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<StocktakeDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Count input state, keyed by product id. "" = not counted. */
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [gateVisible, setGateVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeUser, setActiveUser] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<AppUser[] | null>(null);

  const load = useCallback(async () => {
    const d = id ? await getStocktakeDetail(id) : null;
    setDetail(d);
    if (d) {
      const c: Record<string, string> = {};
      for (const l of d.lines) c[l.productId] = l.countedQty === null ? '' : String(l.countedQty);
      setCounts(c);
    }
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    void load();
    void Promise.all([getActiveUser(), listActiveUsers()]).then(([u, all]) => {
      setActiveUser(u);
      setUsers(all);
    });
  }, [load]);

  const applied = detail?.header.appliedAt != null;
  const blind = detail?.header.blind ?? false;

  const onCountChange = (productId: string, text: string) => {
    setCounts((s) => ({ ...s, [productId]: text.replace(/\D/g, '') }));
  };

  const onCountBlur = (productId: string) => {
    if (!id || !detail) return;
    const raw = counts[productId] ?? '';
    const line = detail.lines.find((l) => l.productId === productId);
    if (!line) return;
    const value = raw === '' ? null : parseInt(raw, 10) || 0;
    if (line.countedQty === value) return; // nothing changed
    void saveCount(id, productId, value).then(() => {
      // Refresh book + counts (the review numbers are live anyway).
      void load();
    });
  };

  // ---- live variance review (pure lib over the current inputs) ----
  const review = useMemo(() => {
    if (!detail) return null;
    const lines = detail.lines.map((l) => {
      const raw = counts[l.productId];
      const counted = raw === '' || raw === undefined ? null : parseInt(raw, 10) || 0;
      return { ...l, counted: counted ?? null, variance: lineVariance({ bookQty: l.bookQty, countedQty: counted }) };
    });
    const summary = summarizeVariance(
      lines.map((l) => ({ bookQty: l.bookQty, countedQty: l.counted })),
    );
    return { lines, summary };
  }, [detail, counts]);

  const doApply = async () => {
    if (!id || !detail) return;
    setBusy(true);
    try {
      const r = await applyStocktake(id);
      await load();
      Alert.alert(
        'Stocktake applied',
        `${r.appliedLines} adjustment${r.appliedLines === 1 ? '' : 's'} written to the stock ledger.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert('Apply failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const requestApply = () => {
    if (!review || review.summary.netVariance === 0) return;
    if (activeUser && roleCanAct(activeUser.role, 'stocktake_apply')) {
      void doApply();
      return;
    }
    setGateVisible(true);
  };

  if (!loaded) {
    return <View style={styles.wrap} />;
  }
  if (!detail || !review) {
    return (
      <View style={styles.center}>
        <Ionicons name="clipboard-outline" size={40} color={colors.slate300} />
        <Text style={styles.missing}>Stocktake not found.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const { header, lines } = detail;
  const net = review.summary.netVariance;

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={colors.slate500} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {header.categoryName ?? 'All products'}
          </Text>
          <Text style={styles.meta}>
            {new Date(header.startedAt).toLocaleString()} · {header.lineCount} products
          </Text>
        </View>
        {applied ? (
          <Chip label="Applied" tone="positive" />
        ) : blind ? (
          <Chip label="Blind count" tone="primary" />
        ) : (
          <Chip label="Counting" tone="primary" />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Variance review */}
        <Text style={styles.sectionTitle}>Variance review</Text>
        <View style={styles.tableHead}>
          <Text style={[styles.tableCol, { flex: 1 }]}>Product</Text>
          <Text style={[styles.tableCol, styles.tableNum]}>Book</Text>
          <Text style={[styles.tableCol, styles.tableNum]}>Counted</Text>
          <Text style={[styles.tableCol, styles.tableNum]}>Variance</Text>
        </View>
        {review.lines.map((l) => {
          const v = l.variance;
          return (
            <View key={l.productId} style={styles.tableRow}>
              <Text style={[styles.tableCol, { flex: 1 }]} numberOfLines={1}>
                {l.name}
                <Text style={styles.unitTag}> {l.isWeighed ? 'g' : 'ea'}</Text>
              </Text>
              <NumberText style={[styles.tableCol, styles.tableNum]}>
                {blind && !applied ? '—' : l.bookQty}
              </NumberText>
              <NumberText style={[styles.tableCol, styles.tableNum]}>{l.countedQty ?? '—'}</NumberText>
              <NumberText
                style={[
                  styles.tableCol,
                  styles.tableNum,
                  v !== null && v > 0 && { color: colors.positive },
                  v !== null && v < 0 && { color: colors.danger },
                ]}
              >
                {v === null ? '—' : v > 0 ? `+${v}` : String(v)}
              </NumberText>
            </View>
          );
        })}

        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Counted</Text>
            <NumberText style={styles.summaryValue}>{review.summary.counted}/{review.summary.total}</NumberText>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Gains</Text>
            <NumberText style={[styles.summaryValue, { color: colors.positive }]}>{review.summary.gains}</NumberText>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Shrinkage</Text>
            <NumberText style={[styles.summaryValue, { color: colors.danger }]}>{review.summary.losses}</NumberText>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Net</Text>
            <NumberText
              style={[
                styles.summaryValue,
                net > 0 && { color: colors.positive },
                net < 0 && { color: colors.danger },
              ]}
            >
              {net > 0 ? `+${net}` : String(net)}
            </NumberText>
          </View>
        </View>
        <Text style={styles.hint}>
          Variance = counted − current book stock (live). Weighed products count in grams.
        </Text>

        {/* Count input */}
        <Text style={styles.sectionTitle}>Counts{blind ? ' (blind — book hidden until applied)' : ''}</Text>
        {lines.map((l) => {
          const raw = counts[l.productId] ?? '';
          return (
            <View key={l.productId} style={styles.countRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.countName} numberOfLines={1}>
                  {l.name}
                  <Text style={styles.unitTag}> · {l.isWeighed ? 'grams' : 'units'}</Text>
                </Text>
                {!blind && (
                  <Text style={styles.countMeta}>
                    book {l.bookQty} · expected at start {l.expectedQty ?? '—'}
                  </Text>
                )}
              </View>
              <TextInput
                style={[styles.countInput, raw !== '' && { borderColor: colors.primary }]}
                keyboardType="number-pad"
                placeholder={blind ? '0' : String(l.bookQty)}
                placeholderTextColor={colors.slate300}
                value={raw}
                onChangeText={(t) => onCountChange(l.productId, t)}
                onBlur={() => onCountBlur(l.productId)}
                editable={!applied}
                maxLength={8}
              />
            </View>
          );
        })}

        {applied && (
          <View style={styles.appliedBox}>
            <Ionicons name="checkmark-circle" size={20} color={colors.positive} />
            <Text style={styles.appliedText}>
              Applied {new Date(header.appliedAt!).toLocaleString()} — adjustments are in the stock ledger.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Apply CTA */}
      {!applied && (
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.applyBtn,
              (busy || net === 0) && { opacity: 0.5 },
              pressed && net !== 0 && !busy && { opacity: 0.9 },
            ]}
            onPress={requestApply}
            disabled={busy || net === 0}
          >
            <Text style={styles.applyText}>
              {busy ? 'Applying…' : net === 0 ? 'No variance to apply' : `Apply variance (${net > 0 ? `+${net}` : net})`}
            </Text>
          </Pressable>
        </View>
      )}

      {gateVisible && (
        <PinPrompt
          visible
          action="stocktake_apply"
          users={users ?? []}
          onSuccess={() => {
            setGateVisible(false);
            void doApply();
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
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate300,
    marginLeft: spacing.lg,
  },
  backText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 },
  meta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 2 },

  sectionTitle: {
    fontFamily: fonts.sansBold,
    fontSize: typography.heading,
    color: colors.slate700,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate100,
  },
  tableCol: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate700 },
  tableNum: { width: 64, textAlign: 'right', fontFamily: fonts.mono, color: colors.slate700 },
  unitTag: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },

  summaryRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    paddingVertical: spacing.md,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  summaryLabel: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  summaryValue: { fontFamily: fonts.monoSemiBold, fontSize: typography.body, color: colors.slate900 },
  hint: {
    fontFamily: fonts.sans,
    fontSize: typography.micro,
    color: colors.slate400,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },

  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  countName: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
  countMeta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 2 },
  countInput: {
    width: 96,
    height: 40,
    borderWidth: 1,
    borderColor: colors.slate300,
    borderRadius: radius.control,
    paddingHorizontal: spacing.sm,
    textAlign: 'right',
    fontFamily: fonts.mono,
    fontSize: typography.body,
    color: colors.slate900,
    backgroundColor: colors.white,
  },

  appliedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.positiveSoft,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  appliedText: { flex: 1, fontFamily: fonts.sans, fontSize: typography.caption, color: colors.positive },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.slate200,
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.control,
    alignItems: 'center',
    paddingVertical: 14,
  },
  applyText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.white },
});
