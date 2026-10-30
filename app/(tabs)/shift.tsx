import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ComingSoon } from '../../src/components/ComingSoon';
import { Card } from '../../src/components/Screen';
import { useOutlet } from '../../src/hooks/useAppData';
import { taxEngineLabel } from '../../src/lib/currency';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';

/**
 * Tab 5 — Cash Drawer / Shift (M4) + Store settings entry (FR-600/FR-602).
 * The Store card exposes the outlet's currency + tax locale so the owner can
 * see at a glance what the register is selling in and change it.
 */
export default function ShiftTab() {
  const router = useRouter();
  const { outlet } = useOutlet();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.storeCard}>
        <View style={styles.storeRow}>
          <View style={styles.storeIcon}>
            <Ionicons name="storefront" size={22} color={colors.white} />
          </View>
          <View style={styles.storeTexts}>
            <Text style={styles.storeName}>{outlet?.name ?? 'Store'}</Text>
            <Text style={styles.storeMeta}>
              {outlet ? `${outlet.currency} · ${taxEngineLabel(outlet.taxEngine)}` : 'Loading…'}
            </Text>
          </View>
          <Pressable style={styles.changeBtn} onPress={() => router.push('/settings')} hitSlop={8}>
            <Text style={styles.changeBtnText}>Change</Text>
          </Pressable>
        </View>
      </Card>

      <ComingSoon
        icon="cash-outline"
        title="Cash Drawer"
        milestone="Ships in M4"
        bullets={[
          'Shift open with starting float — register locked when closed',
          'Cash in/out with reasons during shift',
          'Close: counted cash → over/short → Z-report',
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.slate50, flexGrow: 1 },
  storeCard: { padding: spacing.md },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  storeIcon: {
    width: 40, height: 40, borderRadius: radius.card, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  storeTexts: { flex: 1 },
  storeName: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.slate900 },
  storeMeta: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500, marginTop: 2 },
  changeBtn: {
    backgroundColor: colors.slate100, borderRadius: radius.control,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  changeBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.primary },
});
