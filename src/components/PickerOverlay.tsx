import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '../hooks/useT';
import { colors, fonts, radius, spacing } from '../theme/tokens';

export interface PickerRow {
  key: string;
  label: string;
  /** Optional secondary line (right-aligned), e.g. a currency's full name. */
  sublabel?: string;
  onPress: () => void;
  disabled?: boolean;
}

/**
 * Bottom-sheet list picker — use for ANY choice list with more than 3 options.
 *
 * Why not Alert.alert: React Native's Alert.alert supports at most THREE
 * buttons and silently discards the rest (verified on-device, RN 0.86) — a
 * 20-currency list would show only 3.
 * Why not an inline list in the page's ScrollView: nested ScrollView gestures
 * on Android do not reliably hand the swipe to the inner list (verified
 * on-device) — items below the first screen would be unreachable.
 *
 * This renders a dimmed full-screen backdrop with a scrollable sheet, so the
 * list is always fully navigable. Render it at the screen root.
 */
export function PickerOverlay({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: PickerRow[];
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.slate500} />
          </Pressable>
        </View>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {rows.map((r) => (
            <Pressable
              key={r.key}
              style={[styles.row, r.disabled && styles.rowDisabled]}
              onPress={r.onPress}
              disabled={r.disabled}
            >
              <Text style={styles.label} numberOfLines={1}>
                {r.label}
              </Text>
              {r.sublabel ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {r.sublabel}
                </Text>
              ) : null}
            </Pressable>
          ))}
          <Pressable style={styles.row} onPress={onClose} hitSlop={6}>
            <Text style={[styles.label, styles.closeText]}>{t('common.cancel')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Definite height so the inner ScrollView always scrolls reliably
    // (auto-height + nested ScrollView gestures are unreliable on Android).
    height: '72%',
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fonts.sansBold, fontSize: 17, color: colors.slate900, flexShrink: 1 },
  closeBtn: { padding: 4 },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.control,
  },
  rowDisabled: { opacity: 0.4 },
  label: { fontFamily: fonts.sans, fontSize: 15, color: colors.slate900, flexShrink: 1 },
  sub: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, marginLeft: spacing.sm, flexShrink: 0 },
  closeText: { color: colors.slate500 },
});
