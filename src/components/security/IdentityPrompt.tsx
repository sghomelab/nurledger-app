/**
 * Identity prompt (issue #26 design §5) — the modal proof-of-identity for
 * EXPLICIT actions: switching the active user from the Shift tab, and opening
 * a shift. Any PIN counts (own → no-op, another user's → transfer, Store PIN
 * → Owner); the caller runs authenticateRegister(pin, 'switch') with the
 * entered PIN and decides from the resolution.
 *
 * Unlike LockScreen it is dismissible (the action is optional), so it has a
 * Cancel button and a backdrop-tap dismiss.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  pinEntryOutcome,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  verifyPin,
} from '../../lib/pin';
import { listActiveUsers } from '../../repositories/userRepository';
import { getStorePinHash } from '../../repositories/securityRepository';
import { PinKeypad } from './PinKeypad';
import { useT } from '../../hooks/useT';
import { fonts, radius, spacing, typography, type Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import type { AppUser } from '../../types';

interface Props {
  visible: boolean;
  /** What this proof is for (header copy). */
  title: string;
  /** Optional one-line sub-copy (e.g. the target user's name). */
  subtitle?: string | null;
  /** The matched PIN (the caller resolves + acts; null never happens here). */
  onSuccess: (pin: string) => void;
  onCancel: () => void;
}

export function IdentityPrompt({ visible, title, subtitle, onSuccess, onCancel }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [storePinHash, setStorePinHash] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setPin('');
      setError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [u, h] = await Promise.all([listActiveUsers(), getStorePinHash()]);
      if (!cancelled) {
        setUsers(u);
        setStorePinHash(h);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const ready = users !== null;

  const press = (d: string) => {
    if (busy || !ready) return;
    setError(null);
    if (pin.length >= PIN_MAX_LENGTH) return;
    const next = pin + d;
    setPin(next);
    const matches = (candidate: string) =>
      users!.some((u) => verifyPin(u.pinHash, candidate)) ||
      (storePinHash !== null && verifyPin(storePinHash, candidate));
    const outcome = pinEntryOutcome(next, matches);
    if (outcome.kind === 'matched') {
      const done = next;
      setPin('');
      setBusy(true);
      // The caller's action is async; release the busy state via a microtask
      // after onSuccess (the caller closes the modal, which resets state).
      Promise.resolve().then(() => setBusy(false));
      onSuccess(done);
    } else if (outcome.kind === 'definite-failure') {
      setError(t('pin.wrong'));
      setPin('');
    }
  };

  const dismiss = () => {
    if (busy) return;
    setPin('');
    setError(null);
    onCancel();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Ionicons name="person-outline" size={22} color={colors.primary} />
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <Text style={styles.hint}>{t('lock.hint', { n: PIN_MIN_LENGTH })}</Text>

          <PinKeypad pin={pin} onDigit={press} onBackspace={() => !busy && setPin(pin.slice(0, -1))} busy={busy} />

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <View style={styles.errorSpacer} />
          )}
          {busy && <ActivityIndicator size="small" color={colors.primary} />}

          <Pressable style={styles.cancelBtn} onPress={dismiss} disabled={busy}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
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
    subtitle: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, textAlign: 'center' },
    hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, textAlign: 'center' },
    error: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger, minHeight: 16 },
    errorSpacer: { minHeight: 16 },
    cancelBtn: { alignSelf: 'stretch', height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
    cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  });
}
