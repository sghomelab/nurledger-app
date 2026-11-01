import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOutlet } from '../src/hooks/useAppData';
import { useUsers } from '../src/hooks/useShift';
import { useSync } from '../src/hooks/useSync';
import { useT } from '../src/hooks/useT';
import { getDb } from '../src/db/database';
import { resetAllData } from '../src/db/firstRun';
import { updateOutlet } from '../src/repositories/outletRepository';
import {
  disconnectCloud,
  getCloudConfig,
  setSyncEnabled,
} from '../src/repositories/cloudConfigRepository';
import {
  getReceiptWidth,
  setReceiptWidth,
  type ReceiptWidthSetting,
} from '../src/repositories/saleRepository';
import {
  CURRENCY_OPTIONS,
  NO_TAX_ENGINE_ID,
  TAX_PRESETS,
  buildCustomEngineId,
  isFormattableCurrency,
  isValidCustomRate,
  normalizeCurrencyCode,
  taxEngineLabel,
} from '../src/lib/currency';
import { formatMoney } from '../src/lib/money';
import type { TaxMode } from '../src/lib/tax';
import { Card } from '../src/components/Screen';
import { PickerOverlay } from '../src/components/PickerOverlay';
import { PinPrompt } from '../src/components/PinPrompt';
import { roleCanAct } from '../src/lib/roles';
import { colors, fonts, radius, spacing } from '../src/theme/tokens';

