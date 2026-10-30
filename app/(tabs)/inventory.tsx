import { useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, Switch, TextInput, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProducts, useOutlet } from '../../src/hooks/useAppData';
import { StatusChip } from '../../src/components/Chip';
import { NumberText } from '../../src/components/NumberText';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';
import { formatMoney } from '../../src/lib/money';
import type { ProductWithStock } from '../../src/types';

/**
 * Tab 2 — Inventory & Pricing (M1: product master + local CRUD, prototype §4).
 * M3 adds: stock adjustments w/ reason, reorder suggestions, PO, stocktake,
 * pack/case-break + dual barcodes (schema already in place).
 */
export default function InventoryTab() {
  const router = useRouter();
  const { products, lowStock, search, setSearch, reload } = useProducts();
  const { outlet } = useOutlet();
  const [lowOnly, setLowOnly] = useState(false);

  const list = products?.filter((p) => (lowOnly ? p.status === 'low_stock' || p.status === 'depleted' || p.status === 'sold_out' : true)) ?? null;

  return (
    <View style={styles.wrap}>
      {/* Search (prototype: header search) */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.slate400} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, SKU or barcode"
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
          Low Stock Only {lowStock > 0 ? <NumberText style={styles.toggleCount}>{lowStock}</NumberText> : null}
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
            <Text style={styles.emptyText}>{search ? 'No products match' : 'No products yet'}</Text>
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
