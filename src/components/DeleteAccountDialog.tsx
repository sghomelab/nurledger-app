import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useT } from '../hooks/useT';
import { colors, fonts, radius, spacing } from '../theme/tokens';

/** The word the user must type (deliberately not translated: it is an action key, like a PIN). */
export const DELETE_CONFIRM_WORD = 'DELETE';

export interface DeleteAccountDialogProps {
  /** 'owner' deletes the whole cloud store; 'member' only their own sign-in. */
  role: 'owner' | 'member' | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Typed-confirmation dialog for in-app cloud account deletion. */
export function DeleteAccountDialog({ role, busy, onConfirm, onCancel }: DeleteAccountDialogProps) {
  const { t } = useT();
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toUpperCase() === DELETE_CONFIRM_WORD && !busy;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('settings.deleteAcctTitle')}</Text>
          <Text style={styles.body}>
            {role === 'owner' ? t('settings.deleteAcctBodyOwner') : t('settings.deleteAcctBodyMember')}
          </Text>
          <Text style={styles.body}>{t('settings.deleteAcctLocalKept')}</Text>
          <Text style={styles.label}>{t('settings.deleteAcctType', { word: DELETE_CONFIRM_WORD })}</Text>
          <TextInput
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel={t('settings.deleteAcctType', { word: DELETE_CONFIRM_WORD })}
          />
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.cancel]} onPress={onCancel} disabled={busy}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.danger, !ok && { opacity: 0.4 }]} onPress={onConfirm} disabled={!ok}>
              <Text style={styles.dangerText}>{t('settings.deleteAcctConfirm')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: radius.control, padding: spacing.lg, gap: spacing.sm },
  title: { fontFamily: fonts.sansMedium, fontSize: 18, color: colors.danger },
  body: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate500, lineHeight: 20 },
  label: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.slate500, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 10, fontFamily: fonts.mono, fontSize: 16 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.control },
  cancel: { backgroundColor: colors.slate100 },
  cancelText: { fontFamily: fonts.sansMedium, color: colors.slate500 },
  danger: { backgroundColor: colors.danger },
  dangerText: { fontFamily: fonts.sansMedium, color: '#fff' },
});
