import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

interface Props {
  visible: boolean;
  /** The finished CSV text (build* in src/lib/csv.ts). */
  csv: string;
  /** File name shown in the sheet and written to disk, e.g. financial_pl_today.csv. */
  fileName: string;
  onClose: () => void;
}

type ShareState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done' }
  | { status: 'error'; message: string };

/**
 * CSV preview + Save & Share (M4 exports). Writes to the app's document
 * directory (`exports/<fileName>`) and opens the Android share sheet — the
 * standard offline path for "email this report" on a shop kiosk.
 */
export function CsvSheet({ visible, csv, fileName, onClose }: Props) {
  const [state, setState] = useState<ShareState>({ status: 'idle' });

  const share = async () => {
    setState({ status: 'busy' });
    try {
      const dir = new Directory(Paths.join(Paths.document.uri, 'exports'));
      dir.create({ intermediates: true, idempotent: true });
      const file = new File(Paths.join(dir.uri, fileName));
      file.write(csv);

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device');
      }
      await Sharing.shareAsync(file.uri, {
        dialogTitle: 'Share report',
        UTI: 'public.comma-separated-values-text',
      });
      setState({ status: 'done' });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Ionicons name="document-text" size={18} color={colors.primary} />
            <Text style={styles.title}>{fileName}</Text>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.slate500} />
            </Pressable>
          </View>

          <Text style={styles.meta}>{csv.split('\r\n').length} rows · {csv.length} chars · saved to {Paths.join(Paths.document.uri, 'exports')}</Text>

          <ScrollView style={styles.preview} nestedScrollEnabled>
            <Text style={styles.previewText}>{csv}</Text>
          </ScrollView>

          <View style={styles.footer}>
            {state.status === 'done' && (
              <Text style={styles.done}>✓ Shared — file kept in {Paths.join(Paths.document.uri, 'exports')}</Text>
            )}
            {state.status === 'error' && <Text style={styles.error}>{state.message}</Text>}
            <View style={styles.buttons}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Close</Text>
              </Pressable>
              <Pressable
                style={[styles.shareBtn, state.status === 'busy' && { opacity: 0.6 }]}
                onPress={() => void share()}
                disabled={state.status === 'busy'}
              >
                <Text style={styles.shareText}>{state.status === 'busy' ? 'Sharing…' : 'Save & Share'}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    height: '72%',
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900, flex: 1 },
  closeBtn: { padding: 4 },
  meta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  preview: {
    flex: 1,
    backgroundColor: colors.slate50,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: spacing.md,
  },
  previewText: { fontFamily: fonts.mono, fontSize: 11, color: colors.slate700 },
  footer: { gap: spacing.sm },
  done: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.positive },
  error: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger },
  buttons: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  shareBtn: { flex: 1, height: 48, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  shareText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
});
