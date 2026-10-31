import { Text, StyleSheet, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useT } from '../hooks/useT';
import type { StockStatus } from '../lib/stock';
import type { MsgKey } from '../i18n';

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

/** i18n key per status (FR-115) — labels render through the active UI language. */
const STATUS_KEYS: Record<StockStatus, MsgKey> = {
  in_stock: 'status.in_stock',
  low_stock: 'status.low_stock',
  depleted: 'status.depleted',
  sold_out: 'status.sold_out',
};

export function StatusChip({ status }: { status: StockStatus }) {
  const { t } = useT();
  const meta = STATUS_META[status];
  return <Chip label={t(STATUS_KEYS[status])} tone={meta.tone} />;
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
