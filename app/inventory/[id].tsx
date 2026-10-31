import { useCallback, useState } from 'react';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCategories, useOutlet, useProducts } from '../../src/hooks/useAppData';
import { useUsers } from '../../src/hooks/useShift';
import { getProduct, deactivateProduct, updateProduct } from '../../src/repositories/productRepository';
import { getSupplier } from '../../src/repositories/supplierRepository';
import { batchesWithQty, costLayersOf, ledgerHistory } from '../../src/repositories/stockRepository';
import { analyzeMargin, reorderSuggestion, daysUntil, expiryUrgency, type MarginAnalysis } from '../../src/lib/stock';
import { roleCanAct } from '../../src/lib/roles';
import { marginPct, formatMoney } from '../../src/lib/money';
import { StatusChip } from '../../src/components/Chip';
import { NumberText } from '../../src/components/NumberText';
import { AdjustStockDialog } from '../../src/components/AdjustStockDialog';
import { PinPrompt } from '../../src/components/PinPrompt';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';
import type { BatchWithQty, ExpiryUrgency, ProductWithStock, StockLedgerRow, Supplier } from '../../src/types';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const URGENCY_COLOR: Record<ExpiryUrgency, string> = {
  expired: colors.danger,
  critical: colors.danger,
  soon: colors.warning,
  ok: colors.positive,
};

/**
 * Product detail (M3, prototype §4): the full column set — name, SKU, barcode,
 * carton barcode, category, unit type, cost, price, stock, reorder min/max,
 * velocity, margin, last updated — plus FEFO batches, ledger history, and the
 * quick actions Adjust / Restock→PO / Edit. (Mobile idiom for the prototype's
 * desktop 17-column table; no new top-level nav is invented.)
 */
