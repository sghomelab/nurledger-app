import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';

/** Placeholder for milestone-gated tabs (M2–M6) with scope label. */
export function ComingSoon({
  icon,
  title,
  milestone,
  bullets,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  milestone: string;
  bullets: string[];
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.milestoneChip}>
        <Text style={styles.milestoneText}>{milestone}</Text>
      </View>
      <View style={styles.card}>
        {bullets.map((b) => (
          <View key={b} style={styles.bulletRow}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.bullet}>{b}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: typography.title,
    color: colors.slate900,
    marginBottom: spacing.sm,
  },
  milestoneChip: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
  },
  milestoneText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: colors.primary },
  card: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.lg,
  },
  bulletRow: { flexDirection: 'row', paddingVertical: 5 },
  bulletDot: { color: colors.primary, marginRight: spacing.sm, fontWeight: '700' },
  bullet: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate700 },
});
