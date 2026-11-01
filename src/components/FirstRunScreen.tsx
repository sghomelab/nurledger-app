import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '../hooks/useT';
import { getDb } from '../db/database';
import { completeFirstRun, isFirstRunPending, type FirstRunMode } from '../db/firstRun';
import { colors, fonts, radius, spacing } from '../theme/tokens';

/**
 * First-run choice — the owner picks how the store starts:
 *   "Load sample data" → the 11-product prototype fixture
 *   "Start empty"      → zero products/stock/sales (add your own)
 *
 * Rendered by the root layout (app/_layout.tsx) while `settings.seeded_v1`
 * is unset — i.e. a fresh install that has not made its choice yet. When the
 * choice completes, the root layout's state-change subscription re-gates and
 * this screen unmounts. Also reached again after Settings → Reset all data.
 *
 * Thin by design: all decisions live in the db layer (src/db/firstRun.ts).
 */
export function FirstRunScreen() {
  const { t } = useT();
  const [busy, setBusy] = useState<FirstRunMode | null>(null);

  const choose = async (mode: FirstRunMode) => {
    if (busy) return;
    setBusy(mode);
    try {
      const db = await getDb();
      await completeFirstRun(db, mode);
      // Defensive: if the choice somehow didn't clear the pending state
      // (e.g. the fixture was skipped without an outlet row), re-arm the
      // buttons instead of leaving a stuck "Setting up…".
      if (await isFirstRunPending(db)) setBusy(null);
      // Otherwise the root layout re-gates (state-change notify) and this
      // screen unmounts — no manual navigation here.
    } catch {
      // Defensive: bootstrap guarantees the db is open. Let the user retry.
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <Ionicons name="storefront" size={34} color={colors.primary} />
          <Text style={styles.appName}>Nurledger</Text>
        </View>
        <Text style={styles.title}>{t('firstRun.title')}</Text>
        <Text style={styles.body}>{t('firstRun.body')}</Text>

        <Pressable
          style={[styles.option, busy !== null && styles.optionDisabled]}
          disabled={busy !== null}
          onPress={() => void choose('sample')}
        >
          <View style={[styles.optionIcon, { backgroundColor: colors.primary }]}>
            <Ionicons name="cube" size={20} color={colors.white} />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>
              {busy === 'sample' ? t('firstRun.busy') : t('firstRun.sample')}
            </Text>
            <Text style={styles.optionSub}>{t('firstRun.sampleSub')}</Text>
          </View>
        </Pressable>

        <Pressable
          style={[styles.option, busy !== null && styles.optionDisabled]}
          disabled={busy !== null}
          onPress={() => void choose('empty')}
        >
          <View style={[styles.optionIcon, { backgroundColor: colors.slate700 }]}>
            <Ionicons name="leaf-outline" size={20} color={colors.white} />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>
              {busy === 'empty' ? t('firstRun.busy') : t('firstRun.empty')}
            </Text>
            <Text style={styles.optionSub}>{t('firstRun.emptySub')}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50, justifyContent: 'center', padding: spacing.lg },
  card: { gap: spacing.md },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  appName: { fontFamily: fonts.sansBold, fontSize: 22, color: colors.slate900 },
  title: { fontFamily: fonts.sansBold, fontSize: 20, color: colors.slate900, marginBottom: spacing.xs },
  body: { fontFamily: fonts.sans, fontSize: 15, color: colors.slate500, marginBottom: spacing.lg },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.white, borderRadius: radius.control,
    borderWidth: 1, borderColor: colors.slate200, padding: spacing.md,
  },
  optionDisabled: { opacity: 0.6 },
  optionIcon: {
    width: 38, height: 38, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.slate900 },
  optionSub: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.slate500, lineHeight: 17 },
});
