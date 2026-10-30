import { Text, StyleSheet, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import type { StockStatus } from '../lib/stock';

type Tone = 'neutral' | 'primary' | 'positive' | 'warning' | 'danger';

const toneMap: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.slate100, fg: colors.slate700 },
  primary: { bg: colors.primarySoft, fg: colors.primary },
  positive: { bg: colors.positiveSoft, fg: colors.positive },
  warning: { bg: colors.warningSoft, fg: '#B45309' },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = toneMap[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** Prototype stock status chips: In Stock / Low Stock / Depleted / Sold Out. */
export const STATUS_META: Record<StockStatus, { label: string; tone: Tone }> = {
  in_stock: { label: 'In Stock', tone: 'positive' },
  low_stock: { label: 'Low Stock', tone: 'warning' },
  depleted: { label: 'Depleted', tone: 'danger' },
  sold_out: { label: 'Sold Out', tone: 'neutral' },
};

export function StatusChip({ status }: { status: StockStatus }) {
  const meta = STATUS_META[status];
  return <Chip label={meta.label} tone={meta.tone} />;
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  chipText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '600',
  },
});
