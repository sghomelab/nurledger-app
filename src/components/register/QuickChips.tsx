import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import type { ProductWithStock } from '../../types';

/** Tappable product quick-chips (FR-101 manual/quick path). Out-of-stock is disabled. */
export function QuickChips({
  products,
  onPick,
}: {
  products: ProductWithStock[];
  onPick: (p: ProductWithStock) => void;
}) {
  if (products.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No products match</Text>
      </View>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {products.map((p) => {
        const out = p.stockQty <= 0;
        return (
          <Pressable
            key={p.id}
            disabled={out}
            onPress={() => onPick(p)}
            style={({ pressed }) => [styles.chip, out && styles.chipDisabled, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name={out ? 'remove-circle-outline' : 'add-circle'} size={15} color={out ? colors.slate400 : colors.primary} />
            <Text style={[styles.chipText, out && { color: colors.slate400 }]} numberOfLines={1}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexGrow: 1,
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    height: 40,
    maxWidth: 200,
  },
  chipDisabled: { opacity: 0.55 },
  chipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.slate700,
    maxWidth: 150,
  },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate400 },
});
