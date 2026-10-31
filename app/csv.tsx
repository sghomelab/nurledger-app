import { useState } from 'react';
import { useRouter, Stack } from 'expo-router';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { listProducts, listCategories } from '../src/repositories/productRepository';
import { setPickedFile } from '../src/lib/pickedFile';
import { useOutlet } from '../src/hooks/useAppData';
import { serializeProductsToCsv } from '../src/lib/productCsv';
import { colors, fonts, radius, spacing, typography } from '../src/theme/tokens';

/**
 * FR-314 (M6) — product data import/export hub, reached from the Inventory
 * tab. Export: all products → CSV (major-unit money) → system share sheet.
 * Import: pick a .csv → /import-csv preview + report screen.
 */
export default function ProductDataScreen() {
  const router = useRouter();
  const { outlet } = useOutlet();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const [products, cats] = await Promise.all([listProducts(), listCategories()]);
      const catName = (id: string | null) => (id ? cats.find((c) => c.id === id)?.name ?? null : null);
      const csv = serializeProductsToCsv(products, catName, outlet?.currency ?? 'SGD');
      const dir = new Directory(Paths.join(Paths.document.uri, 'exports'));
      dir.create({ intermediates: true, idempotent: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.join(dir.uri, `nurledger_products_${stamp}.csv`));
      file.write(csv);
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device');
      }
      await Sharing.shareAsync(file.uri, {
        dialogTitle: 'Share product list',
        UTI: 'public.csv',
      });
      setExported(file.uri);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const doImportPick = async () => {
    try {
      // `text/csv` is a deprecated IANA synonym; Android's MediaStore assigns
      // `text/comma-separated-values`, so accept both (plus plain text — some
      // devices mislabel CSVs, and the parser rejects non-CSV content anyway).
      const res = await File.pickFileAsync({
        mimeTypes: ['text/comma-separated-values', 'text/csv', 'text/plain'],
      });
      if (res.canceled || !res.result) return;
      // Hand the raw (percent-encoded) URI off in module state — the router
      // query string would decode it and break the SAF grant key.
      setPickedFile({ uri: res.result.uri, name: res.result.name ?? null });
      router.push('/import-csv');
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: 'Product Data (CSV)', headerBackVisible: true }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        <Text style={styles.intro}>
          Move the product catalog in and out of the app as a CSV file. Money in the file is in your
          store currency (major units). Import updates products by SKU — new SKUs are added, existing
          ones are updated.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.actionCard, pressed && { backgroundColor: colors.slate100 }]}
          onPress={() => void doExport()}
          disabled={exporting}
        >
          <View style={styles.actionIcon}>
            <Ionicons name="download-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Export products to CSV</Text>
            <Text style={styles.actionSub}>All products, current prices & thresholds</Text>
          </View>
          {exporting && <ActivityIndicator color={colors.primary} />}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.actionCard, pressed && { backgroundColor: colors.slate100 }]}
          onPress={() => void doImportPick()}
        >
          <View style={styles.actionIcon}>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Import products from CSV</Text>
            <Text style={styles.actionSub}>Upsert by SKU · preview & report before applying</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.slate400} />
        </Pressable>

        {exported ? (
          <View style={styles.noteCard}>
            <Ionicons name="checkmark-circle" size={18} color={colors.positive} />
            <Text style={styles.noteText}>
              Export ready — shared just now ({exported.split('/').pop()}).
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  intro: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate500, lineHeight: 20, marginBottom: spacing.lg },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
  actionSub: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.slate500, marginTop: 2 },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.positiveSoft,
    borderRadius: radius.control,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  noteText: { flex: 1, fontFamily: fonts.sans, fontSize: 13, color: colors.slate700 },
});
