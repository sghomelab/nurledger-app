import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { canUnlock, type GateAction } from '../lib/roles';
import { pinEntryOutcome, PIN_MAX_LENGTH, PIN_MIN_LENGTH, verifyPin } from '../lib/pin';
import { useT } from '../hooks/useT';
import type { MsgKey } from '../i18n';
import { colors, fonts, radius, spacing, typography } from '../theme/tokens';
import type { AppUser } from '../types';

interface Props {
  visible: boolean;
  /** Which gate this prompt is for (label shown in the header). */
  action: GateAction;
  /** The active users; any of them with a matching PIN can unlock. */
  users: AppUser[];
  /** Fired when a PIN matches an owner/manager user (single-action, session-scoped). */
  onSuccess: () => void;
  onCancel: () => void;
}

/** i18n key per gate action (FR-115) — mirrors GATE_ACTION_LABELS (English). */
const GATE_KEYS: Record<GateAction, MsgKey> = {
  discount: 'gate.discount',
  price_override: 'gate.price_override',
  stock_adjust: 'gate.stock_adjust',
  close_shift: 'gate.close_shift',
  store_settings: 'gate.store_settings',
  refund: 'gate.refund',
  stocktake_apply: 'gate.stocktake_apply',
};

/**
 * PIN unlock prompt (FR-500 / DEV-003/DEV-005). Shown when the ACTIVE user's
 * role does not permit a gated action: entering a PIN belonging to a
 * higher-privileged active user (owner/manager with a PIN set) unlocks the
 * single action. The unlock is never persisted — each gated action re-prompts.
 *
 * Numeral keypad (not a TextInput) — PIN entry is short, and the keypad keeps
 * the kiosk pattern (no IME to fight, no autocorrect surprises).
 */
export function PinPrompt({ visible, action, users, onSuccess, onCancel }: Props) {
  const { t } = useT();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unlockers = useMemo(() => users.filter((u) => canUnlock(u)), [users]);

  const press = (d: string) => {
    setError(null);
    if (pin.length >= PIN_MAX_LENGTH) return;
    const next = pin + d;
    setPin(next);

    // CR-15: progressive matching at every valid length (4–8) via the pure
    // pinEntryOutcome helper — a 4/5/6/…-digit PIN unlocks the moment it
    // matches; only a no-match at the MAXIMUM length is a definite failure.
    const outcome = pinEntryOutcome(
      next,
      (candidate) => unlockers.some((u) => verifyPin(u.pinHash, candidate)),
    );
    if (outcome.kind === 'matched') {
      setPin('');
      onSuccess();
    } else if (outcome.kind === 'definite-failure') {
      setError(t('pin.wrong'));
      setPin('');
    }
  };

  const clear = () => {
    setPin('');
    setError(null);
  };

  const dismiss = () => {
    setPin('');
    setError(null);
    onCancel();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Ionicons name="lock-closed" size={22} color={colors.primary} />
          <Text style={styles.title}>{t('pin.required', { action: t(GATE_KEYS[action]) })}</Text>
          <Text style={styles.hint}>
            {unlockers.length > 0
              ? t('pin.hint', { n: PIN_MIN_LENGTH })
              : t('pin.noPinSet')}
          </Text>

          {/* Dots */}
          <View style={styles.dots}>
            {Array.from({ length: PIN_MAX_LENGTH }).map((_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
            ))}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : <View style={styles.errorSpacer} />}

          {/* Keypad */}
          <View style={styles.keypad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((k, i) => (
              <Pressable
                key={i}
                style={[styles.key, k === '' && styles.keyDisabled]}
                disabled={k === ''}
                onPress={() => {
                  if (k === 'back') setPin(pin.slice(0, -1));
                  else if (k !== '') press(k);
                }}
              >
                {k === 'back' ? (
                  <Ionicons name="backspace-outline" size={20} color={colors.slate700} />
                ) : k === '' ? null : (
                  <Text style={styles.keyText}>{k}</Text>
                )}
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.cancelBtn} onPress={dismiss}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const KEY = 72;
const KEY_GAP = spacing.md;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  title: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900, textAlign: 'center' },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.slate200 },
  dotFilled: { backgroundColor: colors.primary },
  error: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger, minHeight: 16 },
  errorSpacer: { minHeight: 16 },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: KEY_GAP,
    width: KEY * 3 + KEY_GAP * 2,
  },
  key: {
    width: KEY,
    height: KEY,
    borderRadius: radius.control,
    backgroundColor: colors.slate100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDisabled: { backgroundColor: 'transparent' },
  keyText: { fontFamily: fonts.sansBold, fontSize: 24, color: colors.slate900 },
  cancelBtn: { alignSelf: 'stretch', height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
});
