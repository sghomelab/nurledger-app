import { useT } from '../../src/hooks/useT';
import { centeredColumn } from '../../src/lib/layout';
import { useMemo, useEffect, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Modal, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PickerOverlay } from '../../src/components/PickerOverlay';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';
import { useCategories, useOutlet, useProducts } from '../../src/hooks/useAppData';
import { createProduct, getProduct, updateProduct, type ProductInput } from '../../src/repositories/productRepository';
import { listSuppliers } from '../../src/repositories/supplierRepository';
import { fonts, radius, spacing, typography, type Palette } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/ThemeContext';
import type { SupplierWithCounts, UnitType, VelocityClass } from '../../src/types';

/**
 * Product add/edit form (M1 local CRUD, FR-300). Money fields are entered as
 * decimal strings and stored as integer minor units (ADR-004). Reachable as
 * `/inventory/new` (no id) or `/inventory/edit?id=<id>` (edit).
 */
export default function ProductFormScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();
  // Route params arrive via useLocalSearchParams (routes are untyped — no prop injection).
  const { id } = useLocalSearchParams<{ id?: string }>();
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
  const [catPicker, setCatPicker] = useState(false);
  /** Which barcode field the camera scanner fills (issues #10/#11). */
  const [scanTarget, setScanTarget] = useState<'barcode' | 'carton' | null>(null);

  // FR-313: supplier master link
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierWithCounts[]>([]);
  const [supplierPicker, setSupplierPicker] = useState(false);

  useEffect(() => {
    void listSuppliers().then(setSuppliers);
  }, []);

  // Load existing product once (edit flow)
  useEffect(() => {
    if (isNew || loaded) return;
    void (async () => {
      const p = await getProduct(id!);
      if (!p) {
        Alert.alert(t('invEdit.notFound'), t('invDetail.thisProductNoLongerExists'));
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
      setSupplierId(p.supplierId);
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
      Alert.alert(t('settings.missingFields'), t('invEdit.nameAndSkuAreRequired'));
      return;
    }
    if (toMinor(price) <= 0) {
      Alert.alert(t('settings.missingFields'), t('invEdit.retailPriceMustBeGreater'));
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
        supplierId,
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
      Alert.alert(t('settings.saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const addCat = async () => {
    const res = await new Promise<string | null>((resolve) => {
      Alert.prompt(t('invEdit.newCategoryPrompt'), '', (v) => resolve(v && v.trim() ? v.trim() : null), 'plain-text');
    });
    if (res) {
      const c = await addCategory(res);
      setCategoryId(c.id);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, centeredColumn]} keyboardShouldPersistTaps="handled">
        <Field label={t('invEdit.name')}><TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t('invEdit.eGRice5kg')} /></Field>
        <View style={styles.row}>
          <View style={styles.colHalf}><Field label={t('invEdit.sku')}><TextInput style={styles.input} value={sku} onChangeText={setSku} placeholder="RICE-5KG" autoCapitalize="characters" autoCorrect={false} /></Field></View>
          <View style={styles.colHalf}><Field label={t('invDetail.barcode')}><View style={styles.scanField}><TextInput style={[styles.input, { flex: 1 }]} value={barcode} onChangeText={setBarcode} placeholder={t('invEdit.scanOrType')} keyboardType="number-pad" autoCapitalize="characters" autoCorrect={false} /><Pressable style={styles.scanFieldBtn} onPress={() => setScanTarget('barcode')} accessibilityLabel={t('scan.title')}><Ionicons name="camera" size={18} color={colors.primary} /></Pressable></View></Field></View>
        </View>

        <Field label={t('invDetail.category')}>
          <Pressable style={styles.selectBox} onPress={() => setCatPicker(true)}>
            <Text style={styles.selectText}>{categories?.find((c) => c.id === categoryId)?.name ?? t('invDetail.none')}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.slate400} />
          </Pressable>
        </Field>

        {/* FR-313: per-supplier SKU link */}
        <Field label={t('invDetail.supplier')}>
          <Pressable style={styles.selectBox} onPress={() => setSupplierPicker(true)}>
            <Text style={styles.selectText}>{suppliers.find((s) => s.id === supplierId)?.name ?? t('invDetail.none')}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.slate400} />
          </Pressable>
        </Field>

        <View style={styles.row}>
          <View style={styles.colHalf}><Field label={t('invDetail.unitType')}><Segmented options={['each', 'kg', 'carton']} value={unitType} onChange={(v) => setUnitType(v as UnitType)} /></Field></View>
          <View style={styles.colHalf}><Field label={t('invDetail.velocityTier')}><Segmented options={['A', 'B', 'C']} value={velocityClass ?? ''} onChange={(v) => setVelocityClass((v as VelocityClass) || null)} /></Field></View>
        </View>

        <View style={styles.row}>
          <View style={styles.colHalf}><Field label={t('invEdit.costLabel', { currency: outlet?.currency ?? '' })}><TextInput style={styles.inputMono} value={cost} onChangeText={setCost} placeholder="0.00" keyboardType="decimal-pad" /></Field></View>
          <View style={styles.colHalf}><Field label={t('invEdit.retailPrice')}><TextInput style={styles.inputMono} value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad" /></Field></View>
        </View>

        <View style={styles.row}>
          <View style={styles.colThird}><Field label={t('invDetail.minReorder')}><TextInput style={styles.inputMono} value={minQty} onChangeText={setMinQty} placeholder="0" keyboardType="number-pad" /></Field></View>
          <View style={styles.colThird}><Field label={t('invDetail.max')}><TextInput style={styles.inputMono} value={maxQty} onChangeText={setMaxQty} placeholder="0" keyboardType="number-pad" /></Field></View>
          <View style={styles.colThird}><Field label={t('invEdit.cartonNUnits')}><TextInput style={styles.inputMono} value={cartonSize} onChangeText={setCartonSize} placeholder="1" keyboardType="number-pad" /></Field></View>
        </View>
        <Field label={t('invEdit.cartonBarcodeFr322')}><View style={styles.scanField}><TextInput style={[styles.input, { flex: 1 }]} value={cartonBarcode} onChangeText={setCartonBarcode} placeholder={t('invEdit.optionalScansSellNUnits')} autoCapitalize="characters" autoCorrect={false} /><Pressable style={styles.scanFieldBtn} onPress={() => setScanTarget('carton')} accessibilityLabel={t('scan.title')}><Ionicons name="camera" size={18} color={colors.primary} /></Pressable></View></Field>
        <Field label={t('invEdit.description')}><TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder={t('invEdit.optionalNotes')} multiline numberOfLines={3} /></Field>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={() => void save()} disabled={saving}>
          <Text style={styles.saveText}>{isNew ? t('invEdit.addProduct') : t('invEdit.saveProduct')}</Text>
        </Pressable>
      </View>

      {catPicker && (
        <PickerOverlay
          title={t('invDetail.category')}
          rows={[
            ...(categories ?? []).map((c) => ({
              key: c.id,
              label: c.name,
              onPress: () => {
                setCategoryId(c.id);
                setCatPicker(false);
              },
            })),
            { key: 'new', label: t('invEdit.newCategory'), onPress: () => { setCatPicker(false); void addCat(); } },
            { key: 'none', label: t('invDetail.none'), onPress: () => { setCategoryId(null); setCatPicker(false); } },
          ]}
          onClose={() => setCatPicker(false)}
        />
      )}

      {supplierPicker && (
        <PickerOverlay
          title={t('invEdit.supplierFr313')}
          rows={[
            ...suppliers.map((s) => ({
              key: s.id,
              label: s.name,
              sublabel: t('invDetail.daysLead', { n: s.leadTimeDays }),
              onPress: () => {
                setSupplierId(s.id);
                setSupplierPicker(false);
              },
            })),
            { key: 'none', label: t('invDetail.none'), onPress: () => { setSupplierId(null); setSupplierPicker(false); } },
          ]}
          onClose={() => setSupplierPicker(false)}
        />
      )}

      {/* Camera scanner for product + carton barcodes (issues #10/#11).
          Must be a Modal: rendered inline it lays out in-flow below the
          scrollview (off-screen) — the camera would run invisibly. */}
      <Modal visible={scanTarget !== null} animationType="fade" onRequestClose={() => setScanTarget(null)}>
        {scanTarget && (
          <BarcodeScanner
            onClose={() => setScanTarget(null)}
            onScanned={(code) => {
              const target = scanTarget;
              setScanTarget(null);
              if (target === 'barcode') setBarcode(code);
              else setCartonBarcode(code);
            }}
          />
        )}
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

function makeStyles(colors: Palette) {
  return StyleSheet.create({

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
    scanField: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    scanFieldBtn: {
      width: 42, height: 42, borderRadius: radius.control, borderWidth: 1, borderColor: colors.primary,
      backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center',
    },
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
}