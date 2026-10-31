import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCategories, useOutlet, useProducts } from '../../src/hooks/useAppData';
import { buildLabelHtml, symbologyFor, type LabelItem, type LabelLayout } from '../../src/lib/label';
import { formatMoney } from '../../src/lib/money';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { ProductWithStock } from '../../src/types';

type Scope =
  | { kind: 'all' }
  | { kind: 'category'; id: string }
  | { kind: 'product'; id: string };

type ShareState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; path: string; count: number; skipped: number }
  | { status: 'error'; message: string };

const MIN_COPIES = 1;
const MAX_COPIES = 100;
const DEFAULT_COPIES = 5;

/**
 * Label printing (M6, FR-317): pick a scope (all products / one category /
 * one product via ?product=<id>), set copies + paper layout, then generate a
 * self-contained HTML label sheet (58mm roll strip or A4 grid) and share it —
 * the offline kiosk print path (open in any browser → print, or email).
 */
export default function LabelsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ product?: string }>();
  const { outlet } = useOutlet();
  const { products } = useProducts();
  const { categories } = useCategories();

  const currency = outlet?.currency ?? 'SGD';

  const singleId = params.product ?? null;
  const [scope, setScope] = useState<Scope>(singleId ? { kind: 'product', id: singleId } : { kind: 'all' });
  const [copies, setCopies] = useState(DEFAULT_COPIES);
  const [layout, setLayout] = useState<LabelLayout>('roll58');
  const [state, setState] = useState<ShareState>({ status: 'idle' });

  const inScope: ProductWithStock[] = useMemo(() => {
    if (!products) return [];
    if (scope.kind === 'product') return products.filter((p) => p.id === scope.id);
    if (scope.kind === 'category') return products.filter((p) => p.categoryId === scope.id);
    return products;
  }, [products, scope]);

  const { printable, skipped } = useMemo(() => {
    const ok = inScope.filter((p) => symbologyFor(p.barcode ?? p.sku) !== null);
    return { printable: ok, skipped: inScope.length - ok.length };
  }, [inScope]);

  const totalLabels = printable.length * copies;
  const canGenerate = products !== null && printable.length > 0 && state.status !== 'busy';

  const generate = async () => {
    if (!canGenerate) return;
    setState({ status: 'busy' });
    try {
      const items: LabelItem[] = printable.map((p) => ({
        name: p.name,
        priceText: formatMoney(p.priceMinor, currency),
        // FR-317: no-barcode items print their SKU as a scannable Code 39.
        code: p.barcode ?? p.sku,
        count: copies,
      }));
      const html = buildLabelHtml(items, layout);

      const dir = new Directory(Paths.join(Paths.document.uri, 'exports'));
      dir.create({ intermediates: true, idempotent: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      const tag = scope.kind === 'all' ? 'all' : scope.kind === 'category' ? 'cat' : 'item';
      const fileName = `labels_${tag}_${layout}_${stamp}.html`;
      const file = new File(Paths.join(dir.uri, fileName));
      file.write(html);

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device');
      }
      await Sharing.shareAsync(file.uri, {
        dialogTitle: 'Share label sheet',
        UTI: 'public.html',
      });
      setState({ status: 'done', path: file.uri, count: totalLabels, skipped });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const scopeLabel =
    scope.kind === 'product'
      ? inScope[0]?.name ?? 'Product not found'
      : scope.kind === 'category'
        ? categories?.find((c) => c.id === scope.id)?.name ?? 'Category'
        : 'All products';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.slate700} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Label printing</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{scopeLabel}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        {products === null ? (
          <Text style={styles.muted}>Loading products…</Text>
        ) : (
          <>
            {scope.kind !== 'product' && (
              <View style={{ gap: spacing.xs }}>
                <Text style={styles.sectionTitle}>Scope</Text>
                <ScopeChip
                  label="All products"
                  count={products.length}
                  selected={scope.kind === 'all'}
                  onPress={() => setScope({ kind: 'all' })}
                />
                {(categories ?? [])
                  .filter((c) => c.active)
                  .map((c) => (
                    <ScopeChip
                      key={c.id}
                      label={c.name}
                      count={products.filter((p) => p.categoryId === c.id).length}
                      selected={scope.kind === 'category' && scope.id === c.id}
                      onPress={() => setScope({ kind: 'category', id: c.id })}
                    />
                  ))}
              </View>
            )}

            <View style={{ gap: spacing.xs }}>
              <Text style={styles.sectionTitle}>Copies per product</Text>
              <View style={styles.stepper}>
                <Pressable
                  style={[styles.stepBtn, copies <= MIN_COPIES && { opacity: 0.4 }]}
                  onPress={() => setCopies((c) => Math.max(MIN_COPIES, c - 1))}
                  hitSlop={8}
                >
                  <Ionicons name="remove" size={20} color={colors.slate700} />
                </Pressable>
                <Text style={styles.stepValue}>{copies}</Text>
                <Pressable
                  style={[styles.stepBtn, copies >= MAX_COPIES && { opacity: 0.4 }]}
                  onPress={() => setCopies((c) => Math.min(MAX_COPIES, c + 1))}
                  hitSlop={8}
                >
                  <Ionicons name="add" size={20} color={colors.slate700} />
                </Pressable>
              </View>
            </View>

            <View style={{ gap: spacing.xs }}>
              <Text style={styles.sectionTitle}>Paper</Text>
              <View style={styles.toggleRow}>
                <LayoutChip label="58mm roll" selected={layout === 'roll58'} onPress={() => setLayout('roll58')} />
                <LayoutChip label="A4 sheet" selected={layout === 'sheetA4'} onPress={() => setLayout('sheetA4')} />
              </View>
              <Text style={styles.muted}>
                {layout === 'roll58'
                  ? 'One 58×40mm label per page — thermal roll printer.'
                  : '3 columns of 58×40mm labels per A4 page — laser/inkjet.'}
              </Text>
            </View>

            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {printable.length} product{printable.length === 1 ? '' : 's'} × {copies} = {totalLabels} label{totalLabels === 1 ? '' : 's'}
              </Text>
              {skipped > 0 && (
                <Text style={styles.warning}>{skipped} skipped — no printable barcode/SKU</Text>
              )}
            </View>

            <Pressable
              style={[styles.cta, !canGenerate && { opacity: 0.5 }]}
              onPress={() => void generate()}
              disabled={!canGenerate}
            >
              <Ionicons name="print-outline" size={18} color={colors.white} />
              <Text style={styles.ctaText}>
                {state.status === 'busy' ? 'Generating…' : 'Generate & Share'}
              </Text>
            </Pressable>

            {state.status === 'done' && (
              <Text style={styles.done}>
                ✓ {state.count} label{state.count === 1 ? '' : 's'} — file kept in {state.path}
              </Text>
            )}
            {state.status === 'error' && <Text style={styles.error}>{state.message}</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ScopeChip({ label, count, selected, onPress }: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.scopeChip, selected && styles.scopeChipSelected]} onPress={onPress}>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={18}
        color={selected ? colors.primary : colors.slate400}
      />
      <Text style={[styles.scopeLabel, selected && styles.scopeLabelSelected]} numberOfLines={1}>{label}</Text>
      <Text style={styles.scopeCount}>{count}</Text>
    </Pressable>
  );
}

function LayoutChip({ label, selected, onPress }: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.layoutChip, selected && styles.layoutChipSelected]} onPress={onPress}>
      <Text style={[styles.layoutText, selected && styles.layoutTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.slate200,
  },
  backBtn: { paddingRight: spacing.md },
  title: { fontFamily: fonts.sansBold, fontSize: 22, color: colors.slate900 },
  subtitle: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500 },
  sectionTitle: {
    fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate500,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  muted: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500 },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  scopeChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  scopeLabel: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate700, flex: 1 },
  scopeLabelSelected: { color: colors.slate900, fontWeight: '700' },
  scopeCount: { fontFamily: fonts.mono, fontSize: 12, color: colors.slate400 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  stepBtn: { padding: spacing.md + 2 },
  stepValue: { fontFamily: fonts.sansBold, fontSize: 17, color: colors.slate900, minWidth: 44, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  layoutChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.white,
  },
  layoutChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  layoutText: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate500 },
  layoutTextSelected: { color: colors.primary, fontWeight: '700' },
  summary: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.md,
  },
  summaryText: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate700 },
  warning: { fontFamily: fonts.sans, fontSize: 12, color: '#B45309', marginTop: 4 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.control,
    paddingVertical: spacing.md + 2,
  },
  ctaText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.white },
  done: { fontFamily: fonts.sans, fontSize: 13, color: colors.positive },
  error: { fontFamily: fonts.sans, fontSize: 14, color: colors.danger },
});