export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { outlet } = useOutlet();
  const { categories } = useCategories();
  const { reload } = useProducts();

  const [product, setProduct] = useState<ProductWithStock | null>(null);
  const [batches, setBatches] = useState<BatchWithQty[]>([]);
  const [ledger, setLedger] = useState<StockLedgerRow[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [margin, setMargin] = useState<MarginAnalysis | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const { active, users } = useUsers();

  const load = useCallback(async () => {
    if (!id) return;
    const [p, allBatches, hist, layers] = await Promise.all([
      getProduct(id),
      batchesWithQty(),
      ledgerHistory(id, 6),
      costLayersOf(id),
    ]);
    setProduct(p);
    setBatches(allBatches.filter((b) => b.productId === id));
    setLedger(hist);
    // FR-313: resolve the linked supplier (null when unlinked).
    setSupplier(p?.supplierId ? await getSupplier(p.supplierId) : null);
    // FR-320: margin compression — oldest layer (baseline) vs newest layer.
    setMargin(analyzeMargin(p?.priceMinor ?? 0, layers));
    setLoaded(true);
  }, [id]);

  // Reload on every focus, not just mount: the screen stays mounted while
  // pushed sub-screens (Edit, Restock→PO) sit on top, so without this an edit
  // saves to the DB but the detail card shows stale values (M3 — found on-device).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const deactivate = async () => {
    if (!product) return;
    Alert.alert('Deactivate product', `Hide "${product.name}" from the register? Stock & ledger history are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          await deactivateProduct(product.id);
          await reload();
          router.back();
        },
      },
    ]);
  };

  // FR-320: apply the suggested reprice (only on explicit owner confirmation;
  // the price is NEVER auto-derived from cost — ADR-003).
  const applySuggestedPrice = async () => {
    if (!product || !margin || margin.suggestedPriceMinor == null) return;
    try {
      await updateProduct(product.id, { ...product, priceMinor: margin.suggestedPriceMinor });
      await reload();
      await load();
    } catch (e) {
      Alert.alert('Price update failed', e instanceof Error ? e.message : String(e));
    }
  };

  const requestSuggestedPrice = () => {
    // Gated for cashiers (owner/manager apply directly) — same pattern as
    // stock_adjust / refund gates.
    if (active && roleCanAct(active.role, 'price_override')) {
      void applySuggestedPrice();
      return;
    }
    setGateVisible(true);
  };

  if (loaded && !product) {
    return (
      <View style={styles.center}>
        <Text style={styles.missing}>This product no longer exists.</Text>
      </View>
    );
  }
  if (!product) {
    return <View style={styles.center}><Text style={styles.missing}>Loading…</Text></View>;
  }

  const currency = outlet?.currency ?? 'SGD';
  const marginChip = marginPct(product.priceMinor, product.costMinor);
  const suggested = reorderSuggestion(product.stockQty, product.minQty, product.maxQty);
  const belowMin = product.stockQty < product.minQty;
  const categoryName = categories?.find((c) => c.id === product.categoryId)?.name ?? '—';

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={false} tintColor={colors.slate300} onRefresh={() => void load()} />}
    >
      {/* Header: name + status */}
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
        <StatusChip status={product.status} />
      </View>

      {/* Key metrics */}
      <View style={styles.metrics}>
        <Metric label="On hand" value={String(product.stockQty)} />
        <Metric label="Price" value={formatMoney(product.priceMinor, currency)} />
        <Metric label="Cost" value={formatMoney(product.costMinor, currency)} />
        <Metric label="Margin" value={`${marginChip}%`} accent={colors.positive} />
      </View>

      {/* Reorder suggestion (FR-308) */}
      {belowMin && (
        <Pressable style={styles.reorderCard} onPress={() =>
          router.push({ pathname: '/po/new', params: { product: product.id, qty: String(Math.max(suggested, product.maxQty || 1)) } })
        }>
          <Ionicons name="refresh-circle" size={20} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={styles.reorderTitle}>Reorder suggested</Text>
            <Text style={styles.reorderSub}>
              Stock {product.stockQty} below min {product.minQty} — order {Math.max(suggested, 1)} (max {product.maxQty})
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.slate400} />
        </Pressable>
      )}

      {/* Margin compression (FR-320): newest cost rose above the baseline */}
      {margin?.compressed && (
        <View style={styles.marginCard}>
          <Ionicons name="trending-down-outline" size={22} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={styles.marginTitle}>
              Margin compressed {margin.baselineMarginPct}% → {margin.currentMarginPct}%
            </Text>
            <Text style={styles.marginSub}>
              Latest cost {formatMoney(margin.currentCostMinor, currency)} vs {formatMoney(margin.baselineCostMinor, currency)} when the price was set
            </Text>
            {margin.suggestedPriceMinor != null && (
              <Text style={styles.marginSuggest}>
                {formatMoney(margin.suggestedPriceMinor, currency)} holds {margin.baselineMarginPct}% margin
              </Text>
            )}
          </View>
          {margin.suggestedPriceMinor != null && (
            <Pressable style={styles.marginBtn} onPress={requestSuggestedPrice}>
              <Text style={styles.marginBtnText}>Use</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Details (the prototype columns) */}
      <SectionTitle>Details</SectionTitle>
      <View style={styles.card}>
        <Row label="SKU" value={product.sku} mono />
        <Row label="Barcode" value={product.barcode ?? '—'} mono />
        <Row label="Carton barcode" value={product.cartonBarcode ?? '—'} mono sub={`1 carton = ${product.cartonSize} units`} />
        <Row label="Category" value={categoryName} />
        <Row label="Supplier" value={supplier?.name ?? '—'} sub={supplier ? `${supplier.leadTimeDays}d lead` : undefined} />
        <Row label="Unit type" value={product.unitType} />
        <Row label="Velocity tier" value={product.velocityClass ?? '—'} />
        <Row label="Min (reorder)" value={String(product.minQty)} mono />
        <Row label="Max" value={String(product.maxQty)} mono />
        <Row label="Last updated" value={fmtDate(product.updatedAt)} />
      </View>

      {/* FEFO batches (FR-307) */}
      <SectionTitle>Batches (FEFO)</SectionTitle>
      <View style={styles.card}>
        {batches.length === 0 ? (
          <Text style={styles.emptyText}>No batches on record.</Text>
        ) : (
          batches.map((b, i) => {
            const daysLeft = b.expiryDate ? daysUntil(b.expiryDate) : Number.POSITIVE_INFINITY;
            const urgency = expiryUrgency(daysLeft);
            return (
              <View key={b.id} style={[styles.batchRow, i > 0 && styles.batchDivider]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.batchCode} numberOfLines={1}>{b.lotCode || '—'}</Text>
                  <Text style={styles.batchMeta}>
                    {b.expiryDate ? `Exp ${b.expiryDate}` : 'No expiry'}
                  </Text>
                </View>
                <Text style={[styles.batchDays, { color: URGENCY_COLOR[urgency] }]}>
                  {Number.isFinite(daysLeft) ? `${daysLeft}d` : '—'}
                </Text>
                <NumberText style={styles.batchQty}>{b.qtyRemaining}</NumberText>
              </View>
            );
          })
        )}
      </View>

      {/* Ledger (last movements, FR-316) */}
      <SectionTitle>Recent movements</SectionTitle>
      <View style={styles.card}>
        {ledger.length === 0 ? (
          <Text style={styles.emptyText}>No stock movements yet.</Text>
        ) : (
          ledger.map((l, i) => (
            <View key={l.id} style={[styles.ledgerRow, i > 0 && styles.batchDivider]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ledgerType}>{l.type.replace('_', ' ')}</Text>
                <Text style={styles.ledgerMeta}>{fmtDate(l.createdAt)}{l.reason ? ` · ${l.reason}` : ''}</Text>
              </View>
              <NumberText style={[styles.ledgerQty, (l.qtyDelta ?? 0) < 0 ? { color: colors.danger } : { color: colors.positive }]}>
                {(l.qtyDelta ?? 0) > 0 ? `+${l.qtyDelta}` : l.qtyDelta}
              </NumberText>
            </View>
          ))
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <ActionButton icon="scale-outline" label="Adjust" tone="warning" onPress={() => setAdjusting(true)} />
        <ActionButton icon="add-circle-outline" label="Restock" tone="primary" onPress={() =>
          router.push({ pathname: '/po/new', params: { product: product.id, qty: String(Math.max(suggested, product.maxQty || 1)) } })
        } />
      </View>
      <View style={styles.actions}>
        <ActionButton icon="create-outline" label="Edit" tone="neutral" onPress={() =>
          router.push({ pathname: '/inventory/edit', params: { id: product.id } })
        } />
        <ActionButton icon="print-outline" label="Label" tone="neutral" onPress={() =>
          router.push({ pathname: '/labels', params: { product: product.id } })
        } />
        <ActionButton icon="eye-off-outline" label="Deactivate" tone="danger" onPress={() => void deactivate()} />
      </View>

      {adjusting && (
        <AdjustStockDialog
          product={product}
          currency={currency}
          onApplied={() => { void load(); void reload(); }}
          onClose={() => setAdjusting(false)}
        />
      )}

      {gateVisible && (
        <PinPrompt
          visible
          action="price_override"
          users={users ?? []}
          onSuccess={() => {
            setGateVisible(false);
            void applySuggestedPrice();
          }}
          onCancel={() => setGateVisible(false)}
        />
      )}
    </ScrollView>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <NumberText style={[styles.metricValue, accent ? { color: accent } : null]}>{value}</NumberText>
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Row({ label, value, mono, sub }: { label: string; value: string; mono?: boolean; sub?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValWrap}>
        {mono ? <NumberText style={styles.rowVal}>{value}</NumberText> : <Text style={styles.rowVal}>{value}</Text>}
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

type ActionTone = 'primary' | 'warning' | 'neutral' | 'danger';
const ACTION_TONE: Record<ActionTone, { bg: string; fg: string }> = {
  primary: { bg: colors.primarySoft, fg: colors.primary },
  warning: { bg: colors.warningSoft, fg: '#B45309' },
  neutral: { bg: colors.slate100, fg: colors.slate700 },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

function ActionButton({ icon, label, tone, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; tone: ActionTone; onPress: () => void }) {
  const t = ACTION_TONE[tone];
  return (
    <Pressable style={[styles.actionBtn, { backgroundColor: t.bg }]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={t.fg} />
      <Text style={[styles.actionText, { color: t.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slate50 },
  missing: { fontFamily: fonts.sans, fontSize: 15, color: colors.slate500 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  name: { fontFamily: fonts.sansBold, fontSize: 22, color: colors.slate900, marginBottom: spacing.sm },
  metrics: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  metric: {
    flex: 1, backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.md, alignItems: 'center',
  },
  metricLabel: { fontFamily: fonts.sans, fontSize: 11, color: colors.slate500, marginBottom: 4 },
  metricValue: { fontFamily: fonts.mono, fontSize: 15, color: colors.slate900 },
  reorderCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md,
    backgroundColor: colors.warningSoft, borderRadius: radius.card, borderWidth: 1, borderColor: colors.warning, padding: spacing.md,
  },
  reorderTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: '#92400E' },
  reorderSub: { fontFamily: fonts.sans, fontSize: 12, color: '#B45309', marginTop: 2 },
  marginCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md,
    backgroundColor: colors.warningSoft, borderRadius: radius.card, borderWidth: 1, borderColor: colors.warning, padding: spacing.md,
  },
  marginTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: '#92400E' },
  marginSub: { fontFamily: fonts.sans, fontSize: 12, color: '#B45309', marginTop: 2 },
  marginSuggest: { fontFamily: fonts.sans, fontSize: 12, color: '#92400E', marginTop: 4 },
  marginBtn: {
    backgroundColor: colors.warning, borderRadius: radius.control, paddingVertical: 8, paddingHorizontal: spacing.lg,
  },
  marginBtnText: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.white },
  sectionTitle: {
    fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate500, textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.lg + 2,
  },
  card: {
    marginHorizontal: spacing.lg, backgroundColor: colors.white, borderRadius: radius.card,
    borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: spacing.lg,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.md },
  rowLabel: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate500 },
  rowValWrap: { alignItems: 'flex-end', flexShrink: 1 },
  rowVal: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.slate900, textAlign: 'right' },
  rowSub: { fontFamily: fonts.sans, fontSize: 11, color: colors.slate400, marginTop: 2 },
  batchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  batchDivider: { borderTopWidth: 1, borderTopColor: colors.slate100 },
  batchCode: { fontFamily: fonts.mono, fontSize: 13, color: colors.slate900 },
  batchMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, marginTop: 2 },
  batchDays: { fontFamily: fonts.monoSemiBold, fontSize: 13 },
  batchQty: { fontFamily: fonts.mono, fontSize: 15, color: colors.slate900, minWidth: 36, textAlign: 'right' },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  ledgerType: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate900, textTransform: 'capitalize' },
  ledgerMeta: { fontFamily: fonts.sans, fontSize: 11, color: colors.slate500, marginTop: 2 },
  ledgerQty: { fontFamily: fonts.mono, fontSize: 15 },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate400, paddingVertical: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.lg },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: 13, borderRadius: radius.control,
  },
  actionText: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
});
