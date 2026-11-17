import { Text, StyleSheet, View } from 'react-native';
import { fonts, radius, spacing, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { useMemo } from 'react';
import { useT } from '../hooks/useT';
import type { StockStatus } from '../lib/stock';
import type { MsgKey } from '../i18n';

type Tone = 'neutral' | 'primary' | 'positive' | 'warning' | 'danger';

function toneMap(c: Palette): Record<Tone, { bg: string; fg: string }> {
  return {
    neutral: { bg: c.slate100, fg: c.slate700 },
    primary: { bg: c.primarySoft, fg: c.primary },
    positive: { bg: c.positiveSoft, fg: c.positive },
    warning: { bg: c.warningSoft, fg: c.warningText },
    danger: { bg: c.dangerSoft, fg: c.danger },
  };
}

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = toneMap(colors)[tone];
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

function makeStyles(colors: Palette) {
  return StyleSheet.create({

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
}