/**
 * Store Settings — outlet identity + currency + tax locale (FR-600, FR-602).
 *
 * Currency and tax are first-class per-outlet settings, never constants:
 * the picker lists convenient presets (data), but any ISO-4217 code and any
 * flat rate/mode can be entered free-form. Behavior always flows through the
 * TaxEngine resolved from the stored engine id (src/lib/tax.ts).
 *
 * Saving is PIN-gated for cashiers (FR-500 / DEV-005 — "store_settings"):
 * an owner/manager PIN unlocks the save, single-action.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { active, users } = useUsers();
  const [gateVisible, setGateVisible] = useState(false);
  const { outlet, reload } = useOutlet();
  const { t, lang, setLanguage } = useT();

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('SGD');
  const [customCurrency, setCustomCurrency] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [taxPresetId, setTaxPresetId] = useState<string>('sg');
  const [customRate, setCustomRate] = useState('');
  const [customMode, setCustomMode] = useState<TaxMode>('inclusive');
  // Which inline picker is open (Alert.alert only supports 3 buttons — RN).
  const [picker, setPicker] = useState<'currency' | 'tax' | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hydrate the form once the outlet arrives.
  useEffect(() => {
    if (!outlet || loaded) return;
    setName(outlet.name);
    const known = CURRENCY_OPTIONS.some((c) => c.code === outlet.currency);
    setCurrency(outlet.currency);
    setCustomCurrency(!known);
    setCustomCode(known ? '' : outlet.currency);
    const preset = TAX_PRESETS.find((p) => p.engineId === outlet.taxEngine);
    const m = /^flat:(.+)-(\d+(?:\.\d+)?)-(inclusive|exclusive)$/.exec(outlet.taxEngine);
    if (preset) {
      setTaxPresetId(preset.id);
    } else if (m) {
      setTaxPresetId('custom');
      setCustomRate(m[2] ?? '0');
      setCustomMode((m[3] ?? 'inclusive') as TaxMode);
    } else {
      setTaxPresetId('none');
    }
    setLoaded(true);
  }, [outlet, loaded]);

  const activeCurrency = customCurrency ? normalizeCurrencyCode(customCode) : currency;
  const activeEngineId =
    taxPresetId === 'custom'
      ? isValidCustomRate(customRate)
        ? buildCustomEngineId(Number.parseFloat(customRate), customMode)
        : NO_TAX_ENGINE_ID
      : (TAX_PRESETS.find((p) => p.id === taxPresetId)?.engineId ?? NO_TAX_ENGINE_ID);

  const currencyRows = [
    ...CURRENCY_OPTIONS.map((c) => ({
      key: c.code,
      label: c.code,
      sublabel: c.name,
      onPress: () => {
        setCurrency(c.code);
        setCustomCurrency(false);
        setPicker(null);
      },
    })),
    {
      key: 'other',
      label: t('settings.typeOtherIso'),
      onPress: () => {
        setCustomCurrency(true);
        setPicker(null);
      },
    },
  ];

  const taxRows = [
    ...TAX_PRESETS.map((p) => ({
      key: p.id,
      label: p.label,
      onPress: () => {
        setTaxPresetId(p.id);
        // Suggest the preset's currency (owner can still change it).
        if (p.suggestedCurrency) {
          setCurrency(p.suggestedCurrency);
          setCustomCurrency(false);
        }
        setPicker(null);
      },
    })),
    {
      key: 'custom',
      label: t('settings.customRate'),
      onPress: () => {
        setTaxPresetId('custom');
        setPicker(null);
      },
    },
  ];

  const save = async () => {
    if (!name.trim()) {
      Alert.alert(t('settings.missingFields'), t('settings.missingName'));
      return;
    }
    if (!activeCurrency) {
      Alert.alert(t('settings.invalidCurrency'), t('settings.invalidCurrencyMsg'));
      return;
    }
    if (!isFormattableCurrency(activeCurrency)) {
      Alert.alert(t('settings.unknownCurrency'), t('settings.unknownCurrencyMsg', { code: activeCurrency }), [
        { text: 'OK' },
      ]);
      return;
    }
    if (taxPresetId === 'custom' && !isValidCustomRate(customRate)) {
      Alert.alert(t('settings.invalidRate'), t('settings.invalidRateMsg'));
      return;
    }
    const preset = TAX_PRESETS.find((p) => p.id === taxPresetId);
    setSaving(true);
    try {
      await updateOutlet({
        name,
        currency: activeCurrency,
        locale: preset?.suggestedLocale ?? outlet?.locale ?? 'en',
        taxEngine: activeEngineId,
      });
      await reload();
      Alert.alert(t('settings.saved'), t('settings.savedMsg'), [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert(t('settings.saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => {
    // FR-500: cashiers can't change store settings without an owner/manager PIN.
    if (active && roleCanAct(active.role, 'store_settings')) {
      void save();
      return;
    }
    setGateVisible(true);
  };

  // ── Cloud sync (FR-503, ADR-010 BYO) ─────────────────────────────────────
  const sync = useSync();
  const [cloudCfg, setCloudCfg] = useState<{ url: string; ownerEmail?: string } | null>(null);
  const [cloudGate, setCloudGate] = useState<(() => void) | null>(null);

  useEffect(() => {
    void getCloudConfig().then(setCloudCfg);
  }, [sync.connected]);

  /** Cloud changes are store-level (FR-500 'store_settings' gate). */
  const requireCloudGate = (job: () => void) => {
    if (active && roleCanAct(active.role, 'store_settings')) {
      void job();
      return;
    }
    setCloudGate(job);
  };

  const toggleSync = (on: boolean) => {
    requireCloudGate(async () => {
      await setSyncEnabled(on);
      if (on) await sync.syncNow(); // turning it on drains the backlog immediately
      await sync.refresh();
    });
  };

  const confirmDisconnect = () => {
    Alert.alert(
      t('settings.disconnectTitle'),
      t('settings.disconnectMsg'),
      [
        { text: t('common.cancel') },
        {
          text: t('settings.disconnect'),
          style: 'destructive',
          onPress: () =>
            requireCloudGate(async () => {
              await disconnectCloud();
              setCloudCfg(null);
              await sync.refresh();
              Alert.alert(t('settings.disconnected'), t('settings.disconnectedMsg'));
            }),
        },
      ],
    );
  };

  // ── Factory reset (Danger zone) ────────────────────────────────────────
  // Wipes every row, re-asserts required infrastructure, and the root layout
  // re-shows the first-run choice (sample vs empty) via its state subscription.
  const [resetGate, setResetGate] = useState<(() => void) | null>(null);

  const confirmReset = () => {
    Alert.alert(t('settings.resetTitle'), t('settings.resetMsg'), [
      { text: t('common.cancel') },
      {
        text: t('settings.resetData'),
        style: 'destructive',
        onPress: () =>
          requireCloudGate(async () => {
            const db = await getDb();
            await resetAllData(db);
            // No navigation needed — the root layout's onFirstRunStateChange
            // subscription re-gates to the first-run screen on the notify.
          }),
      },
    ]);
  };

  const requestReset = () => {
    // FR-500: same 'store_settings' gate as other store-level changes.
    if (active && roleCanAct(active.role, 'store_settings')) {
      confirmReset();
      return;
    }
    setResetGate(confirmReset);
  };

  // ── Receipt width (FR-109, device-local) ─────────────────────────────────
  const [receiptWidth, setReceiptWidthState] = useState<ReceiptWidthSetting>('80mm');
  useEffect(() => {
    void getReceiptWidth().then(setReceiptWidthState);
  }, []);
  const onReceiptWidth = (v: string) => {
    const width = v as ReceiptWidthSetting;
    setReceiptWidthState(width);
    void setReceiptWidth(width);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <SectionTitle>{t('settings.store')}</SectionTitle>
          <Field label={t('settings.storeName')}>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t('settings.storeNamePh')} />
          </Field>
        </Card>

        <Card>
          <SectionTitle>{t('settings.language')}</SectionTitle>
          <Field label={t('settings.appLanguage')}>
            <Segmented
              options={[t('settings.langEn'), t('settings.langMs')]}
              value={lang === 'en' ? t('settings.langEn') : t('settings.langMs')}
              onChange={(v) => void setLanguage(v === t('settings.langMs') ? 'ms' : 'en')}
            />
          </Field>
          <Text style={styles.note}>{t('settings.languageNote')}</Text>
        </Card>

        <Card>
          <SectionTitle>{t('settings.currency')}</SectionTitle>
          <Field label={t('settings.sellIn')}>
            <Pressable style={styles.selectBox} onPress={() => setPicker('currency')}>
              <Text style={styles.selectText}>
                {activeCurrency || '—'}
                {activeCurrency ? ` — ${formatMoney(12345, activeCurrency)}` : ''}
              </Text>
              <Text style={styles.chevron}>⌄</Text>
            </Pressable>
          </Field>
          {customCurrency && (
            <Field label={t('settings.isoCode')}>
              <TextInput
                style={styles.inputMono}
                value={customCode}
                onChangeText={(t2) => setCustomCode(t2.toUpperCase())}
                placeholder="e.g. TWD"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={3}
              />
            </Field>
          )}
          <Text style={styles.note}>{t('settings.currencyNote')}</Text>
        </Card>

        <Card>
          <SectionTitle>{t('settings.tax')}</SectionTitle>
          <Field label={t('settings.taxRegime')}>
            <Pressable style={styles.selectBox} onPress={() => setPicker('tax')}>
              <Text style={styles.selectText}>{taxEngineLabel(activeEngineId)}</Text>
              <Text style={styles.chevron}>⌄</Text>
            </Pressable>
          </Field>
          {taxPresetId === 'custom' && (
            <View style={styles.row}>
              <View style={styles.colHalf}>
                <Field label={t('settings.rate')}>
                  <TextInput
                    style={styles.inputMono}
                    value={customRate}
                    onChangeText={setCustomRate}
                    placeholder="e.g. 7.75"
                    keyboardType="decimal-pad"
                  />
                </Field>
              </View>
              <View style={styles.colHalf}>
                <Field label={t('settings.pricingMode')}>
                  <Segmented
                    options={[t('settings.inclusive'), t('settings.exclusive')]}
                    value={t(customMode === 'inclusive' ? 'settings.inclusive' : 'settings.exclusive')}
                    onChange={(v) => setCustomMode(v === t('settings.exclusive') ? 'exclusive' : 'inclusive')}
                  />
                </Field>
              </View>
            </View>
          )}
          <Text style={styles.note}>{t('settings.taxNote')}</Text>
        </Card>

        <Card>
          <SectionTitle>{t('settings.cloud')}</SectionTitle>
          {!cloudCfg ? (
            <>
              <Text style={styles.note}>{t('settings.cloudNote')}</Text>
              <Pressable
                style={styles.cloudBtn}
                onPress={() => requireCloudGate(() => router.push('/cloud-setup'))}
              >
                <Text style={styles.cloudBtnText}>{t('settings.connect')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.cloudRow}>
                <Ionicons name="cloud-outline" size={18} color={colors.primary} />
                <View style={styles.cloudInfo}>
                  <Text style={styles.cloudUrl} numberOfLines={1}>
                    {cloudCfg.url}
                  </Text>
                  {cloudCfg.ownerEmail && (
                    <Text style={styles.cloudSub}>{t('settings.owner', { email: cloudCfg.ownerEmail })}</Text>
                  )}
                </View>
                <Switch
                  value={sync.enabled}
                  onValueChange={(on) => toggleSync(on)}
                  trackColor={{ true: colors.positive, false: colors.slate200 }}
                />
              </View>
              <View style={styles.cloudMeta}>
                <Text style={styles.cloudMetaText}>
                  {sync.enabled
                    ? sync.syncing
                      ? t('sync.syncing')
                      : sync.pending > 0
                        ? t('sync.queuedAuto', { n: sync.pending })
                        : sync.lastSyncedAt
                          ? t('sync.synced', { time: new Date(sync.lastSyncedAt).toLocaleTimeString() })
                          : t('sync.connected')
                    : sync.pending > 0
                      ? t('sync.queuedOffShort', { n: sync.pending })
                      : t('sync.off')}
                </Text>
                {sync.lastError && <Text style={styles.cloudError}>{sync.lastError}</Text>}
              </View>
              <View style={styles.cloudBtns}>
                <Pressable
                  style={[styles.cloudBtn, { flex: 1 }, (sync.syncing || !sync.enabled) && { opacity: 0.5 }]}
                  onPress={() =>
                    requireCloudGate(async () => {
                      await sync.syncNow();
                      await sync.refresh();
                    })
                  }
                  disabled={sync.syncing || !sync.enabled}
                >
                  <Text style={styles.cloudBtnText}>{t('settings.syncNow')}</Text>
                </Pressable>
                <Pressable style={[styles.cloudBtn, { flex: 1, backgroundColor: colors.danger }]} onPress={confirmDisconnect}>
                  <Text style={styles.cloudBtnText}>{t('settings.disconnect')}</Text>
                </Pressable>
              </View>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle>{t('settings.receipt')}</SectionTitle>
          <Field label={t('settings.printerWidth')}>
            <Segmented options={['58mm', '80mm']} value={receiptWidth} onChange={onReceiptWidth} />
          </Field>
          <Text style={styles.note}>{t('settings.receiptNote')}</Text>
        </Card>

        <Card>
          <SectionTitle style={styles.dangerTitle}>{t('settings.danger')}</SectionTitle>
          <Field label={t('settings.resetData')}>
            <Pressable style={[styles.cloudBtn, { backgroundColor: colors.danger }]} onPress={requestReset}>
              <Text style={styles.cloudBtnText}>{t('settings.resetData')}</Text>
            </Pressable>
          </Field>
          <Text style={styles.note}>{t('settings.resetDataMsg')}</Text>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={requestSave} disabled={saving}>
          <Text style={styles.saveText}>{t('settings.saveBtn')}</Text>
        </Pressable>
      </View>

      {gateVisible && (
        <PinPrompt
          visible
          action="store_settings"
          users={users ?? []}
          onSuccess={() => {
            setGateVisible(false);
            void save();
          }}
          onCancel={() => setGateVisible(false)}
        />
      )}

      {cloudGate && (
        <PinPrompt
          visible
          action="store_settings"
          users={users ?? []}
          onSuccess={() => {
            const job = cloudGate;
            setCloudGate(null);
            void job();
          }}
          onCancel={() => setCloudGate(null)}
        />
      )}

      {resetGate && (
        <PinPrompt
          visible
          action="store_settings"
          users={users ?? []}
          onSuccess={() => {
            const job = resetGate;
            setResetGate(null);
            job();
          }}
          onCancel={() => setResetGate(null)}
        />
      )}

      {picker === 'currency' && (
        <PickerOverlay title={t('picker.titleCurrency')} rows={currencyRows} onClose={() => setPicker(null)} />
      )}
      {picker === 'tax' && (
        <PickerOverlay title={t('picker.titleTax')} rows={taxRows} onClose={() => setPicker(null)} />
      )}
    </KeyboardAvoidingView>
  );
}

