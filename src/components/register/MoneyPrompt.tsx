import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatMoneyBare, parseMoneyToMinor } from '../../lib/money';
import { useT } from '../../hooks/useT';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

interface Props {
  title: string;
  currency: string;
  initialMinor: number;
  onSave: (minor: number) => void;
  onCancel: () => void;
}

/**
 * A tiny cross-platform money entry dialog (Alert.prompt is iOS-only, so this
 * works on both). Used for order discount and per-line price/discount (FR-105,
 * price adjust). PIN-gating is deferred (SPEC-DEVIATION DEV-003).
 */
export function MoneyPrompt({ title, currency, initialMinor, onSave, onCancel }: Props) {
  const [text, setText] = useState(formatMoneyBare(initialMinor));
  const { t } = useT();
  const value = parseMoneyToMinor(text);

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder="0.00"
            autoFocus
            style={styles.input}
          />
          <Text style={styles.hint}>{t('money.hint', { currency })}</Text>
          <View style={styles.buttons}>
            <Pressable style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={() => onSave(value)}>
              <Text style={styles.saveText}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  input: {
    fontFamily: fonts.monoSemiBold,
    fontSize: 28,
    color: colors.slate900,
    borderWidth: 1,
    borderColor: colors.slate300,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'right',
  },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  buttons: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  saveBtn: { flex: 1, height: 48, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
});
