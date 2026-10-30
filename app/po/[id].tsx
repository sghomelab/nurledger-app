import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOutlet, useProducts } from '../../src/hooks/useAppData';
import { getPO, receivePO } from '../../src/repositories/poRepository';
import { isFullyReceived, remainingToReceive } from '../../src/lib/po';
import { formatMoney } from '../../src/lib/money';
import { NumberText } from '../../src/components/NumberText';
import { Chip } from '../../src/components/Chip';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { PurchaseOrder } from '../../src/types';

function fmtDate(ts: number | null): string {
  return ts
    ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
}

const PO_STATUS_TONE: Record<string, 'neutral' | 'primary' | 'positive' | 'warning' | 'danger'> = {
  draft: 'neutral',
  pending: 'warning',
  received: 'positive',
  cancelled: 'danger',
};

/**
 * PO detail (M3, FR-306): vendor, terms, total, line-level ordered/received,
 * and the **Receive** action — the only path a PO becomes stock (one lot + FIFO
 * cost layer per line, cost layer linked to the lot for the FEFO radar).
 */
export default function PODetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { outlet } = useOutlet();
  const { products } = useProducts();

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setPo(await getPO(id));
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const receive = () => {
    if (!po) return;
    Alert.alert(
      'Receive this PO?',
      'Adds stock for every not-fully-received line (one lot per line, at the line cost). Stock-in is recorded on the immutable ledger.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Receive',
          onPress: async () => {
            setBusy(true);
            try {
              await receivePO(po.id);
              await load();
            } catch (e) {
              Alert.alert('Receive failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (loaded && !po) {
    return (
      <View style={styles.center}>
        <Text style={styles.missing}>This purchase order no longer exists.</Text>
      </View>
    );
  }
  if (!po) return <View style={styles.center}><Text style={styles.missing}>Loading…</Text></View>;

  const currency = outlet?.currency ?? 'SGD';
  const fullyReceived = isFullyReceived(po.lines);
  const receivable = po.status !== 'received' && po.status !== 'cancelled';

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={false} tintColor={colors.slate300} onRefresh={() => void load()} />}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.vendor} numberOfLines={1}>{po.supplierName}</Text>
          <Text style={styles.meta}>{po.terms.toUpperCase()} · created {fmtDate(po.createdAt)}</Text>
          {po.receivedAt ? <Text style={styles.meta}>received {fmtDate(po.receivedAt)}</Text> : null}
        </View>
        <Chip label={po.status.toUpperCase()} tone={PO_STATUS_TONE[po.status] ?? 'neutral'} />
      </View>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>PO total</Text>
        <NumberText style={styles.totalVal}>{formatMoney(po.totalCostMinor, currency)}</NumberText>
        <Text style={styles.linesCount}>{po.lines.length} line{po.lines.length === 1 ? '' : 's'}</Text>
      </View>

      <Text style={styles.sectionTitle}>Lines</Text>
      <View style={styles.card}>
        {po.lines.map((l, i) => (
          <View key={l.id} style={[styles.lineRow, i > 0 && styles.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName} numberOfLines={1}>
                {products?.find((p) => p.id === l.productId)?.name ?? l.productId}
              </Text>
              <Text style={styles.lineMeta}>
                {products?.find((p) => p.id === l.productId)?.sku ?? ''}
                {l.lotCode ? ` · lot ${l.lotCode}` : ''}{l.expiryDate ? ` · exp ${l.expiryDate}` : ' · no expiry'}
              </Text>
            </View>
            <View style={styles.qtyCol}>
              <Text style={styles.qtyLabel}>ord</Text>
              <NumberText style={styles.qtyVal}>{l.qtyOrdered}</NumberText>
            </View>
            <View style={styles.qtyCol}>
              <Text style={styles.qtyLabel}>rcvd</Text>
              <NumberText style={styles.qtyVal}>{l.qtyReceived}</NumberText>
            </View>
            <View style={styles.qtyCol}>
              <Text style={styles.qtyLabel}>cost</Text>
              <NumberText style={styles.qtyVal}>{formatMoney(l.unitCostMinor, currency)}</NumberText>
            </View>
          </View>
        ))}
      </View>

      {!fullyReceived && (
        <View style={styles.remainNote}>
          <Ionicons name="information-circle-outline" size={16} color={colors.slate500} />
          <Text style={styles.remainText}>
            {po.lines.reduce((s, l) => s + remainingToReceive(l), 0)} base units still to receive.
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        {receivable ? (
          <Pressable style={[styles.receiveBtn, busy && { opacity: 0.7 }]} onPress={receive} disabled={busy}>
            <Ionicons name="checkbox-outline" size={20} color={colors.white} />
            <Text style={styles.receiveText}>{busy ? 'Receiving…' : 'Receive PO'}</Text>
          </Pressable>
        ) : (
          <View style={[styles.receiveBtn, { backgroundColor: colors.slate100, opacity: 1 }]}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.positive} />
            <Text style={[styles.receiveText, { color: colors.positive }]}>
              {po.status === 'received' ? 'Fully received' : 'Closed'}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slate50 },
  missing: { fontFamily: fonts.sans, fontSize: 15, color: colors.slate500 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  vendor: { fontFamily: fonts.sansBold, fontSize: 20, color: colors.slate900 },
  meta: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, marginTop: 2 },
  totalCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.slate900,
    borderRadius: radius.card, padding: spacing.lg,
  },
  totalLabel: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate400 },
  totalVal: { fontFamily: fonts.mono, fontSize: 26, color: colors.white, marginTop: 4 },
  linesCount: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate400, marginTop: 4 },
  sectionTitle: {
    fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate500, textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.lg + 2,
  },
  card: {
    marginHorizontal: spacing.lg, backgroundColor: colors.white, borderRadius: radius.card,
    borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: spacing.lg,
  },
  lineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.slate100 },
  lineName: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.slate900 },
  lineMeta: { fontFamily: fonts.sans, fontSize: 11, color: colors.slate500, marginTop: 2 },
  qtyCol: { alignItems: 'center', minWidth: 44 },
  qtyLabel: { fontFamily: fonts.sans, fontSize: 10, color: colors.slate400, textTransform: 'uppercase' },
  qtyVal: { fontFamily: fonts.mono, fontSize: 13, color: colors.slate900, marginTop: 2 },
  remainNote: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
  },
  remainText: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500 },
  footer: {
    padding: spacing.lg, borderTopWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white,
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  receiveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.control, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  receiveText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.white },
});
