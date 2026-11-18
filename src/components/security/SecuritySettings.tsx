/**
 * Security settings — owner-only section of Settings (issue #26 design §2/§3/§5).
 *
 * Everything here is gated by the OWNER being the active user (the section is
 * only rendered for them, by the caller). It owns:
 *   - the register auto-lock timeout (device-local, uiSettingsRepository)
 *   - the Store PIN (set / change) + the ONE-TIME recovery code display
 *     (Copy / Print / Email me — design §3). The code is shown exactly once;
 *     after Done it is gone (only its hash is stored).
 *   - cashier PIN reset (audit-logged `pin_reset`)
 *   - a manual audit-log integrity check (`runIntegrityCheck`, which also
 *     logs itself as an event)
 *
 * Store-PIN secrets live in the keystore via securityRepository — never in
 * SQLite.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import { Card } from '../Screen';
import { PickerOverlay } from '../PickerOverlay';
import { isValidPin } from '../../lib/pin';
import {
  appendSecurityEvent,
  hasStorePin,
  runIntegrityCheck,
  setStorePin,
  verifyStorePin,
} from '../../repositories/securityRepository';
import { setUserPin } from '../../repositories/userRepository';
import {
  AUTO_LOCK_CHOICES,
  getAutoLockMinutes,
  setAutoLockMinutes,
  type AutoLockMinutes,
} from '../../repositories/uiSettingsRepository';
import { useT } from '../../hooks/useT';
import { reloadSecurity } from '../../hooks/useSecurity';
import { useTheme } from '../../theme/ThemeContext';
import { fonts, radius, spacing, typography, type Palette } from '../../theme/tokens';
import type { AppUser } from '../../types';

interface Props {
  /** The active user — the Owner (the caller renders this only for owners). */
  owner: AppUser;
  /** All active users (the reset targets). */
  users: AppUser[];
  /** Refresh the shared users store after a PIN reset. */
  onUsersChanged: () => Promise<void>;
}

/** The Store PIN change flow (set when none exists, change when it does). */
interface PinFormState {
  current: string; // required only when a Store PIN already exists
  next: string;
  confirm: string;
}

