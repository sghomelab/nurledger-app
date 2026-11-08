import { useT } from '../../src/hooks/useT';
import type { MsgKey } from '../../src/i18n';
import { wideColumn } from '../../src/lib/layout';
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../src/components/Screen';
import { NumberText } from '../../src/components/NumberText';
import { PickerOverlay } from '../../src/components/PickerOverlay';
import { MoneyPrompt } from '../../src/components/register/MoneyPrompt';
import { PinPrompt } from '../../src/components/PinPrompt';
import { ReportView } from '../../src/components/report/ReportView';
import { CashMovePrompt, CountedCashPrompt } from '../../src/components/shift/ShiftPrompts';
import { useOutlet } from '../../src/hooks/useAppData';
import { useShift, useUsers } from '../../src/hooks/useShift';
import { getDeviceId, type Shift } from '../../src/repositories/shiftRepository';
import { taxEngineLabel } from '../../src/lib/currency';
import { formatMoney } from '../../src/lib/money';
import { addUserRankNeeded, changePinRankNeeded, roleCanAct, switchRankNeeded, type GateAction } from '../../src/lib/roles';
import { isValidPin } from '../../src/lib/pin';
import type { AppUser } from '../../src/types';
import type { XReport, ZReport } from '../../src/lib/shift';
import type { UserRole } from '../../src/types';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function timeStr(ms: number): string {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ROLE_KEY: Record<UserRole, MsgKey> = {
  owner: 'shift.roleOwner',
  manager: 'shift.roleManager',
  cashier: 'shift.roleCashier',
};

/**
 * Tab 5 — Cash Drawer / Shift (M4: FR-200…FR-204, FR-500).
 *
 * - User card: who is at the register (switcher + add user; FR-500 roles).
 * - No open shift: register-locked state with the open-shift (float) action.
 * - Open shift: live drawer (float + cash sales + in/out → expected), cash
 *   in/out with reasons (FR-201), X-report anytime (FR-203), close flow with
 *   counted cash → variance + Z-report (FR-202). All offline (FR-204).
 * - History: closed shifts → detail (app/shift/[id]) with the stored Z-report.
 *
 * Closing is PIN-gated for cashiers (owner/manager close directly) — the
 * "owner's PIN protects the rest" rule (FR-500 / DEV-003).
 */
export default function ShiftTab() {
  const { t } = useT();
  const router = useRouter();
  const { outlet } = useOutlet();
  const { users, active, switchUser, addUser, changePin } = useUsers();
  const { open, snapshot, history, openShift, addCashMove, closeShift, xReport } = useShift();

  const [userSheet, setUserSheet] = useState(false);
  const [addUserVisible, setAddUserVisible] = useState(false);
  const [openFloatVisible, setOpenFloatVisible] = useState(false);
  const [cashMove, setCashMove] = useState<{ type: 'in' | 'out' } | null>(null);
  const [closeVisible, setCloseVisible] = useState(false);
  const [gate, setGate] = useState<GateAction | null>(null);
  // Re-authentication gate for user management (switch up / add privileged / change PIN).
  const [userGate, setUserGate] = useState<{ action: GateAction; minRank: number; run: () => void } | null>(null);
  const [pinPicker, setPinPicker] = useState(false);
  const [pinTarget, setPinTarget] = useState<AppUser | null>(null);
  const [report, setReport] = useState<ZReport | XReport | null>(null);
  const [newUser, setNewUser] = useState({ name: '', role: 'cashier' as UserRole, pin: '' });

  const currency = outlet?.currency ?? 'SGD';

  const doOpenShift = useCallback(
    async (floatMinor: number) => {
      if (!outlet) return;
      try {
        await openShift({
          outletId: outlet.id,
          deviceId: await getDeviceId(),
          cashierId: active?.id ?? null,
          floatMinor,
        });
        setOpenFloatVisible(false);
      } catch (e) {
        Alert.alert(t('sell.couldNotOpenShift'), errMsg(e));
      }
    },
    [openShift, outlet, active],
  );

  const doCashMove = useCallback(
    async (amountMinor: number, reason: string) => {
      if (!open || !cashMove) return;
      try {
        await addCashMove(open.id, cashMove.type, amountMinor, reason);
        setCashMove(null);
      } catch (e) {
        Alert.alert(t('shift.cashMovementFailed'), errMsg(e));
      }
    },
    [open, cashMove, addCashMove],
  );

  /** Close is gated for cashiers (FR-500): owner/manager go straight to the count. */
  const requestClose = useCallback(() => {
    if (active && roleCanAct(active.role, 'close_shift')) {
      setCloseVisible(true);
      return;
    }
    setGate('close_shift');
  }, [active]);

  const onGateSuccess = useCallback(() => {
    setGate(null);
    setCloseVisible(true);
  }, []);

  const doClose = useCallback(
    async (countedMinor: number, notes: string | null) => {
      if (!open) return;
      try {
        const closed = await closeShift(open.id, countedMinor, notes);
        setCloseVisible(false);
        if (closed.zReport) setReport(closed.zReport);
      } catch (e) {
        Alert.alert(t('shift.closeFailed'), errMsg(e));
      }
    },
    [open, closeShift],
  );

  const doXReport = useCallback(async () => {
    const r = await xReport();
    if (r) setReport(r);
  }, [xReport]);

  const doSwitchUser = useCallback(
    async (id: string) => {
      const target = (users ?? []).find((u) => u.id === id);
      if (!target) return;
      const perform = async () => {
        try {
          await switchUser(id);
          setUserSheet(false);
        } catch (e) {
          Alert.alert(t('shift.switchFailed'), errMsg(e));
        }
      };
      // Switching UP (e.g. cashier -> owner) needs that role's PIN, or any
      // cashier could become the owner and bypass every PIN gate.
      const need = switchRankNeeded(active, target);
      if (need > 0) {
        setUserSheet(false);
        setUserGate({ action: 'switch_user', minRank: need, run: () => void perform() });
        return;
      }
      await perform();
    },
    [switchUser, users, active, t],
  );

  const doAddUser = useCallback(async () => {
    const pin = newUser.pin;
    if (newUser.role !== 'cashier' && !isValidPin(pin)) {
      Alert.alert(t('shift.addUserFailed'), t('shift.pinRequiredForRole'));
      return;
    }
    const perform = async () => {
      try {
        await addUser(newUser.name, newUser.role, pin || null);
        setNewUser({ name: '', role: 'cashier', pin: '' });
        setAddUserVisible(false);
      } catch (e) {
        Alert.alert(t('shift.addUserFailed'), errMsg(e));
      }
    };
    const need = addUserRankNeeded(active, newUser.role);
    if (need > 0) {
      setUserGate({ action: 'add_user', minRank: need, run: () => void perform() });
      return;
    }
    await perform();
  }, [newUser, addUser, active, t]);

  const startChangePin = useCallback((target: AppUser) => {
    setPinPicker(false);
    setUserGate({ action: 'change_pin', minRank: changePinRankNeeded(target), run: () => setPinTarget(target) });
  }, []);

  const doChangePin = useCallback(
    async (pin: string) => {
      if (!pinTarget) return;
      try {
        await changePin(pinTarget.id, pin);
        setPinTarget(null);
        Alert.alert(t('shift.pinChanged'));
      } catch (e) {
        Alert.alert(t('shift.changePinFailed'), errMsg(e));
      }
    },
    [pinTarget, changePin, t],
  );

  return (
    <ScrollView contentContainerStyle={[styles.content, wideColumn]}>
      {/* User at the register (FR-500) */}
      <Card style={styles.userCard}>
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(active?.name ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.userTexts}>
            <Text style={styles.userName}>{active?.name ?? t('shift.noUser')}</Text>
            <Text style={styles.userRole}>{active ? t('shift.atRegister', { role: t(ROLE_KEY[active.role]) }) : '—'}</Text>
          </View>
          <Pressable style={styles.switchBtn} onPress={() => setUserSheet(true)} hitSlop={8}>
            <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
            <Text style={styles.switchBtnText}>{t('shift.switch')}</Text>
          </Pressable>
        </View>
        <Pressable style={styles.addUserBtn} onPress={() => setAddUserVisible(true)}>
          <Ionicons name="person-add-outline" size={14} color={colors.slate500} />
          <Text style={styles.addUserText}>{t('shift.addUser')}</Text>
        </Pressable>
      </Card>

      {/* Shift state */}
      {open ? (
        <>
          <Card style={styles.shiftCard}>
            <View style={styles.shiftHead}>
              <View style={styles.openBadge}>
                <View style={styles.openDot} />
                <Text style={styles.openBadgeText}>{t('shift.shiftOpen')}</Text>
              </View>
              <Text style={styles.shiftMeta}>
                {open.cashierName ?? '—'} · {timeStr(open.openedAt)}
              </Text>
            </View>

            {snapshot && (
              <View style={styles.drawerRows}>
                <DrawerRow label={t('shift.openingFloat')} value={formatMoney(snapshot.totals.floatMinor, currency)} />
                <DrawerRow label={t('shift.cashSalesThisShift')} value={formatMoney(snapshot.totals.cashSaleMinor, currency)} />
                <DrawerRow label={t('shift.cashIn')} value={formatMoney(snapshot.totals.cashInMinor, currency)} />
                <DrawerRow label={t('shift.cashOut')} value={formatMoney(snapshot.totals.cashOutMinor, currency)} />
                <View style={styles.drawerDivider} />
                <DrawerRow label={t('shift.expectedInDrawer')} value={formatMoney(snapshot.expectedCashMinor, currency)} strong />
              </View>
            )}

            <View style={styles.actionGrid}>
              <ActionTile icon="arrow-down-circle" label={t('shift.cashIn')} onPress={() => setCashMove({ type: 'in' })} tone="pos" />
              <ActionTile icon="arrow-up-circle" label={t('shift.cashOut')} onPress={() => setCashMove({ type: 'out' })} tone="warn" />
              <ActionTile icon="pulse" label={t('shift.xReport')} onPress={() => void doXReport()} tone="neutral" />
              <ActionTile icon="lock-closed" label={t('gate.close_shift')} onPress={requestClose} tone="danger" />
            </View>
          </Card>

          {/* Cash movements (FR-201) */}
          {snapshot && snapshot.moves.length > 0 && (
            <Card style={styles.movesCard}>
              <Text style={styles.sectionTitle}>{t('shift.cashMovements')}</Text>
              {snapshot.moves.map((m) => (
                <View key={m.id} style={styles.moveRow}>
                  <Ionicons
                    name={m.type === 'in' ? 'add-circle' : 'remove-circle'}
                    size={16}
                    color={m.type === 'in' ? colors.positive : colors.danger}
                  />
                  <Text style={styles.moveReason}>{m.reason}</Text>
                  <NumberText style={styles.moveAmount}>
                    {m.type === 'in' ? '+' : '−'}
                    {formatMoney(m.amountMinor, currency)}
                  </NumberText>
                </View>
              ))}
            </Card>
          )}
        </>
      ) : (
        <Card style={styles.lockedCard}>
          <Ionicons name="lock-closed" size={30} color={colors.warning} />
          <Text style={styles.lockedTitle}>{t('sell.registerLocked')}</Text>
          <Text style={styles.lockedText}>
            {t('shift.lockedBody')}
          </Text>
          <Pressable style={styles.openShiftBtn} onPress={() => setOpenFloatVisible(true)}>
            <Text style={styles.openShiftText}>{t('sell.openShift')}</Text>
          </Pressable>
        </Card>
      )}

      {/* Closed shift history */}
      <Card style={styles.historyCard}>
        <Text style={styles.sectionTitle}>{t('shift.closedShifts')}</Text>
        {!history || history.length === 0 ? (
          <Text style={styles.empty}>{t('shift.noClosedShiftsYet')}</Text>
        ) : (
          history.map((s) => <HistoryRow key={s.id} shift={s} currency={currency} onOpen={() => router.push(`/shift/${s.id}`)} />)
        )}
      </Card>

      {/* Store identity (FR-600/FR-602) */}
      <Card style={styles.storeCard}>
        <View style={styles.storeRow}>
          <View style={styles.storeIcon}>
            <Ionicons name="storefront" size={22} color={colors.white} />
          </View>
          <View style={styles.storeTexts}>
            <Text style={styles.storeName}>{outlet?.name ?? 'Store'}</Text>
            <Text style={styles.storeMeta}>
              {outlet ? `${outlet.currency} · ${taxEngineLabel(outlet.taxEngine)}` : 'Loading…'}
            </Text>
          </View>
          <Pressable style={styles.changeBtn} onPress={() => router.push('/settings')} hitSlop={8}>
            <Text style={styles.changeBtnText}>{t('shift.change')}</Text>
          </Pressable>
        </View>
      </Card>

      {/* Overlays */}
      {userSheet && (
        <PickerOverlay
          title={t('shift.whoIsAtTheRegister')}
          rows={[
            ...(users ?? []).map((u) => ({
              key: u.id,
              label: u.name,
              sublabel: `${t(ROLE_KEY[u.role])}${u.id === active?.id ? t('shift.active') : ''}`,
              onPress: () => void doSwitchUser(u.id),
            })),
            { key: '__add', label: '+ Add user', sublabel: '', onPress: () => { setUserSheet(false); setAddUserVisible(true); } },
            { key: '__pin', label: t('shift.changePin'), sublabel: '', onPress: () => { setUserSheet(false); setPinPicker(true); } },
          ]}
          onClose={() => setUserSheet(false)}
        />
      )}

      {pinPicker && (
        <PickerOverlay
          title={t('shift.changePinWho')}
          rows={(users ?? []).map((u) => ({
            key: u.id,
            label: u.name,
            sublabel: t(ROLE_KEY[u.role]),
            onPress: () => startChangePin(u),
          }))}
          onClose={() => setPinPicker(false)}
        />
      )}

      {pinTarget && <SetPinSheet name={pinTarget.name} onSave={(p) => void doChangePin(p)} onCancel={() => setPinTarget(null)} />}

      {userGate && (
        <PinPrompt
          visible
          action={userGate.action}
          users={users ?? []}
          minRank={userGate.minRank}
          onSuccess={() => {
            const run = userGate.run;
            setUserGate(null);
            run();
          }}
          onCancel={() => setUserGate(null)}
        />
      )}

      {addUserVisible && (
        <AddUserSheet
          state={newUser}
          setState={setNewUser}
          onSave={() => void doAddUser()}
          onCancel={() => setAddUserVisible(false)}
        />
      )}

      {openFloatVisible && outlet && (
        <MoneyPrompt
          title={t('sell.openShiftFloat')}
          currency={currency}
          initialMinor={0}
          onSave={(m) => void doOpenShift(m)}
          onCancel={() => setOpenFloatVisible(false)}
        />
      )}

      {cashMove && (
        <CashMovePrompt
          visible
          type={cashMove.type}
          currency={currency}
          onSave={(m, r) => void doCashMove(m, r)}
          onCancel={() => setCashMove(null)}
        />
      )}

      {gate && (
        <PinPrompt
          visible
          action={gate}
          users={users ?? []}
          onSuccess={onGateSuccess}
          onCancel={() => setGate(null)}
        />
      )}

      {closeVisible && snapshot && (
        <CountedCashPrompt
          visible
          currency={currency}
          expectedMinor={snapshot.expectedCashMinor}
          onSave={(m, n) => void doClose(m, n)}
          onCancel={() => setCloseVisible(false)}
        />
      )}

      {report && (
        <Modal visible animationType="slide" onRequestClose={() => setReport(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setReport(null)}>
            <Pressable style={styles.sheetBody} onPress={() => {}}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{report.kind === 'Z' ? 'Z-Report' : 'X-Report'}</Text>
                <Pressable onPress={() => setReport(null)} hitSlop={12}>
                  <Ionicons name="close" size={24} color={colors.slate500} />
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <ReportView report={report} currency={currency} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </ScrollView>
  );
}

function DrawerRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.drawerRow}>
      <Text style={[styles.drawerLabel, strong && { fontFamily: fonts.sansSemiBold, color: colors.slate900 }]}>{label}</Text>
      <NumberText style={[styles.drawerValue, strong && { fontFamily: fonts.monoSemiBold, color: colors.slate900 }]}>{value}</NumberText>
    </View>
  );
}

function ActionTile({ icon, label, onPress, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; tone: 'pos' | 'warn' | 'neutral' | 'danger' }) {
  const bg = tone === 'pos' ? colors.positiveSoft : tone === 'warn' ? colors.warningSoft : tone === 'danger' ? colors.dangerSoft : colors.slate100;
  const fg = tone === 'pos' ? colors.positive : tone === 'warn' ? '#B45309' : tone === 'danger' ? colors.danger : colors.slate700;
  return (
    <Pressable style={[styles.tile, { backgroundColor: bg }]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={fg} />
      <Text style={[styles.tileText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function HistoryRow({ shift, currency, onOpen }: { shift: Shift; currency: string; onOpen: () => void }) {
  const z = shift.zReport;
  const tone = !z ? colors.slate400 : z.varianceClass === 'exact' ? colors.positive : z.varianceClass === 'over' ? '#B45309' : colors.danger;
  return (
    <Pressable style={styles.historyRow} onPress={onOpen}>
      <View style={{ flex: 1 }}>
        <Text style={styles.historyTitle}>{timeStr(shift.closedAt ?? shift.openedAt)} · {shift.cashierName ?? '—'}</Text>
        {z && (
          <Text style={[styles.historyVariance, { color: tone }]}>
            {z.varianceClass === 'exact'
              ? 'Exact'
              : `${z.varianceClass === 'over' ? 'Over' : 'Short'} ${formatMoney(Math.abs(z.varianceMinor), currency)}`}
            {' · expected '}
            {formatMoney(z.expectedMinor, currency)}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.slate300} />
    </Pressable>
  );
}

function SetPinSheet({ name, onSave, onCancel }: { name: string; onSave: (pin: string) => void; onCancel: () => void }) {
  const { t } = useT();
  const [pin, setPin] = useState('');
  const ok = isValidPin(pin);
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.sheetBackdrop} onPress={onCancel}>
        <Pressable style={styles.sheetBody} onPress={() => {}}>
          <View style={styles.addForm}>
            <Text style={styles.addTitle}>{t('shift.changePinTitle', { name })}</Text>
            <TextInput
              value={pin}
              onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
              placeholder={t('shift.newPin')}
              placeholderTextColor={colors.slate400}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              style={styles.inlineInput}
            />
            <View style={styles.buttons}>
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, !ok && { opacity: 0.45 }]} onPress={() => onSave(pin)} disabled={!ok}>
                <Text style={styles.saveText}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AddUserSheet({
  state,
  setState,
  onSave,
  onCancel,
}: {
  state: { name: string; role: UserRole; pin: string };
  setState: (s: { name: string; role: UserRole; pin: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.sheetBackdrop} onPress={onCancel}>
        <Pressable style={styles.sheetBody} onPress={() => {}}>
          <View style={styles.addForm}>
            <Text style={styles.addTitle}>{t('shift.newUser')}</Text>
            <TextInput
              value={state.name}
              onChangeText={(v) => setState({ ...state, name: v })}
              placeholder={t('shift.name')}
              placeholderTextColor={colors.slate400}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.inlineInput}
            />
            <View style={styles.roleRow}>
              {(['cashier', 'manager', 'owner'] as UserRole[]).map((r) => (
                <Pressable
                  key={r}
                  style={[styles.roleChip, state.role === r && styles.roleChipActive]}
                  onPress={() => setState({ ...state, role: r })}
                >
                  <Text style={[styles.roleChipText, state.role === r && { color: colors.white }]}>{t(ROLE_KEY[r])}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={state.pin}
              onChangeText={(v) => setState({ ...state, pin: v.replace(/\D/g, '').slice(0, 8) })}
              placeholder={t('shift.pin48DigitsOptional')}
              placeholderTextColor={colors.slate400}
              keyboardType="number-pad"
              style={styles.inlineInput}
            />
            <Text style={styles.addHint}>
              {t('shift.pinNote')}
            </Text>
            <View style={styles.buttons}>
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, state.name.trim().length === 0 && { opacity: 0.45 }]}
                onPress={onSave}
                disabled={state.name.trim().length === 0}
              >
                <Text style={styles.saveText}>{t('common.add')}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.slate50, flexGrow: 1 },
  userCard: { padding: spacing.md },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.primary },
  userTexts: { flex: 1 },
  userName: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.slate900 },
  userRole: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, marginTop: 2 },
  switchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.slate100, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 8 },
  switchBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.primary },
  addUserBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  addUserText: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500 },
  shiftCard: { gap: spacing.md },
  shiftHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  openBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.positiveSoft, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  openDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.positive },
  openBadgeText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: colors.positive },
  shiftMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500 },
  drawerRows: { gap: spacing.sm },
  drawerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  drawerLabel: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  drawerValue: { fontFamily: fonts.mono, fontSize: typography.caption, color: colors.slate900 },
  drawerDivider: { height: 1, backgroundColor: colors.slate200, marginVertical: spacing.xs },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '47%', alignItems: 'center', gap: 4, borderRadius: radius.control, paddingVertical: spacing.md },
  tileText: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption },
  movesCard: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  moveReason: { flex: 1, fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate700 },
  moveAmount: { fontFamily: fonts.mono, fontSize: typography.caption, color: colors.slate900 },
  lockedCard: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  lockedTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  lockedText: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, textAlign: 'center', lineHeight: 18 },
  openShiftBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.control, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  openShiftText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
  historyCard: { gap: spacing.sm },
  empty: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate400 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  historyTitle: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate900 },
  historyVariance: { fontFamily: fonts.mono, fontSize: typography.micro, marginTop: 2 },
  storeCard: { padding: spacing.md },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  storeIcon: { width: 40, height: 40, borderRadius: radius.card, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  storeTexts: { flex: 1 },
  storeName: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.slate900 },
  storeMeta: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500, marginTop: 2 },
  changeBtn: { backgroundColor: colors.slate100, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 8 },
  changeBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.primary },
  addForm: { gap: spacing.md, padding: spacing.lg },
  addTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  inlineInput: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate900, borderWidth: 1, borderColor: colors.slate300, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  roleRow: { flexDirection: 'row', gap: spacing.sm },
  roleChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white },
  roleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleChipText: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate700 },
  addHint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, lineHeight: 16 },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  saveBtn: { flex: 1, height: 48, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheetBody: { width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: colors.white, borderTopLeftRadius: radius.card + 4, borderTopRightRadius: radius.card + 4, height: '78%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, paddingBottom: spacing.sm },
  sheetTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
});
