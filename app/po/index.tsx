import { useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, Text, StyleSheet, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOutlet, usePurchaseOrders } from '../../src/hooks/useAppData';
import { formatMoney } from '../../src/lib/money';
import { NumberText } from '../../src/components/NumberText';
import { Chip } from '../../src/components/Chip';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { POSummary } from '../../src/repositories/poRepository';

function fmtDate(ts: number | null): string {
  return ts
    ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
}

const STATUS_TONE: Record<string, 'neutral' | 'primary' | 'positive' | 'warning' | 'danger'> = {
  draft: 'neutral',
  pending: 'warning',
  received: 'positive',
  cancelled: 'danger',
};

/**
 * Purchase Orders list (M3, FR-306): newest first, with a New PO entry point.
 * Tapping a row opens the detail + Receive screen.
 */
export default function POListScreen() {
  const router = useRouter();
  const { outlet } = useOutlet();
  const { orders, reload } = usePurchaseOrders();
  const [refreshing, setRefreshing] = useState(false);

  const currency = outlet?.currency ?? 'SGD';

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = ({ item }: { item: POSummary }) => (
    <Pressable
      style={styles.row}
      onPress={() => router.push({ pathname: '/po/[id]', params: { id: item.id } })}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.supplier} numberOfLines={1}>{item.supplierName}</Text>
          <Chip label={item.status.toUpperCase()} tone={STATUS_TONE[item.status] ?? 'neutral'} />
        </View>
        <Text style={styles.rowMeta}>
          {fmtDate(item.createdAt)} · {item.lineCount} line{item.lineCount === 1 ? '' : 's'}
          {item.receivedAt ? ` · rcvd ${fmtDate(item.receivedAt)}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <NumberText style={styles.rowTotal}>{formatMoney(item.totalCostMinor, currency)}</NumberText>
        <Text style={styles.rowQty}>{item.receivedQty}/{item.orderedQty} units</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.slate300} />
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <FlatList
        data={orders ?? []}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={
          (orders ?? []).length === 0 ? styles.empty : { padding: spacing.lg, paddingBottom: 120 }
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="business-outline" size={36} color={colors.slate300} />
            <Text style={styles.emptyTitle}>No purchase orders yet</Text>
            <Text style={styles.emptySub}>Create a PO to receive stock in batches.</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.slate300} onRefresh={() => void onRefresh()} />}
      />
      <Pressable style={styles.fab} onPress={() => router.push('/po/new')}>
        <Ionicons name="add" size={26} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.slate200,
    padding: spacing.md, marginBottom: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  supplier: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.slate900, flex: 1 },
  rowMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, marginTop: 3 },
  rowRight: { alignItems: 'flex-end' },
  rowTotal: { fontFamily: fonts.mono, fontSize: 14, color: colors.slate900 },
  rowQty: { fontFamily: fonts.mono, fontSize: 11, color: colors.slate500, marginTop: 3 },
  empty: { flexGrow: 1 },
  emptyBox: { alignItems: 'center', paddingTop: 120 },
  emptyTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.slate700, marginTop: spacing.md },
  emptySub: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500, marginTop: 4 },
  fab: {
    position: 'absolute', right: 24, bottom: 28, width: 58, height: 58, borderRadius: 29,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
});
