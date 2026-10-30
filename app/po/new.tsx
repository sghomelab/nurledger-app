import { useCallback, useEffect, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOutlet, useProducts } from '../../src/hooks/useAppData';
import { createPO } from '../../src/repositories/poRepository';
import { cartonsToBase } from '../../src/lib/po';
import { formatMoney } from '../../src/lib/money';
import { NumberText } from '../../src/components/NumberText';
import { PickerOverlay } from '../../src/components/PickerOverlay';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { POLineInput, ProductWithStock } from '../../src/types';

/**
 * New purchase order (M3, FR-306/FR-318): vendor + lines in BASE units.
 * Reachable plain (blank PO) or prefilled from a product's Restock action
 * (`?product=<id>&qty=<n>` — the Min/Max suggestion). Lines may be entered in
 * cartons for carton products and are stored as base units (FR-318).
 */
export default function NewPOScreen() {
  const router = useRouter();
  const { product: prefilledId, qty: prefilledQty } = useLocalSearchParams<{
    product?: string;
    qty?: string;
  }>();
  const { outlet } = useOutlet();
  const { products } = useProducts();

  const [supplier, setSupplier] = useState('');
  const [lines, setLines] = useState<POLineInput[]>([]);
  const [loadedPrefill, setLoadedPrefill] = useState(!prefilledId);
  const [saving, setSaving] = useState(false);
  /**
   * Raw text buffers for the line inputs that would otherwise snap-format on
   * every keystroke: unit cost re-formats to 2 decimals ("2.1" snaps back to
   * "2.10", so backspace can't clear the field) and expiry is all-or-nothing
   * (partial dates snap to empty). While editing, hold the raw text and parse
   * it live; normalize on blur. (M3 — found during device testing.)
   */
  const [drafts, setDrafts] = useState<Record<string, { cost?: string; expiry?: string }>>({});
  const draftFor = (id: string) => drafts[id] ?? {};
  const setDraft = (id: string, key: 'cost' | 'expiry', v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: v } }));

  // Prefill one line from the Restock deep-link (product id + suggested qty).
  useEffect(() => {
    if (!prefilledId || loadedPrefill) return;
    const p = products?.find((x) => x.id === prefilledId);
    const n = Math.max(1, Number.parseInt(prefilledQty ?? '1', 10) || 1);
    if (p) {
      setLines([
        {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          qtyOrdered: n,
          unitCostMinor: p.costMinor,
          lotCode: null,
          expiryDate: null,
        },
      ]);
    }
    setLoadedPrefill(true);
  }, [prefilledId, prefilledQty, loadedPrefill, products]);

  const toMinor = (s: string): number => {
    const n = Number.parseFloat(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };

  const patchLine = useCallback((i: number, patch: Partial<POLineInput>) => {
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }, []);

  const removeLine = useCallback((i: number) => {
    const removed = lines[i];
    setLines((cur) => cur.filter((_, j) => j !== i));
    if (removed) {
      setDrafts((d) => {
        if (!d[removed.productId]) return d;
        const c = { ...d };
        delete c[removed.productId];
        return c;
      });
    }
  }, [lines]);

  // Product picker for adding lines (inline — Alert.alert only supports 3 buttons).
  const [pickOpen, setPickOpen] = useState(false);

  /** Open the product picker (default cost = product's cost, qty 1). */
  const addLine = () => {
    if ((products ?? []).filter((p) => p.active).length === 0) {
      Alert.alert('No products', 'Add products to the catalog first.');
      return;
    }
    setPickOpen(true);
  };

  const addToPO = (p: ProductWithStock) => {
    if (lines.some((l) => l.productId === p.id)) {
      Alert.alert('Already on this PO', `"${p.name}" is already a line.`);
      return;
    }
    setLines((cur) => [
      ...cur,
      {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        qtyOrdered: 1,
        unitCostMinor: p.costMinor,
        lotCode: null,
        expiryDate: null,
      },
    ]);
    setPickOpen(false);
  };

  /** Carton product helpers (FR-318): cartons input × cartonSize = base units. */
  const cartonSizeOf = (l: POLineInput): number =>
    products?.find((x) => x.id === l.productId)?.cartonSize ?? 1;
  const isCartonProduct = (l: POLineInput): boolean => cartonSizeOf(l) > 1;

  const totalMinor = lines.reduce((s, l) => s + l.qtyOrdered * l.unitCostMinor, 0);
  const canSave = supplier.trim().length > 0 && lines.length > 0 &&
    lines.every((l) => l.qtyOrdered > 0);

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const po = await createPO(supplier.trim(), lines, 'net30');
      router.replace({ pathname: '/po/[id]', params: { id: po.id } });
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Vendor *">
          <TextInput
            style={styles.input}
            value={supplier}
            onChangeText={setSupplier}
            placeholder="e.g. Sheng Siong Wholesale"
            placeholderTextColor={colors.slate400}
          />
        </Field>
        <Text style={styles.termsNote}>Terms: Net 30 (default) · one lot per received line (FEFO batches)</Text>

        <Text style={styles.linesTitle}>Lines ({lines.length})</Text>

        {lines.length === 0 && (
          <Pressable style={styles.addLineBtn} onPress={addLine}>
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={styles.addLineText}>Add a product line</Text>
          </Pressable>
        )}

        {lines.map((l, i) => {
          const carton = isCartonProduct(l);
          return (
            <View key={l.productId} style={styles.lineCard}>
              <View style={styles.lineHead}>
                <Text style={styles.lineName} numberOfLines={1}>{l.name}</Text>
                <Pressable onPress={() => removeLine(i)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
              <View style={styles.lineGrid}>
                <View style={styles.lineCol}>
                  <Text style={styles.lineLabel}>
                    {carton ? `Cartons (×${cartonSizeOf(l)} = ${l.qtyOrdered} u)` : 'Quantity (base units)'}
                  </Text>
                  <TextInput
                    style={styles.inputMono}
                    value={String(carton ? Math.floor(l.qtyOrdered / Math.max(1, cartonSizeOf(l))) : l.qtyOrdered)}
                    onChangeText={(t) => {
                      const n = Math.max(0, Number.parseInt(t, 10) || 0);
                      if (carton) patchLine(i, { qtyOrdered: cartonsToBase(n, cartonSizeOf(l)) });
                      else patchLine(i, { qtyOrdered: n });
                    }}
                    placeholder="0"
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.lineCol}>
                  <Text style={styles.lineLabel}>Unit cost</Text>
                  <TextInput
                    style={styles.inputMono}
                    value={draftFor(l.productId).cost ?? (l.unitCostMinor / 100).toFixed(2)}
                    onChangeText={(t) => {
                      setDraft(l.productId, 'cost', t);
                      patchLine(i, { unitCostMinor: toMinor(t) });
                    }}
                    onEndEditing={() =>
                      setDraft(l.productId, 'cost', (toMinor(draftFor(l.productId).cost ?? '') / 100).toFixed(2))
                    }
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <View style={styles.lineGrid}>
                <View style={styles.lineCol}>
                  <Text style={styles.lineLabel}>Lot / batch code</Text>
                  <TextInput
                    style={styles.input}
                    value={l.lotCode ?? ''}
                    onChangeText={(t) => patchLine(i, { lotCode: t.trim() || null })}
                    placeholder="Optional"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.lineCol}>
                  <Text style={styles.lineLabel}>Expiry (YYYY-MM-DD)</Text>
                  <TextInput
                    style={styles.inputMono}
                    value={draftFor(l.productId).expiry ?? (l.expiryDate ?? '')}
                    onChangeText={(t) => {
                      setDraft(l.productId, 'expiry', t);
                      patchLine(i, { expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null });
                    }}
                    onEndEditing={() => setDraft(l.productId, 'expiry', l.expiryDate ?? '')}
                    placeholder="Optional"
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
              </View>
              <View style={styles.lineTotalRow}>
                <Text style={styles.lineTotalLabel}>Line total</Text>
                <NumberText style={styles.lineTotalVal}>
                  {formatMoney(l.qtyOrdered * l.unitCostMinor, outlet?.currency ?? 'SGD')}
                </NumberText>
              </View>
            </View>
          );
        })}

        {lines.length > 0 && (
          <Pressable style={styles.addLineBtn} onPress={addLine}>
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={styles.addLineText}>Add another line</Text>
          </Pressable>
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>PO total</Text>
          <NumberText style={styles.totalVal}>{formatMoney(totalMinor, outlet?.currency ?? 'SGD')}</NumberText>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.saveBtn, !canSave && { opacity: 0.5 }]} onPress={() => void save()} disabled={!canSave || saving}>
          <Text style={styles.saveText}>{saving ? 'Creating…' : 'Create PO (draft)'}</Text>
        </Pressable>
      </View>

      {pickOpen && (
        <PickerOverlay
          title="Add line — pick product"
          rows={(products ?? [])
            .filter((p) => p.active)
            .map((p) => ({
              key: p.id,
              label: p.name,
              sublabel: p.sku,
              disabled: lines.some((l) => l.productId === p.id),
              onPress: () => addToPO(p),
            }))}
          onClose={() => setPickOpen(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.slate50 },
  content: { padding: spacing.lg, paddingBottom: 24 },
  field: { marginBottom: spacing.lg },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate700, marginBottom: 6 },
  input: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.sans, fontSize: 15, color: colors.slate900,
  },
  inputMono: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.mono, fontSize: 15, color: colors.slate900,
  },
  termsNote: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate400, marginTop: -spacing.sm, marginBottom: spacing.lg },
  linesTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  addLineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.slate300, borderRadius: radius.control,
    paddingVertical: 14, marginVertical: spacing.sm,
  },
  addLineText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.primary },
  lineCard: {
    backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.slate200,
    padding: spacing.md, marginBottom: spacing.md,
  },
  lineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineName: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.slate900, flex: 1 },
  lineGrid: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  lineCol: { flex: 1 },
  lineLabel: { fontFamily: fonts.sans, fontSize: 11, color: colors.slate500, marginBottom: 4 },
  lineTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.slate100,
  },
  lineTotalLabel: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500 },
  lineTotalVal: { fontFamily: fonts.mono, fontSize: 14, color: colors.slate900 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.slate900, borderRadius: radius.card,
  },
  totalLabel: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.white },
  totalVal: { fontFamily: fonts.mono, fontSize: 18, color: colors.white },
  footer: {
    padding: spacing.lg, borderTopWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.control, paddingVertical: 14, alignItems: 'center',
  },
  saveText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.white },
});
