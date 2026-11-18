/**
 * Global lock screen (issue #26 design §5) — the full-screen overlay shown
 * while the register is locked. Terminal by design: the ONLY way out is a
 * correct PIN (own PIN → resume, another user's PIN → transfer, Store PIN →
 * Owner). There is deliberately no cancel/close button — a bypass would
 * defeat the whole point of an unattended-device lock.
 *
 * Progressive matching (same CR-15 pattern as PinPrompt): the entry is
 * checked at every valid length against every active user's PIN plus the
 * Store PIN, so the unlock lands the moment the PIN is complete.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  pinEntryOutcome,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  verifyPin,
} from '../../lib/pin';
import { listActiveUsers } from '../../repositories/userRepository';
import { getStorePinHash } from '../../repositories/securityRepository';
import { attemptUnlock, type LockReason } from '../../hooks/useSecurity';
import { PinKeypad } from './PinKeypad';
import { useT } from '../../hooks/useT';
import { fonts, radius, spacing, typography, type Palette } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import type { AppUser } from '../../types';

interface Props {
  locked: boolean;
  lockReason: LockReason | null;
  /** Owner has set a Store PIN → the hint mentions it as an option. */
  storePinSet: boolean;
  /** Welcome-back flash after a successful unlock (then unmounts). */
  onUnlocked: (name: string) => void;
}

export function LockScreen({ locked, lockReason, storePinSet, onUnlocked }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [storePinHash, setStorePinHash] = useState<string | null>(null);

  // (Re)load the match targets whenever the screen comes up.
  useEffect(() => {
    if (!locked) {
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
  }, [locked]);

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
      void (async () => {
        setBusy(true);
        try {
          const res = await attemptUnlock(next);
          if (res) {
            setPin('');
            onUnlocked(res.kind === 'switch' ? res.to.name : res.user.name);
          } else {
            setError(t('pin.wrong'));
            setPin('');
          }
        } finally {
          setBusy(false);
        }
      })();
    } else if (outcome.kind === 'definite-failure') {
      setError(t('pin.wrong'));
      setPin('');
    }
  };

  if (!locked) return null;

  return (
    <Pressable style={styles.backdrop} onPress={() => {}}>
      <View style={styles.card}>
        <Ionicons name="lock-closed" size={30} color={colors.primary} />
        <Text style={styles.title}>{t('lock.title')}</Text>
        <Text style={styles.reason}>
          {lockReason === 'idle' ? t('lock.reasonIdle') : t('lock.reasonManual')}
        </Text>
        <Text style={styles.hint}>
          {storePinSet ? t('lock.hintStore') : t('lock.hint', { n: PIN_MIN_LENGTH })}
        </Text>

        <PinKeypad pin={pin} onDigit={press} onBackspace={() => !busy && setPin(pin.slice(0, -1))} busy={busy} />

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.errorSpacer} />
        )}
        {busy && <ActivityIndicator size="small" color={colors.primary} />}
      </View>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: 'rgba(15,23,42,0.92)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: colors.white,
      borderRadius: radius.card,
      padding: spacing.xl,
      alignItems: 'center',
      gap: spacing.md,
    },
    title: { fontFamily: fonts.sansBold, fontSize: typography.heading + 2, color: colors.slate900, textAlign: 'center' },
    reason: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, textAlign: 'center' },
    hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, textAlign: 'center' },
    error: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger, minHeight: 16 },
    errorSpacer: { minHeight: 16 },
  });
}
