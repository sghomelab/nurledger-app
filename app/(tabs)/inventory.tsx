import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { FlatList, Pressable, Switch, TextInput, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProducts, useOutlet } from '../../src/hooks/useAppData';
import { useT } from '../../src/hooks/useT';
import { StatusChip } from '../../src/components/Chip';
import { NumberText } from '../../src/components/NumberText';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';
import { formatMoney } from '../../src/lib/money';
import type { ProductWithStock } from '../../src/types';

/**
 * Tab 2 — Inventory & Pricing (prototype §4).
 * M1: product master + local CRUD. M3 (this milestone): product detail with
 * full columns + status + quick actions (Adjust w/ reason, Restock→PO, Edit,
 * Deactivate), reorder suggestions, PO create/receive in batches, carton
 * break (FR-318/FR-322). M6: stocktake (FR-304) + label printing (FR-317)
 * entry points.
 */
export default function InventoryTab() {
  const router = useRouter();
  const { products, lowStock, search, setSearch, reload } = useProducts();
  const { outlet } = useOutlet();
  const { t } = useT();
  const [lowOnly, setLowOnly] = useState(false);

  // Refresh stock + the low-stock badge on every tab focus: the tab stays
  // mounted while Sell/Expiry/PO screens sit on top, so the badge must track
  // sales, PO receives and adjustments (FR-305 — found on-device).
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const list = products?.filter((p) => (lowOnly ? p.status === 'low_stock' || p.status === 'depleted' || p.status === 'sold_out' : true)) ?? [];

  return (
    <View style={styles.wrap}>
      {/* PO entry point (M3, FR-306) */}
      <Pressable style={styles.poRow} onPress={() => router.push('/po')}>
        <Ionicons name="business-outline" size={18} color={colors.primary} />
        <Text style={styles.poText}>{t('inv.purchaseOrders')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.slate400} />
      </Pressable>

      {/* Stocktake entry point (M6, FR-304) */}
      <Pressable style={[styles.poRow, { marginTop: spacing.sm }]} onPress={() => router.push('/stocktake')}>
        <Ionicons name="clipboard-outline" size={18} color={colors.primary} />
        <Text style={styles.poText}>{t('inv.stocktake')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.slate400} />
      </Pressable>

      {/* Label printing entry point (M6, FR-317) */}
      <Pressable style={[styles.poRow, { marginTop: spacing.sm }]} onPress={() => router.push('/labels')}>
        <Ionicons name="print-outline" size={18} color={colors.primary} />
        <Text style={styles.poText}>{t('inv.labels')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.slate400} />
      </Pressable>

      {/* Suppliers entry point (M6, FR-313) */}
      <Pressable style={[styles.poRow, { marginTop: spacing.sm }]} onPress={() => router.push('/suppliers')}>
        <Ionicons name="business-outline" size={18} color={colors.primary} />
        <Text style={styles.poText}>{t('inv.suppliers')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.slate400} />
      </Pressable>

      {/* Product data (CSV) entry point (M6, FR-314) */}
      <Pressable style={[styles.poRow, { marginTop: spacing.sm }]} onPress={() => router.push('/csv')}>
        <Ionicons name="swap-vertical-outline" size={18} color={colors.primary} />
        <Text style={styles.poText}>{t('inv.csv')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.slate400} />
      </Pressable>

      {/* Search (prototype: header search) */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.slate400} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('sell.searchPlaceholder')}
            placeholderTextColor={colors.slate400}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={colors.slate400} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Low Stock Only toggle (prototype: "Toggle between showing only low stock items or entire catalog") */}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>
          {t('inv.lowStockOnly')} {lowStock > 0 ? <NumberText style={styles.toggleCount}>{lowStock}</NumberText> : null}
        </Text>
        <Switch
          value={lowOnly}
          onValueChange={setLowOnly}
          trackColor={{ true: colors.primary, false: colors.slate300 }}
          thumbColor={colors.white}
        />
      </View>

      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={false} tintColor={colors.slate300} onRefresh={() => void reload()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={40} color={colors.slate300} />
            <Text style={styles.emptyText}>{search ? t('inv.noMatch') : t('inv.noneYet')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            currency={outlet?.currency ?? 'SGD'}
            onPress={() => router.push({ pathname: '/inventory/[id]', params: { id: item.id } })}
          />
        )}
      />

      {/* Add product (prototype: [ + ADD ] header action) */}
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.9 }]}
        onPress={() => router.push('/inventory/new')}
      >
        <Ionicons name="add" size={26} color={colors.white} />
      </Pressable>
    </View>
  );
}

function ProductRow({ product, currency, onPress }: { product: ProductWithStock; currency: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.slate100 }]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>{product.name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {product.sku}{product.barcode ? ` · ${product.barcode}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <NumberText style={styles.rowPrice}>{formatMoney(product.priceMinor, currency)}</NumberText>
        <View style={styles.rowStockRow}>
          <NumberText style={styles.rowStock}>{product.stockQty}</NumberText>
          <StatusChip status={product.status} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  poRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.sm,
    backgroundColor: colors.primarySoft, borderRadius: radius.control,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  poText: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.primary },
  searchRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.slate900, padding: 0 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg + 2,
    paddingVertical: spacing.md,
  },
  toggleLabel: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.slate700 },
  toggleCount: { color: colors.warning, fontWeight: '600', marginLeft: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  rowMain: { flex: 1 },
  rowName: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
  rowMeta: { fontFamily: fonts.mono, fontSize: 11.5, color: colors.slate500, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowPrice: { fontSize: 14.5, fontWeight: '500' },
  rowStockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 },
  rowStock: { fontSize: 13, color: colors.slate700 },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate500 },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: colors.slate900,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
