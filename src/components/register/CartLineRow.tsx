import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NumberText } from '../NumberText';
import { formatMoney } from '../../lib/money';
import { formatWeight } from '../../lib/weighed';
import { useT } from '../../hooks/useT';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';
import type { CartLine } from '../../types';

interface Props {
  line: CartLine;
  currency: string;
  onQty: (delta: number) => void;
  onRemove: () => void;
  /** Tap the unit price to override it (BUILD-PROMPT "price adjust"). */
  onSetPrice: () => void;
  /** Tap the tag to set a per-line discount (FR-105). */
  onSetDiscount: () => void;
}

/**
 * A single cart line (FR-105: qty edit, per-line discount, price override,
 * remove). Weighed lines (M5, FR-103) show the weighed amount instead of a
 * qty stepper — qty is fixed at 1 and the price is per-amount, not per-unit.
 */
export function CartLineRow({ line, currency, onQty, onRemove, onSetPrice, onSetDiscount }: Props) {
  const { t } = useT();
  const lineTotal = line.unitPriceMinor * line.qty - Math.max(0, line.discountMinor);
  const weighed = line.qtyG != null;
  return (
    <View style={styles.row}>
      <View style={styles.nameCol}>
        <Text style={styles.name} numberOfLines={2}>
          {line.name}
        </Text>
        <View style={styles.metaRow}>
          <Pressable onPress={onSetPrice} hitSlop={6}>
            <NumberText style={styles.meta}>{formatMoney(line.unitPriceMinor, currency)}</NumberText>
          </Pressable>
          {weighed && (
            <View style={styles.weightChip}>
              <Ionicons name="scale-outline" size={11} color={colors.primary} />
              <NumberText style={[styles.meta, { color: colors.primary }]}>
                {formatWeight(line.qtyG!)}
              </NumberText>
            </View>
          )}
          <Pressable onPress={onSetDiscount} hitSlop={6}>
            <View style={styles.metaTag}>
              {line.discountMinor > 0 ? (
                <NumberText style={[styles.meta, { color: colors.positive }]}>
                  −{formatMoney(line.discountMinor, currency)}
                </NumberText>
              ) : (
                <Text style={[styles.meta, { color: colors.slate400 }]}>{t('cart.discount')}</Text>
              )}
              <Ionicons name="pricetag-outline" size={11} color={colors.slate400} />
            </View>
          </Pressable>
        </View>
      </View>

      {!weighed && (
        <View style={styles.stepper}>
          <Pressable style={styles.stepBtn} onPress={() => onQty(-1)} hitSlop={4}>
            <Ionicons name="remove" size={16} color={colors.slate700} />
          </Pressable>
          <NumberText style={styles.qty}>{line.qty}</NumberText>
          <Pressable style={styles.stepBtn} onPress={() => onQty(1)} hitSlop={4}>
            <Ionicons name="add" size={16} color={colors.slate700} />
          </Pressable>
        </View>
      )}

      <View style={styles.rightCol}>
        <NumberText style={styles.lineTotal}>{formatMoney(lineTotal, currency)}</NumberText>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="trash-outline" size={16} color={colors.slate400} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate100,
  },
  nameCol: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.sansMedium, fontSize: typography.body, color: colors.slate900 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { fontSize: typography.caption, color: colors.slate500 },
  weightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.chip,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  metaTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.slate100,
    borderRadius: radius.control,
    paddingHorizontal: 2,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  qty: { fontSize: typography.body, minWidth: 24, textAlign: 'center' },
  rightCol: {
    width: 84,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexDirection: 'row',
  },
  lineTotal: { fontSize: typography.body },
});
