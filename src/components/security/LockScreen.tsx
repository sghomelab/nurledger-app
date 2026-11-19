/**
 * Global lock screen (issue #26 design §5) — the full-screen overlay shown
 * while the register is locked. Terminal by design: the ONLY way out is a
 * correct PIN (own PIN → resume, another user's PIN → transfer, Store PIN →
 * Owner) — or the one-time recovery code when the Store PIN itself is
 * forgotten (design §3). There is deliberately no cancel/close button and
 * the Android back key is swallowed — a bypass would defeat the whole point
 * of an unattended-device lock.
 *
 * Rendered as a native <Modal> (transparent): RN <Modal>s live in their own
 * native window ABOVE the root view tree, so the lock screen covers even an
 * already-open in-app <Modal> (payment prompt, scanner, …) when the idle
 * auto-lock fires. An absolute <View> cannot.
 *
 * Progressive matching (same CR-15 pattern as PinPrompt): the entry is
 * checked at every valid length against every active user's PIN plus the
 * Store PIN, so the unlock lands the moment the PIN is complete.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  extendsStoredPin,
  isValidPin,
  pinEntryOutcome,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  verifyPin,
} from '../../lib/pin';
import { listActiveUsers } from '../../repositories/userRepository';
import { consumeRecoveryCode, getStorePinHash, setStorePin } from '../../repositories/securityRepository';
import { attemptUnlock, reloadSecurity, type LockReason } from '../../hooks/useSecurity';
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

type RecoverStep = 'code' | 'pin' | 'shown';

export function LockScreen({ locked, lockReason, storePinSet, onUnlocked }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [storePinHash, setStorePinHash] = useState<string | null>(null);

  // Design §3 recovery (Store PIN forgotten): code → new PIN → new code.
  const [recoverStep, setRecoverStep] = useState<RecoverStep | null>(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPin1, setNewPin1] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

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

  const owner = users?.find((u) => u.role === 'owner') ?? null;
  const ready = users !== null;

  const press = (d: string) => {
    if (busy || !ready || recoverStep !== null) return;
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

  const startRecovery = () => {
    if (!owner) return;
    setError(null);
    setRecoveryCode('');
    setNewPin1('');
    setNewPin2('');
    setIssuedCode(null);
    setRecoverStep('code');
  };

  const cancelRecovery = () => {
    setRecoverStep(null);
    setIssuedCode(null);
    setError(null);
  };

  /** code → pin step: consume the one-time code (single use, audit-logged). */
  const submitRecoveryCode = async () => {
    if (!owner) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await consumeRecoveryCode(recoveryCode, owner.id);
      if (!ok) {
        setError(t('sec.recoveryInvalid'));
        setRecoveryCode('');
        return;
      }
      setRecoverStep('pin');
    } finally {
      setBusy(false);
    }
  };

  /** pin step → shown: set the new Store PIN (issues a fresh one-time code). */
  const submitNewPin = async () => {
    if (!owner) return;
    setError(null);
    if (!isValidPin(newPin1)) {
      setError(t('sec.pinInvalid'));
      return;
    }
    if (newPin1 !== newPin2) {
      setError(t('sec.pinMismatch'));
      return;
    }
    if (users?.some((u) => extendsStoredPin(newPin1, u.pinHash))) {
      setError(t('sec.pinPrefix'));
      return;
    }
    setBusy(true);
    try {
      const { recoveryCode: code } = await setStorePin(newPin1, owner.id);
      setIssuedCode(code);
      setRecoverStep('shown');
      void reloadSecurity();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Done with the shown code → unlock as the Owner via the NEW Store PIN. */
  const finishRecovery = async () => {
    setBusy(true);
    try {
      const res = await attemptUnlock(newPin1);
      if (res) {
        onUnlocked(res.kind === 'switch' ? res.to.name : res.user.name);
        cancelRecovery();
      }
    } finally {
      setBusy(false);
    }
  };

  const recovering = recoverStep !== null;

  return (
    <Modal visible={locked} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Ionicons name="lock-closed" size={30} color={colors.primary} />
          <Text style={styles.title}>{t('lock.title')}</Text>
          <Text style={styles.reason}>
            {lockReason === 'idle' ? t('lock.reasonIdle') : t('lock.reasonManual')}
          </Text>

          {!recovering ? (
            <>
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

              {/* Design §3: the last resort when the Store PIN is forgotten. */}
              {storePinSet && owner && (
                <Pressable onPress={startRecovery} hitSlop={8} disabled={busy || !ready}>
                  <Text style={styles.forgot}>{t('lock.forgot')}</Text>
                </Pressable>
              )}
            </>
          ) : recoverStep === 'code' ? (
            <>
              <Text style={styles.stepTitle}>{t('sec.recoveryCodeLabel')}</Text>
              <TextInput
                style={styles.recoveryInput}
                value={recoveryCode}
                onChangeText={setRecoveryCode}
                keyboardType="number-pad"
                maxLength={14}
                placeholder="0000-0000-0000"
                placeholderTextColor={colors.slate400}
                editable={!busy}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.recoveryBtns}>
                <Pressable style={styles.linkBtn} onPress={cancelRecovery} hitSlop={8} disabled={busy}>
                  <Text style={styles.linkText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable style={styles.primaryBtn} onPress={() => void submitRecoveryCode()} disabled={busy || recoveryCode.trim().length < 12}>
                  <Text style={styles.primaryBtnText}>{t('common.next')}</Text>
                </Pressable>
              </View>
              {busy && <ActivityIndicator size="small" color={colors.primary} />}
            </>
          ) : recoverStep === 'pin' ? (
            <>
              <Text style={styles.stepTitle}>{t('sec.newPin')}</Text>
              <TextInput
                style={styles.recoveryInput}
                value={newPin1}
                onChangeText={setNewPin1}
                keyboardType="number-pad"
                maxLength={PIN_MAX_LENGTH}
                placeholder={t('sec.newPin')}
                placeholderTextColor={colors.slate400}
                editable={!busy}
              />
              <Text style={styles.stepTitle}>{t('sec.confirmPin')}</Text>
              <TextInput
                style={styles.recoveryInput}
                value={newPin2}
                onChangeText={setNewPin2}
                keyboardType="number-pad"
                maxLength={PIN_MAX_LENGTH}
                placeholder={t('sec.confirmPin')}
                placeholderTextColor={colors.slate400}
                editable={!busy}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.recoveryBtns}>
                <Pressable style={styles.linkBtn} onPress={cancelRecovery} hitSlop={8} disabled={busy}>
                  <Text style={styles.linkText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => void submitNewPin()}
                  disabled={busy || !isValidPin(newPin1) || newPin1 !== newPin2}
                >
                  <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
                </Pressable>
              </View>
              {busy && <ActivityIndicator size="small" color={colors.primary} />}
            </>
          ) : (
            /* shown — the fresh one-time code, exactly once */
            <>
              <Text style={styles.stepTitle}>{t('sec.recoveryTitle')}</Text>
              <Text style={styles.issuedCode}>{issuedCode}</Text>
              <Text style={styles.recoveryBody}>{t('sec.recoveryBody')}</Text>
              <Pressable
                style={styles.copyBtn}
                hitSlop={8}
                onPress={() => {
                  if (issuedCode) void Clipboard.setStringAsync(issuedCode);
                }}
              >
                <Ionicons name="copy-outline" size={16} color={colors.slate700} />
                <Text style={styles.copyBtnText}>{t('sec.copy')}</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={() => void finishRecovery()} disabled={busy}>
                <Text style={styles.primaryBtnText}>{t('common.done')}</Text>
              </Pressable>
              {busy && <ActivityIndicator size="small" color={colors.primary} />}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.92)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
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
    error: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger, textAlign: 'center' },
    errorSpacer: { minHeight: 16 },
    forgot: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.primary, textDecorationLine: 'underline', marginTop: spacing.xs },
    stepTitle: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700, alignSelf: 'flex-start' },
    recoveryInput: {
      width: '100%',
      borderWidth: 1.5,
      borderColor: colors.primary,
      borderRadius: radius.control,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontFamily: fonts.mono,
      fontSize: typography.body,
      color: colors.slate900,
      textAlign: 'center',
    },
    recoveryBtns: { flexDirection: 'row', alignSelf: 'stretch', gap: spacing.md },
    linkBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300 },
    linkText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
    primaryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, borderRadius: radius.control, backgroundColor: colors.primary, opacity: 1 },
    primaryBtnText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
    issuedCode: { fontFamily: fonts.mono, fontSize: typography.heading, color: colors.slate900, textAlign: 'center' },
    recoveryBody: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate500, textAlign: 'center' },
    copyBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    copyBtnText: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700 },
  });
}
