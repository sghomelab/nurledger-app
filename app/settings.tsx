import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOutlet } from '../src/hooks/useAppData';
import { useUsers } from '../src/hooks/useShift';
import { useSync } from '../src/hooks/useSync';
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
      label: 'Type another ISO code…',
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
      label: 'Custom rate…',
      onPress: () => {
        setTaxPresetId('custom');
        setPicker(null);
      },
    },
  ];

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Missing fields', 'Store name is required.');
      return;
    }
    if (!activeCurrency) {
      Alert.alert('Invalid currency', 'Currency must be a 3-letter ISO code, e.g. SGD or MYR.');
      return;
    }
    if (!isFormattableCurrency(activeCurrency)) {
      Alert.alert('Unknown currency', `“${activeCurrency}” is not a recognized currency code.`, [
        { text: 'OK' },
      ]);
      return;
    }
    if (taxPresetId === 'custom' && !isValidCustomRate(customRate)) {
      Alert.alert('Invalid tax rate', 'Rate must be 0–40 with up to 2 decimals, e.g. 7.75.');
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
      Alert.alert('Saved', 'Store settings updated.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
      'Disconnect backend?',
      'The connection is removed from this device. Sales, stock and the sync queue are NOT touched — reconnect any time to resume from where it left off.',
      [
        { text: 'Cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () =>
            requireCloudGate(async () => {
              await disconnectCloud();
              setCloudCfg(null);
              await sync.refresh();
              Alert.alert('Disconnected', 'You can connect again any time.');
            }),
        },
      ],
    );
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
          <SectionTitle>Store</SectionTitle>
          <Field label="Store name *">
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. My Provision Store" />
          </Field>
        </Card>

        <Card>
          <SectionTitle>Currency · FR-602</SectionTitle>
          <Field label="Sell in">
            <Pressable style={styles.selectBox} onPress={() => setPicker('currency')}>
              <Text style={styles.selectText}>
                {activeCurrency || '—'}
                {activeCurrency ? ` — ${formatMoney(12345, activeCurrency)}` : ''}
              </Text>
              <Text style={styles.chevron}>⌄</Text>
            </Pressable>
          </Field>
          {customCurrency && (
            <Field label="ISO currency code (3 letters)">
              <TextInput
                style={styles.inputMono}
                value={customCode}
                onChangeText={(t) => setCustomCode(t.toUpperCase())}
                placeholder="e.g. TWD"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={3}
              />
            </Field>
          )}
          <Text style={styles.note}>
            Changing the currency reinterprets existing prices and cart amounts in the new
            currency — review product prices after switching.
          </Text>
        </Card>

        <Card>
          <SectionTitle>Tax · FR-600</SectionTitle>
          <Field label="Tax regime">
            <Pressable style={styles.selectBox} onPress={() => setPicker('tax')}>
              <Text style={styles.selectText}>{taxEngineLabel(activeEngineId)}</Text>
              <Text style={styles.chevron}>⌄</Text>
            </Pressable>
          </Field>
          {taxPresetId === 'custom' && (
            <View style={styles.row}>
              <View style={styles.colHalf}>
                <Field label="Rate % (0–40)">
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
                <Field label="Pricing mode">
                  <Segmented options={['inclusive', 'exclusive']} value={customMode} onChange={(v) => setCustomMode(v as TaxMode)} />
                </Field>
              </View>
            </View>
          )}
          <Text style={styles.note}>
            Inclusive: prices already contain tax (SG GST style). Exclusive: tax is added on
            top. Presets are suggestions only — any rate works via Custom.
          </Text>
        </Card>

        <Card>
          <SectionTitle>Cloud sync · FR-503</SectionTitle>
          {!cloudCfg ? (
            <>
              <Text style={styles.note}>
                Optional. Link this store to its own free Supabase project (BYO — your data
                stays in your project). Everything keeps working offline either way; queued
                sales sync when you turn it on.
              </Text>
              <Pressable
                style={styles.cloudBtn}
                onPress={() => requireCloudGate(() => router.push('/cloud-setup'))}
              >
                <Text style={styles.cloudBtnText}>Connect your backend</Text>
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
                    <Text style={styles.cloudSub}>owner: {cloudCfg.ownerEmail}</Text>
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
                      ? 'Syncing…'
                      : sync.pending > 0
                        ? `${sync.pending} ops queued — syncing automatically`
                        : sync.lastSyncedAt
                          ? `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}`
                          : 'Connected'
                    : sync.pending > 0
                      ? `${sync.pending} ops queued · sync off`
                      : 'Sync off — sales queue locally'}
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
                  <Text style={styles.cloudBtnText}>Sync now</Text>
                </Pressable>
                <Pressable style={[styles.cloudBtn, { flex: 1, backgroundColor: colors.danger }]} onPress={confirmDisconnect}>
                  <Text style={styles.cloudBtnText}>Disconnect</Text>
                </Pressable>
              </View>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle>Receipt · FR-109</SectionTitle>
          <Field label="Printer width">
            <Segmented options={['58mm', '80mm']} value={receiptWidth} onChange={onReceiptWidth} />
          </Field>
          <Text style={styles.note}>
            The on-screen receipt (and any future printer output) renders at this width.
          </Text>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={requestSave} disabled={saving}>
          <Text style={styles.saveText}>Save settings</Text>
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

      {picker === 'currency' && (
        <PickerOverlay title="Currency" rows={currencyRows} onClose={() => setPicker(null)} />
      )}
      {picker === 'tax' && (
        <PickerOverlay title="Tax" rows={taxRows} onClose={() => setPicker(null)} />
      )}
    </KeyboardAvoidingView>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
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
