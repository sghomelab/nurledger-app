import { useCallback, useEffect, useState } from 'react';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../src/components/Screen';
import { NumberText } from '../../src/components/NumberText';
import { ReportView } from '../../src/components/report/ReportView';
import { useOutlet } from '../../src/hooks/useAppData';
import { getShift, getShiftDrawerSnapshot, type DrawerSnapshot, type Shift } from '../../src/repositories/shiftRepository';
import { formatMoney } from '../../src/lib/money';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';

function timeStr(ms: number): string {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Shift detail (Z-report for closed shifts, live drawer for an open one).
 * The Z-report is the stored z_report_json — the source of truth (FR-202).
 */
export default function ShiftDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { outlet } = useOutlet();
  const [shift, setShift] = useState<Shift | null>(null);
  const [snapshot, setSnapshot] = useState<DrawerSnapshot | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const s = await getShift(id);
    if (!s) {
      setNotFound(true);
      return;
    }
    setShift(s);
    setSnapshot(s.closedAt === null ? await getShiftDrawerSnapshot(s.id) : null);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = outlet?.currency ?? 'SGD';

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: 'Shift', headerBackTitle: 'Shifts' }} />
      {notFound ? (
        <View style={styles.center}>
          <Text style={styles.notFound}>Shift not found.</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>Go back</Text>
          </Pressable>
        </View>
      ) : !shift ? (
        <View style={styles.center}>
          <Text style={styles.notFound}>Loading…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.metaCard}>
            <View style={styles.metaRow}>
              <Text style={styles.metaTitle}>
                {shift.closedAt !== null ? 'Closed' : 'Open'} shift
              </Text>
              <Ionicons name={shift.closedAt !== null ? 'checkmark-circle' : 'time'} size={20} color={shift.closedAt !== null ? colors.positive : colors.warning} />
            </View>
            <Text style={styles.metaLine}>Cashier: {shift.cashierName ?? '—'}</Text>
            <Text style={styles.metaLine}>Opened: {timeStr(shift.openedAt)}</Text>
            {shift.closedAt !== null && <Text style={styles.metaLine}>Closed: {timeStr(shift.closedAt)}</Text>}
            <Text style={styles.metaLine}>Float: {formatMoney(shift.floatMinor, currency)}</Text>
          </Card>

          {shift.closedAt !== null && shift.zReport ? (
            <ReportView report={shift.zReport} currency={currency} />
          ) : snapshot ? (
            <>
              <Text style={styles.section}>Live drawer</Text>
              <Card style={styles.drawerCard}>
                <Row label="Cash sales" value={formatMoney(snapshot.totals.cashSaleMinor, currency)} />
                <Row label="Cash in" value={formatMoney(snapshot.totals.cashInMinor, currency)} />
                <Row label="Cash out" value={formatMoney(snapshot.totals.cashOutMinor, currency)} />
                <View style={styles.divider} />
                <Row label="Expected in drawer" value={formatMoney(snapshot.expectedCashMinor, currency)} strong />
              </Card>
              <Text style={styles.hint}>Close the shift from the Shift tab to generate the Z-report.</Text>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && { fontFamily: fonts.sansSemiBold, color: colors.slate900 }]}>{label}</Text>
      <NumberText style={[styles.rowValue, strong && { fontFamily: fonts.monoSemiBold }]}>{value}</NumberText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  metaCard: { gap: spacing.xs },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  metaLine: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  section: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700, marginTop: spacing.sm },
  drawerCard: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  rowValue: { fontFamily: fonts.mono, fontSize: typography.caption, color: colors.slate900 },
  divider: { height: 1, backgroundColor: colors.slate200, marginVertical: spacing.xs },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  notFound: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate500 },
  backBtn: { backgroundColor: colors.primary, borderRadius: radius.control, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  backText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
});
