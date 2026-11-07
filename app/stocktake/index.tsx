import { useT } from '../../src/hooks/useT';
import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Switch,
  Alert,
  Modal,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCategories } from '../../src/hooks/useAppData';
import {
  listStocktakes,
  createStocktake,
  type StocktakeRow,
} from '../../src/repositories/stocktakeRepository';
import { PickerOverlay } from '../../src/components/PickerOverlay';
import { Chip } from '../../src/components/Chip';

/** Applied stocktakes are done; in-progress ones show as counting. */
function StocktakeChip({ applied }: { applied: boolean }) {
  const { t } = useT();
  return applied ? (
    <Chip label={t('stDetail.applied')} tone="positive" />
  ) : (
    <Chip label={t('stDetail.counting')} tone="primary" />
  );
}
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';
import type { Category } from '../../src/types';

/**
 * Stocktakes (FR-304) — list + create.
 *
 * Entry: Inventory tab → "Stocktake" row. A stocktake snapshots the in-scope
 * products (whole store or one category); counts are entered on the detail
 * screen, variances reviewed there, and applied under the
 * `stocktake_apply` gate (owner/manager PIN for cashiers).
 */
export default function StocktakeListScreen() {
  const { t } = useT();
  const router = useRouter();
  const { categories } = useCategories();

  const [items, setItems] = useState<StocktakeRow[] | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [scope, setScope] = useState<{ kind: 'all' } | { kind: 'category'; category: Category }>({ kind: 'all' });
  const [blind, setBlind] = useState(true);
  const [scopePicker, setScopePicker] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setItems(await listStocktakes());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const startStocktake = async () => {
    setStarting(true);
    try {
      const id = await createStocktake({
        scope: scope.kind === 'category' ? 'category' : 'all',
        categoryId: scope.kind === 'category' ? scope.category.id : null,
        blind,
      });
      setCreateVisible(false);
      router.push({ pathname: '/stocktake/[id]', params: { id } });
    } catch (e) {
      Alert.alert(t('stList.stocktakeFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const scopeLabel = scope.kind === 'category' ? scope.category.name : t('labels.allProducts');

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('stList.stocktakes')}</Text>
          <Text style={styles.meta}>{t('stList.countStockBlindCountApply')}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.9 }]}
          onPress={() => setCreateVisible(true)}
        >
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newText}>{t('stList.new')}</Text>
        </Pressable>
      </View>

      <FlatList
        data={items ?? []}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={false} tintColor={colors.slate300} onRefresh={() => void load()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="clipboard-outline" size={40} color={colors.slate300} />
            <Text style={styles.emptyText}>{t('stList.noStocktakesYet')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.slate100 }]}
            onPress={() => router.push({ pathname: '/stocktake/[id]', params: { id: item.id } })}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.categoryName ?? t('labels.allProducts')}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {new Date(item.startedAt).toLocaleString()} · {item.lineCount} products
                {item.blind ? ' · blind' : ''}
              </Text>
            </View>
            <StocktakeChip applied={item.appliedAt !== null} />
          </Pressable>
        )}
      />

      {/* New stocktake sheet */}
      {createVisible && (
        <Modal transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
          <Pressable style={styles.backdrop} onPress={() => setCreateVisible(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>{t('stList.newStocktake')}</Text>

              <Text style={styles.fieldLabel}>{t('labels.scope')}</Text>
              <Pressable style={styles.scopeBtn} onPress={() => setScopePicker(true)}>
                <Text style={styles.scopeText} numberOfLines={1}>{scopeLabel}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.slate400} />
              </Pressable>

              <View style={styles.blindRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('stDetail.blindCount')}</Text>
                  <Text style={styles.hint}>{t('stList.hideBookStockWhileCounting')}</Text>
                </View>
                <Switch
                  value={blind}
                  onValueChange={setBlind}
                  trackColor={{ true: colors.primary, false: colors.slate300 }}
                  thumbColor={colors.white}
                />
              </View>

              <Pressable
                style={({ pressed }) => [styles.startBtn, (starting || categories === null) && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}
                onPress={() => void startStocktake()}
                disabled={starting || categories === null}
              >
                <Text style={styles.startText}>{starting ? t('stList.starting') : t('stList.startCounting')}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {scopePicker && (
        <PickerOverlay
          title={t('stList.stocktakeScope')}
          onClose={() => setScopePicker(false)}
          rows={[
            {
              key: 'all',
              label: t('labels.allProducts'),
              onPress: () => {
                setScope({ kind: 'all' });
                setScopePicker(false);
              },
            },
            ...(categories ?? [])
              .filter((c) => c.active)
              .map((c) => ({
                key: c.id,
                label: c.name,
                onPress: () => {
                  setScope({ kind: 'category', category: c });
                  setScopePicker(false);
                },
              })),
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 },
  meta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 2 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  newText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.white },
  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.sm },
  emptyText: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate400 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  rowMain: { flex: 1 },
  rowName: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 },
  rowMeta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 2 },

  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  sheetTitle: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 },
  fieldLabel: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate500 },
  scopeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.slate300,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  scopeText: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate900 },
  blindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 2 },
  startBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.control,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: spacing.sm,
  },
  startText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.white },
});