export function SecuritySettings({ owner, users, onUsersChanged }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useT();
  const insets = useSafeAreaInsets();

  const [storePinSet, setStorePinSet] = useState(false);
  const [autoLock, setAutoLock] = useState<AutoLockMinutes>(5);
  const [autoLockPicker, setAutoLockPicker] = useState(false);
  const [pinForm, setPinForm] = useState<PinFormState | null>(null);
  const [pinFormErr, setPinFormErr] = useState<string | null>(null);
  const [pinFormBusy, setPinFormBusy] = useState(false);
  /** One-time recovery code (shown once, then gone). */
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);

  useEffect(() => {
    void hasStorePin().then(setStorePinSet);
    void getAutoLockMinutes().then(setAutoLock);
  }, []);

  const onAutoLockPick = (v: AutoLockMinutes) => {
    setAutoLock(v);
    setAutoLockPicker(false);
    void setAutoLockMinutes(v);
  };

  const autoLockLabel = (m: number) =>
    m === 0 ? t('settings.autoLockNever') : t('settings.autoLockMin', { n: m });

  // ── Store PIN set / change ──────────────────────────────────────────────

  const submitPinForm = async () => {
    if (!pinForm || pinFormBusy) return;
    if (!isValidPin(pinForm.next)) {
      setPinFormErr(t('sec.pinInvalid'));
      return;
    }
    if (pinForm.next !== pinForm.confirm) {
      setPinFormErr(t('sec.pinMismatch'));
      return;
    }
    if (storePinSet) {
      if (!pinForm.current || !(await verifyStorePin(pinForm.current))) {
        setPinFormErr(t('sec.wrongCurrent'));
        return;
      }
    }
    setPinFormBusy(true);
    try {
      const { recoveryCode: code } = await setStorePin(pinForm.next, owner.id);
      setPinForm(null);
      setPinFormErr(null);
      setStorePinSet(true);
      setRecoveryCode(code); // shown ONCE — after Done it is unrecoverable
      void reloadSecurity(); // re-arm the lock (a Store PIN now exists)
    } catch (e) {
      Alert.alert(t('settings.storePin'), e instanceof Error ? e.message : String(e));
    } finally {
      setPinFormBusy(false);
    }
  };

  const recoveryEmail = () => {
    if (!recoveryCode) return;
    void Linking.openURL(
      `mailto:?subject=${encodeURIComponent('NurLedger — Store PIN recovery code')}&body=${encodeURIComponent(recoveryCode)}`,
    );
  };

  const recoveryPrint = async () => {
    if (!recoveryCode) return;
    try {
      await Print.printAsync({
        html: `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 40px; }
          h1 { font-size: 16px; } .code { font-family: 'SF Mono', Menlo, monospace; font-size: 30px; letter-spacing: 6px; margin: 24px 0; }
          p { color: #475569; font-size: 12px; }
        </style></head><body>
          <h1>NurLedger — Store PIN recovery code</h1>
          <div class="code">${recoveryCode}</div>
          <p>One-time use. It resets the Store PIN on THIS device only.</p>
        </body></html>`,
      });
    } catch (e) {
      Alert.alert(t('sec.print'), e instanceof Error ? e.message : String(e));
    }
  };

  // ── Cashier PIN reset ───────────────────────────────────────────────────

  const submitReset = async () => {
    if (!resetTarget) return;
    if (!isValidPin(resetPin)) {
      setResetErr(t('sec.pinInvalid'));
      return;
    }
    try {
      await setUserPin(resetTarget.id, resetPin);
      await appendSecurityEvent({
        user_id: owner.id,
        event_type: 'pin_reset',
        method: 'store_pin',
        detail: resetTarget.name,
      });
      await onUsersChanged();
      void reloadSecurity(); // a user PIN may now exist → re-arm the lock
      setResetTarget(null);
      setResetPin('');
      setResetErr(null);
    } catch (e) {
      setResetErr(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Audit log integrity check ───────────────────────────────────────────

  const doVerifyAudit = async () => {
    if (auditBusy) return;
    setAuditBusy(true);
    try {
      const v = await runIntegrityCheck(owner.id);
      setAuditResult(
        v.ok
          ? { ok: true, text: t('sec.auditOk', { n: v.checked }) }
          : { ok: false, text: t('sec.auditFail', { n: v.firstBadSeq ?? -1 }) },
      );
    } finally {
      setAuditBusy(false);
    }
  };

  return (
    <>
      <Card>
        <Text style={styles.sectionTitle}>{t('settings.security')}</Text>

        <Row
          label={t('settings.autoLock')}
          note={t('settings.autoLockNote')}
          action={
            <Pressable style={styles.chip} onPress={() => setAutoLockPicker(true)}>
              <Text style={styles.chipText}>{autoLockLabel(autoLock)}</Text>
              <Text style={styles.chevron}>⌄</Text>
            </Pressable>
          }
        />

        <Row
          label={t('settings.storePin')}
          note={t('settings.storePinDesc')}
          action={
            <Pressable
              style={styles.textBtn}
              onPress={() => {
                setPinFormErr(null);
                setPinForm({ current: '', next: '', confirm: '' });
              }}
            >
              <Text style={styles.textBtnText}>
                {storePinSet ? t('settings.storePinChange') : t('settings.storePinSet')}
              </Text>
            </Pressable>
          }
        />

        <Row
          label={t('sec.resetCashierPin')}
          note={t('sec.resetCashierPinDesc')}
          action={
            <Pressable
              style={styles.textBtn}
              onPress={() => {
                setResetErr(null);
                setResetPin('');
                setResetTarget(users[0] ?? null);
              }}
            >
              <Text style={styles.textBtnText}>{t('sec.reset')}</Text>
            </Pressable>
          }
        />

        <Row
          label={t('sec.verifyAudit')}
          note={t('sec.verifyAuditDesc')}
          action={
            <Pressable style={styles.textBtn} onPress={() => void doVerifyAudit()} disabled={auditBusy}>
              <Text style={styles.textBtnText}>{auditBusy ? '…' : t('sec.verify')}</Text>
            </Pressable>
          }
        />
        {auditResult ? (
          <Text style={[styles.auditResult, auditResult.ok && { color: colors.positive }]}>{auditResult.text}</Text>
        ) : null}
      </Card>

      {/* Auto-lock timeout picker */}
      {autoLockPicker && (
        <PickerOverlay
          title={t('settings.autoLock')}
          rows={AUTO_LOCK_CHOICES.map((m) => ({
            key: String(m),
            label: autoLockLabel(m),
            sublabel: m === autoLock ? '●' : '',
            onPress: () => onAutoLockPick(m),
          }))}
          onClose={() => setAutoLockPicker(false)}
        />
      )}

      {/* Store PIN set / change */}
      <Modal visible={pinForm !== null} animationType="slide" onRequestClose={() => setPinForm(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheetBody, { paddingBottom: spacing.xl + insets.bottom }]}>
            <Text style={styles.sheetTitle}>
              {storePinSet ? t('settings.storePinChange') : t('settings.storePinSet')}
            </Text>
            {storePinSet ? (
              <PinField label={t('sec.currentPin')} value={pinForm?.current ?? ''} onChange={(v) => setPinForm((f) => (f ? { ...f, current: v } : f))} />
            ) : null}
            <PinField label={t('sec.newPin')} value={pinForm?.next ?? ''} onChange={(v) => setPinForm((f) => (f ? { ...f, next: v } : f))} />
            <PinField label={t('sec.confirmPin')} value={pinForm?.confirm ?? ''} onChange={(v) => setPinForm((f) => (f ? { ...f, confirm: v } : f))} />
            {pinFormErr ? <Text style={styles.errText}>{pinFormErr}</Text> : null}
            <View style={styles.sheetActions}>
              <Pressable style={styles.sheetBtn} onPress={() => setPinForm(null)}>
                <Text style={styles.sheetBtnText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.sheetBtn, styles.sheetBtnPrimary, pinFormBusy && { opacity: 0.6 }]}
                onPress={() => void submitPinForm()}
                disabled={pinFormBusy}
              >
                <Text style={[styles.sheetBtnText, styles.sheetBtnTextPrimary]}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* One-time recovery code (design §3) — shown exactly once */}
      <Modal
        visible={recoveryCode !== null}
        animationType="fade"
        onRequestClose={() => setRecoveryCode(null)}
      >
        <View style={styles.sheetBackdrop}>
          {/* maxHeight + ScrollView: on short screens the code block can
              overflow a bottom sheet — keep every action (incl. Done)
              reachable no matter the device height. */}
          <View style={[styles.sheetBody, { maxHeight: '90%', padding: 0 }]}>
            <ScrollView
              contentContainerStyle={{ padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xl + insets.bottom }}
              keyboardShouldPersistTaps="handled"
            >
              <Ionicons name="key-outline" size={26} color={colors.primary} />
              <Text style={styles.sheetTitle}>{t('sec.recoveryTitle')}</Text>
              <Text style={styles.recoveryCode}>{recoveryCode}</Text>
              <Text style={styles.recoveryBody}>{t('sec.recoveryBody')}</Text>
              <View style={styles.recoveryActions}>
                <Pressable
                  style={styles.recoveryBtn}
                  onPress={() => {
                    if (recoveryCode) void Clipboard.setStringAsync(recoveryCode);
                    Alert.alert('', t('sec.copied'));
                  }}
                >
                  <Ionicons name="copy-outline" size={16} color={colors.slate700} />
                  <Text style={styles.recoveryBtnText}>{t('sec.copy')}</Text>
                </Pressable>
                <Pressable style={styles.recoveryBtn} onPress={() => void recoveryPrint()}>
                  <Ionicons name="print-outline" size={16} color={colors.slate700} />
                  <Text style={styles.recoveryBtnText}>{t('sec.print')}</Text>
                </Pressable>
                <Pressable style={styles.recoveryBtn} onPress={recoveryEmail}>
                  <Ionicons name="mail-outline" size={16} color={colors.slate700} />
                  <Text style={styles.recoveryBtnText}>{t('sec.email')}</Text>
                </Pressable>
              </View>
              <Pressable style={[styles.sheetBtn, styles.sheetBtnPrimary]} onPress={() => setRecoveryCode(null)}>
                <Text style={[styles.sheetBtnText, styles.sheetBtnTextPrimary]}>{t('common.done')}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Cashier PIN reset — pick the target (chips), enter the new PIN */}
      <Modal visible={resetTarget !== null} animationType="slide" onRequestClose={() => setResetTarget(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheetBody, { paddingBottom: spacing.xl + insets.bottom }]}>
            <Text style={styles.sheetTitle}>{t('sec.resetCashierPin')}</Text>
            {users.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {users.map((u) => (
                  <Pressable
                    key={u.id}
                    style={[styles.targetChip, u.id === resetTarget?.id && styles.targetChipActive]}
                    onPress={() => {
                      setResetTarget(u);
                      setResetPin('');
                      setResetErr(null);
                    }}
                  >
                    <Text style={[styles.targetChipText, u.id === resetTarget?.id && styles.targetChipTextActive]}>
                      {u.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <PinField label={t('sec.newPin')} value={resetPin} onChange={(v) => { setResetPin(v); setResetErr(null); }} />
            {resetErr ? <Text style={styles.errText}>{resetErr}</Text> : null}
            <View style={styles.sheetActions}>
              <Pressable style={styles.sheetBtn} onPress={() => setResetTarget(null)}>
                <Text style={styles.sheetBtnText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={[styles.sheetBtn, styles.sheetBtnPrimary]} onPress={() => void submitReset()}>
                <Text style={[styles.sheetBtnText, styles.sheetBtnTextPrimary]}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Row({ label, note, action }: { label: string; note?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate900 }}>{label}</Text>
        {note ? <Text style={{ fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate500, marginTop: 2 }}>{note}</Text> : null}
      </View>
      {action}
    </View>
  );
}

function PinField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700, marginBottom: 4 }}>{label}</Text>
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: colors.slate300,
          borderRadius: radius.control,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontFamily: fonts.mono,
          fontSize: 16,
          color: colors.slate900,
          letterSpacing: 4,
        }}
        value={value}
        onChangeText={onChange}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={8}
        placeholder="••••"
        placeholderTextColor={colors.slate400}
      />
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    sectionTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900, marginBottom: spacing.sm },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.slate100, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 84, justifyContent: 'center' },
    chipText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate900 },
    chevron: { fontFamily: fonts.sans, fontSize: 14, color: colors.slate400 },
    textBtn: { backgroundColor: colors.slate100, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 8 },
    textBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.primary },
    auditResult: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger, paddingVertical: spacing.xs },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
    sheetBody: { backgroundColor: colors.white, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: spacing.xl, gap: spacing.md },
    sheetTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900, textAlign: 'center' },
    errText: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.danger },
    sheetActions: { flexDirection: 'row', gap: spacing.sm },
    sheetBtn: { flex: 1, height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
    sheetBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
    sheetBtnText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
    sheetBtnTextPrimary: { color: colors.white },
    recoveryCode: { fontFamily: fonts.monoSemiBold, fontSize: 26, letterSpacing: 3, color: colors.slate900, textAlign: 'center', backgroundColor: colors.slate100, borderRadius: radius.control, paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
    recoveryBody: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, textAlign: 'center' },
    recoveryActions: { flexDirection: 'row', gap: spacing.sm },
    recoveryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.slate300, borderRadius: radius.control, paddingVertical: 10 },
    recoveryBtnText: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700 },
    targetChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white },
    targetChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    targetChipText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate700 },
    targetChipTextActive: { color: colors.white },
  });
}
