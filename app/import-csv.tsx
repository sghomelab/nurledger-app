import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { getPickedFile } from '../src/lib/pickedFile';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { useOutlet } from '../src/hooks/useAppData';
import { importProducts, type ProductImportReport } from '../src/repositories/productRepository';
import { parseProductsCsv, type ParseResult } from '../src/lib/productCsv';
import { formatMoney } from '../src/lib/money';
import { NumberText } from '../src/components/NumberText';
import { colors, fonts, radius, spacing, typography } from '../src/theme/tokens';

/**
 * FR-314 (M6) — CSV import preview + report. Reads the picked file, parses
 * it with the pure validator, shows every row with its status (importable /
 * errors with line numbers), and applies only the valid rows. The final
 * report (created / updated / new categories) comes from the transaction.
 */
type State =
  | { phase: 'loading' }
  | { phase: 'parsed'; result: ParseResult }
  | { phase: 'applying' }
  | { phase: 'done'; report: ProductImportReport; okCount: number; errorCount: number }
  | { phase: 'error'; message: string };

export default function ImportCsvScreen() {
  const router = useRouter();
  const { outlet } = useOutlet();
  // The picked URI arrives via module-state handoff (see pickedFile.ts) — it
  // must keep the exact percent-encoded form the SAF grant was registered
  // under, so it never goes through the router query string.
  const [picked] = useState(() => getPickedFile());
  const uri = picked?.uri;
  const [state, setState] = useState<State>({ phase: 'loading' });

  // Reading is retriable: SAF URI grants can lag the picker result on some
  // Android versions, so a transient failure shouldn't dead-end the user.
  const readAndParse = useCallback(async () => {
    if (!uri) {
      setState({ phase: 'error', message: 'No file selected.' });
      return;
    }
    setState({ phase: 'loading' });
    try {
      const buf = await new File(uri).arrayBuffer();
      const text = new TextDecoder('utf-8').decode(buf);
      const result = parseProductsCsv(text, outlet?.currency ?? 'SGD');
      setState({ phase: 'parsed', result });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    // Outlet currency is stable within a session; uri is the picked file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  useEffect(() => {
    void readAndParse();
  }, [readAndParse]);

  const currency = outlet?.currency ?? 'SGD';

  const apply = async () => {
    if (state.phase !== 'parsed' || state.result.okCount === 0) return;
    const rows = state.result.rows.filter((r) => r.ok && r.row);
    const errorCount = state.result.errorCount;
    setState({ phase: 'applying' });
    try {
      const report = await importProducts(rows.map((r) => r.row!));
      setState({ phase: 'done', report, okCount: rows.length, errorCount });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const fileName = useMemo(
    () => picked?.name ?? (uri ? decodeURIComponent(uri.split('/').pop() ?? '') : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uri, picked?.name],
  );

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: 'Import Products', headerBackVisible: true }} />

      {state.phase === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerText}>Reading file…</Text>
        </View>
      )}

      {state.phase === 'error' && (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
          <Text style={styles.errorText}>{state.message}</Text>
          <Pressable style={[styles.primaryBtn, { marginTop: spacing.xl }]} onPress={() => void readAndParse()}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, { marginTop: spacing.sm }]} onPress={() => router.back()}>
            <Text style={styles.ghostBtnText}>Back</Text>
          </Pressable>
        </View>
      )}

      {state.phase === 'applying' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerText}>Importing…</Text>
        </View>
      )}

      {state.phase === 'done' && (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle" size={48} color={colors.positive} />
          <Text style={styles.doneTitle}>Import complete</Text>
          <Text style={styles.centerText}>
            {state.report.created} created · {state.report.updated} updated
          </Text>
          {state.report.categoriesCreated.length > 0 && (
            <Text style={styles.centerText}>
              New categories: {state.report.categoriesCreated.join(', ')}
            </Text>
          )}
          {state.errorCount > 0 ? (
            <Text style={[styles.centerText, { color: colors.danger }]}>
              {state.errorCount} row(s) skipped — see the report.
            </Text>
          ) : null}
          <Pressable style={[styles.primaryBtn, { marginTop: spacing.xl }]} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </Pressable>
        </View>
      )}

      {state.phase === 'parsed' && (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
          <Text style={styles.fileName}>{fileName}</Text>
          <View style={styles.summaryRow}>
            <Chip label={`${state.result.okCount} importable`} tone="positive" />
            <Chip label={`${state.result.errorCount} errors`} tone={state.result.errorCount > 0 ? 'danger' : 'muted'} />
          </View>

          {state.result.fatal ? (
            <View style={styles.errorCard}>
              <Ionicons name="close-circle" size={18} color={colors.danger} />
              <Text style={styles.errorCardText}>{state.result.fatal}</Text>
            </View>
          ) : null}

          {state.result.rows.map((r) => (
            <View
              key={r.line}
              style={[styles.rowCard, !r.ok && { borderColor: colors.danger }]}
            >
              <View style={styles.rowMain}>
                {r.row ? (
                  <>
                    <Text style={styles.rowSku}>{r.row.sku}</Text>
                    <Text style={styles.rowName} numberOfLines={1}>{r.row.name}</Text>
                  </>
                ) : (
                  <Text style={styles.rowSku}>line {r.line}</Text>
                )}
              </View>
              {r.row ? (
                <NumberText style={styles.rowPrice}>{formatMoney(r.row.priceMinor, currency)}</NumberText>
              ) : (
                <Ionicons name="close-circle" size={18} color={colors.danger} />
              )}
              {!r.ok && (
                <Text style={styles.rowIssues}>{r.issues.join(' · ')}</Text>
              )}
            </View>
          ))}

          {state.result.rows.length === 0 && !state.result.fatal && (
            <Text style={styles.centerText}>No data rows in the file.</Text>
          )}
        </ScrollView>
      )}

      {state.phase === 'parsed' && !state.result.fatal && (
        <View style={styles.footer}>
          <Pressable
            style={[styles.primaryBtn, (state.result.okCount === 0) && { opacity: 0.5 }]}
            onPress={() => void apply()}
            disabled={state.result.okCount === 0}
          >
            <Text style={styles.primaryBtnText}>
              Import {state.result.okCount} product{state.result.okCount === 1 ? '' : 's'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Chip({ label, tone }: { label: string; tone: 'positive' | 'danger' | 'muted' }) {
  const bg = tone === 'positive' ? colors.positiveSoft : tone === 'danger' ? colors.dangerSoft : colors.slate100;
  const fg = tone === 'positive' ? colors.positive : tone === 'danger' ? colors.danger : colors.slate500;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  centerText: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate500, textAlign: 'center' },
  errorText: { fontFamily: fonts.sans, fontSize: 15, color: colors.danger, textAlign: 'center' },
  doneTitle: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900 },
  fileName: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.slate500, marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  chip: { borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 4 },
  chipText: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.control,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorCardText: { flex: 1, fontFamily: fonts.sans, fontSize: 13.5, color: colors.danger },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  rowMain: { flex: 1 },
  rowSku: { fontFamily: fonts.mono, fontSize: 12, color: colors.slate500 },
  rowName: { fontFamily: fonts.sansSemiBold, fontSize: 14.5, color: colors.slate900, marginTop: 1 },
  rowPrice: { fontSize: 14, fontWeight: '500' },
  rowIssues: { fontFamily: fonts.sans, fontSize: 12, color: colors.danger, marginTop: 3 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    backgroundColor: colors.slate50,
    borderTopWidth: 1,
    borderTopColor: colors.slate200,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.control,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 16, color: colors.white },
  ghostBtn: { paddingVertical: 10, paddingHorizontal: spacing.lg },
  ghostBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.slate500 },
});
