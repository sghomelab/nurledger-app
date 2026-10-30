import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCategories, useOutlet } from '../../../src/hooks/useAppData';
import { createProduct, getProduct, updateProduct, type ProductInput } from '../../../src/repositories/productRepository';
import { useProducts } from '../../../src/hooks/useAppData';
import { colors, fonts, radius, spacing, typography } from '../../../src/theme/tokens';
import type { UnitType, VelocityClass } from '../../../src/types';

/**
 * Product add/edit (M1 local CRUD, FR-300/FR-302).
 * Money fields are entered as decimal strings and stored as integer minor units (ADR-004).
 */
export default function ProductFormScreen({ id }: { id?: string }) {
  const router = useRouter();
  const isNew = id === undefined;
  const { categories, addCategory } = useCategories();
  const { outlet } = useOutlet();
  const { reload } = useProducts();

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [unitType, setUnitType] = useState<UnitType>('each');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [minQty, setMinQty] = useState('');
  const [maxQty, setMaxQty] = useState('');
  const [cartonSize, setCartonSize] = useState('1');
  const [cartonBarcode, setCartonBarcode] = useState('');
  const [velocityClass, setVelocityClass] = useState<VelocityClass | null>(null);
  const [description, setDescription] = useState('');
  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);

  // Load existing product once (M1 edit flow)
  useEffect(() => {
    if (isNew || loaded) return;
    void (async () => {
      const p = await getProduct(id!);
      if (!p) {
        Alert.alert('Not found', 'This product no longer exists.');
        router.back();
        return;
      }
      setName(p.name);
      setSku(p.sku);
      setCategoryId(p.categoryId);
      setBarcode(p.barcode ?? '');
      setUnitType(p.unitType);
      setCost((p.costMinor / 100).toFixed(2));
      setPrice((p.priceMinor / 100).toFixed(2));
      setMinQty(String(p.minQty));
      setMaxQty(String(p.maxQty));
      setCartonSize(String(p.cartonSize));
      setCartonBarcode(p.cartonBarcode ?? '');
      setVelocityClass(p.velocityClass);
      setDescription(p.description ?? '');
      setLoaded(true);
    })();
  }, [isNew, loaded, id, router]);

  const toMinor = (s: string): number => {
    const n = Number.parseFloat(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const toInt = (s: string): number => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const save = async () => {
    if (!name.trim() || !sku.trim()) {
      Alert.alert('Missing fields', 'Name and SKU are required.');
      return;
    }
    if (toMinor(price) <= 0) {
      Alert.alert('Missing fields', 'Retail price must be greater than zero.');
      return;
    }
    setSaving(true);
    try {
      const input: ProductInput = {
        name: name.trim(),
        sku: sku.trim().toUpperCase(),
        categoryId,
        unitType,
        isWeighed: unitType === 'kg',
        barcode: barcode.trim() || null,
        cartonBarcode: cartonBarcode.trim() || null,
        cartonSize: Math.max(1, toInt(cartonSize)),
        costMinor: toMinor(cost),
        priceMinor: toMinor(price),
        taxCategory: 'standard',
        minQty: toInt(minQty),
        maxQty: toInt(maxQty),
        velocityClass,
        description: description.trim() || null,
        active: true,
      };
      if (isNew) {
        await createProduct(input);
      } else {
        await updateProduct(id!, input);
      }
      await reload();
      router.back();
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const addCat = async () => {
    const res = await new Promise<string | null>((resolve) => {
      Alert.prompt('New category name', '', (t) => resolve(t && t.trim() ? t.trim() : null), 'plain-text');
    });
    if (res) {
      const c = await addCategory(res);
      setCategoryId(c.id);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name *"><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Rice 5kg" /></Field>
        <View style={styles.row}>
          <View style={styles.colHalf}><Field label="SKU *"><TextInput style={styles.input} value={sku} onChangeText={setSku} placeholder="RICE-5KG" autoCapitalize="characters" autoCorrect={false} /></Field></View>
          <View style={styles.colHalf}><Field label="Barcode"><TextInput style={styles.input} value={barcode} onChangeText={setBarcode} placeholder="Scan or type" keyboardType="number-pad" autoCapitalize="characters" autoCorrect={false} /></Field></View>
        </View>

        <Field label="Category">
          <Pressable style={styles.selectBox} onPress={() => {
            const cats = categories ?? [];
            Alert.alert('Category', '', [
              ...cats.map((c) => ({ text: c.name, onPress: () => setCategoryId(c.id) })),
              { text: 'New category…', onPress: () => void addCat() },
              { text: 'None', style: 'cancel', onPress: () => setCategoryId(null) },
            ]);
          }}>
            <Text style={styles.selectText}>{categories?.find((c) => c.id === categoryId)?.name ?? 'None'}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.slate400} />
          </Pressable>
        </Field>

        <View style={styles.row}>
          <View style={styles.colHalf}><Field label="Unit type"><Segmented options={['each', 'kg', 'carton']} value={unitType} onChange={(v) => setUnitType(v as UnitType)} /></Field></View>
          <View style={styles.colHalf}><Field label="Velocity tier"><Segmented options={['A', 'B', 'C']} value={velocityClass ?? ''} onChange={(v) => setVelocityClass((v as VelocityClass) || null)} /></Field></View>
        </View>

        <View style={styles.row}>
          <View style={styles.colHalf}><Field label={`Cost (${outlet?.currency ?? ''})`}><TextInput style={styles.inputMono} value={cost} onChangeText={setCost} placeholder="0.00" keyboardType="decimal-pad" /></Field></View>
          <View style={styles.colHalf}><Field label={`Retail price *`}><TextInput style={styles.inputMono} value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad" /></Field></View>
        </View>

        <View style={styles.row}>
          <View style={styles.colThird}><Field label="Min (reorder)"><TextInput style={styles.inputMono} value={minQty} onChangeText={setMinQty} placeholder="0" keyboardType="number-pad" /></Field></View>
          <View style={styles.colThird}><Field label="Max"><TextInput style={styles.inputMono} value={maxQty} onChangeText={setMaxQty} placeholder="0" keyboardType="number-pad" /></Field></View>
          <View style={styles.colThird}><Field label="Carton = N units"><TextInput style={styles.inputMono} value={cartonSize} onChangeText={setCartonSize} placeholder="1" keyboardType="number-pad" /></Field></View>
        </View>
        <Field label="Carton barcode (FR-322)"><TextInput style={styles.input} value={cartonBarcode} onChangeText={setCartonBarcode} placeholder="Optional — scans sell N units" autoCapitalize="characters" autoCorrect={false} /></Field>
        <Field label="Description"><TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder="Optional notes" multiline numberOfLines={3} /></Field>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={() => void save()} disabled={saving}>
          <Text style={styles.saveText}>{isNew ? 'Add product' : 'Save product'}</Text>
        </Pressable>
      </View>
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

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={o} style={[styles.seg, value === o && styles.segActive]} onPress={() => onChange(o)}>
          <Text style={[styles.segText, value === o && styles.segTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.slate50 },
  content: { padding: spacing.lg, paddingBottom: 24 },
  field: { marginBottom: spacing.lg },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate700, marginBottom: spacing.xs + 2 },
  input: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.sans, fontSize: 15, color: colors.slate900,
  },
  inputMono: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.mono, fontSize: 15, color: colors.slate900,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.md },
  colHalf: { flex: 1 },
  colThird: { flex: 1 },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11,
  },
  selectText: { fontFamily: fonts.sans, fontSize: 15, color: colors.slate900 },
  segmented: { flexDirection: 'row', backgroundColor: colors.slate100, borderRadius: radius.control, padding: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.control - 3 },
  segActive: { backgroundColor: colors.primary },
  segText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate500, textTransform: 'capitalize' },
  segTextActive: { color: colors.white },
  footer: {
    padding: spacing.lg, borderTopWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.control, paddingVertical: 14, alignItems: 'center',
  },
  saveText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.white },
});
