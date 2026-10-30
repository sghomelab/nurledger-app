import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { FlatList, Pressable, Text, StyleSheet, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { expiryRadar } from '../../src/repositories/stockRepository';
import { type ExpiryRadarEntry, type ExpiryRadarSummary, type ExpiryUrgency } from '../../src/types';
import { NumberText } from '../../src/components/NumberText';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';

const URGENCY_META: Record<ExpiryUrgency, { label: string; color: string; bg: string }> = {
  expired: { label: 'Expired', color: colors.danger, bg: colors.dangerSoft },
  critical: { label: 'Critical', color: colors.danger, bg: colors.dangerSoft },
  soon: { label: 'Soon', color: '#B45309', bg: colors.warningSoft },
  ok: { label: 'OK', color: colors.positive, bg: colors.positiveSoft },
};

function fmtDays(daysLeft: number): string {
  if (!Number.isFinite(daysLeft)) return '—';
  if (daysLeft < 0) return `${-daysLeft}d ago`;
  if (daysLeft === 0) return 'today';
  return `${daysLeft}d`;
}

/**
 * Tab 3 — FIFO Expiry Radar (M3, FR-307, prototype §5): batches ranked
 * earliest-expiry-first (FEFO) with rose urgency for near/expired lots, and the
 * Expiring / Expired / Other breakdown + expired-waste figure. Tapping a batch
 * opens the product detail.
 */
export default function ExpiryTab() {
  const router = useRouter();
  const [entries, setEntries] = useState<ExpiryRadarEntry[]>([]);
  const [summary, setSummary] = useState<ExpiryRadarSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await expiryRadar();
    setEntries(r.entries);
    setSummary(r.summary);
    setLoaded(true);
  }, []);

  // Refresh on every focus (tab stays mounted) so FEFO quantities track
  // sales and PO receives without a manual pull-to-refresh (M3 — on-device).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = ({ item }: { item: ExpiryRadarEntry }) => {
    const meta = URGENCY_META[item.urgency];
    return (
      <Pressable
        style={styles.row}
        onPress={() => router.push({ pathname: '/inventory/[id]', params: { id: item.productId } })}
      >
        <View style={[styles.dot, { backgroundColor: meta.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.productName}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.lotCode ? `lot ${item.lotCode}` : item.sku}
            {item.expiryDate ? ` · exp ${item.expiryDate}` : ' · no expiry'}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <View style={[styles.urgencyChip, { backgroundColor: meta.bg }]}>
            <Text style={[styles.urgencyText, { color: meta.color }]}>{fmtDays(item.daysLeft)}</Text>
          </View>
          <NumberText style={styles.qty}>{item.qtyRemaining}</NumberText>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <FlatList
        data={entries}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={entries.length === 0 ? { flexGrow: 1 } : { padding: spacing.lg, paddingBottom: 24 }}
        ListHeaderComponent={
          loaded && summary ? (
            <View style={styles.cards}>
              <SummaryCard
                label="Expired waste"
                value={String(summary.expiredWasteQty)}
                color={colors.danger}
                icon="warning-outline"
              />
              <SummaryCard label="Expiring" value={String(summary.expiringQty)} color="#B45309" icon="hourglass-outline" />
              <SummaryCard label="Other" value={String(summary.otherQty)} color={colors.slate500} icon="albums-outline" />
              <SummaryCard label="Batches" value={String(summary.batchCount)} color={colors.primary} icon="pricetags-outline" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={40} color={colors.positive} />
              <Text style={styles.emptyTitle}>No expiry risk</Text>
              <Text style={styles.emptySub}>No batches with remaining stock to track.</Text>
            </View>
          ) : null
        }
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.slate300} onRefresh={() => void onRefresh()} />}
      />
    </View>
  );
}

function SummaryCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Ionicons name={icon} size={16} color={color} />
        <Text style={styles.cardLabel}>{label}</Text>
      </View>
      <NumberText style={[styles.cardVal, { color }]}>{value}</NumberText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  cards: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
  },
  card: {
    flexBasis: '46%', flexGrow: 1, backgroundColor: colors.white, borderRadius: radius.card,
    borderWidth: 1, borderColor: colors.slate200, padding: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  cardLabel: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: colors.slate500 },
  cardVal: { fontFamily: fonts.mono, fontSize: 22 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.slate200,
    padding: spacing.md, marginBottom: spacing.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.slate900 },
  meta: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  urgencyChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  urgencyText: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '600' },
  qty: { fontFamily: fonts.mono, fontSize: 15, color: colors.slate900 },
  empty: { alignItems: 'center', paddingTop: 120 },
  emptyTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.slate700, marginTop: spacing.md },
  emptySub: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500, marginTop: 4 },
});
