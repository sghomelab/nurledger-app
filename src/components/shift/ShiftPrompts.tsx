import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatMoney, parseMoneyToMinor } from '../../lib/money';
import type { CashMoveType } from '../../lib/shift';
import { colors, fonts, radius, spacing, typography } from '../../theme/tokens';

interface Props {
  visible: boolean;
  type: CashMoveType;
  currency: string;
  onSave: (amountMinor: number, reason: string) => void;
  onCancel: () => void;
}

/**
 * FR-201: cash in / cash out with a reason (float top-up, tips out, etc.).
 * Amount + free-text reason in one modal (kiosk pattern — one tap, one confirm).
 */
export function CashMovePrompt({ visible, type, currency, onSave, onCancel }: Props) {
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const value = parseMoneyToMinor(text);
  const valid = value > 0 && reason.trim().length > 0;

  const reset = () => {
    setText('');
    setReason('');
  };

  const save = () => {
    if (!valid) return;
    onSave(value, reason.trim());
    reset();
  };

  const cancel = () => {
    reset();
    onCancel();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={cancel}>
      <Pressable style={styles.backdrop} onPress={cancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{type === 'in' ? 'Cash in' : 'Cash out'} during shift</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder="0.00"
            autoFocus
            style={styles.input}
          />
          <Text style={styles.hint}>{currency} — major units (e.g. 50.00)</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={type === 'in' ? 'Reason (e.g. Float top-up, tips)' : 'Reason (e.g. Tips out, personal)'}
            style={styles.reason}
          />
          <View style={styles.buttons}>
            <Pressable style={styles.cancelBtn} onPress={cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.saveBtn, !valid && { opacity: 0.45 }]} onPress={save} disabled={!valid}>
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface CloseProps {
  visible: boolean;
  currency: string;
  /** Expected cash in the drawer (shown so the count is informed). */
  expectedMinor: number;
  onSave: (countedMinor: number, notes: string | null) => void;
  onCancel: () => void;
}

/** FR-202: close-shift counted cash + notes. Expected is shown read-only. */
export function CountedCashPrompt({ visible, currency, expectedMinor, onSave, onCancel }: CloseProps) {
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const value = parseMoneyToMinor(text);
  const valid = value >= 0;

  const save = () => {
    if (!valid) return;
    onSave(value, notes.trim() ? notes.trim() : null);
    setText('');
    setNotes('');
  };

  const cancel = () => {
    setText('');
    setNotes('');
    onCancel();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={cancel}>
      <Pressable style={styles.backdrop} onPress={cancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Close shift — count the drawer</Text>
          <View style={styles.expectedRow}>
            <Text style={styles.expectedLabel}>Expected in drawer</Text>
            <Text style={styles.expectedValue}>{formatMoney(expectedMinor, currency)}</Text>
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder="Counted cash"
            autoFocus
            style={styles.input}
          />
          <Text style={styles.hint}>{currency} — the cash you actually counted</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Shift notes (optional)"
            style={styles.reason}
          />
          <View style={styles.buttons}>
            <Pressable style={styles.cancelBtn} onPress={cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.saveBtn, !valid && { opacity: 0.45 }]} onPress={save} disabled={!valid}>
              <Text style={styles.saveText}>Close shift</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', backgroundColor: colors.white, borderRadius: radius.card, padding: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  input: {
    fontFamily: fonts.monoSemiBold, fontSize: 28, color: colors.slate900, borderWidth: 1,
    borderColor: colors.slate300, borderRadius: radius.control, paddingHorizontal: spacing.md,
    paddingVertical: spacing.md, textAlign: 'right',
  },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  reason: {
    fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate900, borderWidth: 1,
    borderColor: colors.slate300, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  buttons: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  saveBtn: { flex: 1, height: 48, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
  expectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.slate50, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  expectedLabel: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  expectedValue: { fontFamily: fonts.monoSemiBold, fontSize: typography.body, color: colors.slate900 },
});