function SectionTitle({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={o} style={[styles.seg, value === o && styles.segActive]} onPress={() => onChange(o)}>
          <Text style={[styles.segText, value === o && styles.segTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.slate50 },
  content: { padding: spacing.lg, paddingBottom: 24, gap: spacing.lg },
  sectionTitle: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.slate900, marginBottom: spacing.md },
  dangerTitle: { color: colors.danger },
  field: { marginBottom: spacing.md },
  label: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate700, marginBottom: spacing.xs + 2 },
  input: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.sans, fontSize: 15, color: colors.slate900,
  },
  inputMono: {
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.mono, fontSize: 15, color: colors.slate900,
  },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: spacing.md, paddingVertical: 11,
  },
  selectText: { fontFamily: fonts.sans, fontSize: 15, color: colors.slate900, flex: 1 },
  chevron: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.slate400, marginLeft: spacing.sm },
  note: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500, lineHeight: 17 },
  row: { flexDirection: 'row', gap: spacing.md },
  colHalf: { flex: 1 },
  segmented: { flexDirection: 'row', backgroundColor: colors.slate100, borderRadius: radius.control, padding: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.control - 3 },
  segActive: { backgroundColor: colors.primary },
  segText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate500 },
  segTextActive: { color: colors.white },
  footer: {
    padding: spacing.lg, borderTopWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.control, paddingVertical: 14, alignItems: 'center',
  },
  saveText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.white },
  cloudRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.slate50, borderRadius: radius.control, padding: spacing.md, marginBottom: spacing.sm,
  },
  cloudInfo: { flex: 1, gap: 2 },
  cloudUrl: { fontFamily: fonts.mono, fontSize: 13, color: colors.slate900 },
  cloudSub: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate500 },
  cloudMeta: { gap: 4, marginBottom: spacing.md },
  cloudMetaText: { fontFamily: fonts.sans, fontSize: 13, color: colors.slate500 },
  cloudError: { fontFamily: fonts.sans, fontSize: 12, color: colors.danger, lineHeight: 16 },
  cloudBtns: { flexDirection: 'row', gap: spacing.sm },
  cloudBtn: {
    backgroundColor: colors.primary, borderRadius: radius.control, paddingVertical: 12, alignItems: 'center',
  },
  cloudBtnText: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.white },
});
