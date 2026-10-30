import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Card, Screen } from '../src/components/Screen';
import { getCloudAdapter } from '../src/hooks/useSync';
import { getOutlet } from '../src/repositories/outletRepository';
import { saveCloudConfig } from '../src/repositories/cloudConfigRepository';
import { CLOUD_SCHEMA_SQL, CLOUD_SCHEMA_VERSION } from '../src/lib/cloud/schemaSql';
import type { CloudConfig } from '../src/lib/cloud/types';
import { taxEngineLabel } from '../src/lib/currency';
import { colors, fonts, radius, spacing, typography } from '../src/theme/tokens';

/**
 * BYO cloud setup wizard (ADR-010, FR-504/FR-505).
 *
 * The store brings its own (free) Supabase project. The app is a pure client —
 * there is no Nurledger-operated backend and the creator never sees store data.
 *
 *  1. **Connection** — paste the project URL + anon key + service_role key.
 *     "Check" verifies reachability (auth health endpoint) and whether the
 *     schema bundle has been deployed.
 *  2. **Run the SQL** — the owner pastes the app's SQL bundle into the
 *     project's SQL Editor (the app cannot run DDL in someone else's project).
 *  3. **Owner account** — self-service sign-up IN THE STORE'S OWN project
 *     (FR-505). Local/dev projects auto-confirm; hosted projects with email
 *     confirmation on fall through to a sign-in.
 *  4. **Store** — provision the outlet + owner membership, save the
 *     connection. Sync itself stays OFF until the owner flips the in-app
 *     toggle (Settings → Cloud sync).
 */

type Step = 'creds' | 'sql' | 'account' | 'store';

const STEP_LABELS: Array<[Step, string]> = [
  ['creds', 'Connection'],
  ['sql', 'Run the SQL'],
  ['account', 'Owner account'],
  ['store', 'Connect'],
];

export default function CloudSetupScreen() {
  const router = useRouter();
  const adapter = getCloudAdapter();

  const [step, setStep] = useState<Step>('creds');
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceKey, setServiceKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** signUp asked for email confirmation → the primary action becomes sign-in. */
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);

  const cfg = useCallback(
    (): CloudConfig => ({
      url: url.trim().replace(/\/+$/, ''),
      anonKey: anonKey.trim(),
      serviceKey: serviceKey.trim(),
      outletId: '', // unused by wizard calls; sync uses the local outlet id
      ownerEmail: email.trim() || undefined,
    }),
    [url, anonKey, serviceKey, email],
  );

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  /** Step 1 → 2/3: reachable? schema deployed? */
  const checkConnection = useCallback(async () => {
    if (!url.trim() || !anonKey.trim() || !serviceKey.trim()) {
      setError('Project URL, anon key and service_role key are all required.');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await adapter.ping(cfg());
      const deployed = await adapter.schemaDeployed(cfg());
      if (deployed) {
        setNote('Backend reachable and the Nurledger schema is deployed.');
        setStep('account');
      } else {
        setNote('Backend reachable — but the schema is not deployed yet.');
        setStep('sql');
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [adapter, cfg]);

  /** Step 2 → 3: re-check the schema after the owner ran the SQL. */
  const checkSchema = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const deployed = await adapter.schemaDeployed(cfg());
      if (deployed) {
        setNote(null);
        setStep('account');
      } else {
        setError(
          'Schema still not detected. Make sure the SQL Editor query finished without errors, then check again.',
        );
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [adapter, cfg]);

  /** Step 3: create the owner account (or sign in after email confirmation). */
  const createAccount = useCallback(async () => {
    if (!email.trim() || password.length < 6) {
      setError('Enter the owner email and a password (min 6 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (awaitingSignIn) {
        await adapter.signIn(cfg(), email.trim(), password);
        setStep('store');
        return;
      }
      const r = await adapter.signUp(cfg(), email.trim(), password);
      if (r.needsConfirm) {
        setAwaitingSignIn(true);
        setNote(
          'Account created — confirm the email link Supabase just sent, then tap “Sign in”.',
        );
      } else {
        setStep('store');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Existing account (re-run of the wizard) → fall back to sign-in.
      if (/already registered|already been registered/i.test(msg)) {
        setAwaitingSignIn(true);
        setNote('This email already has an account — sign in instead.');
      } else {
        fail(new Error(msg));
      }
    } finally {
      setBusy(false);
    }
  }, [adapter, cfg, email, password, awaitingSignIn]);

  /** Step 4: provision outlet + membership (create-or-join), persist the connection. */
  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const outlet = await getOutlet();
      if (!outlet) throw new Error('Local outlet missing — the DB was not seeded');
      const tenantId = await adapter.provisionStore(cfg(), {
        id: outlet.id,
        name: outlet.name,
        currency: outlet.currency,
        locale: outlet.locale,
        taxEngine: outlet.taxEngine,
      });
      await saveCloudConfig({
        url: cfg().url,
        anonKey: cfg().anonKey,
        serviceKey: cfg().serviceKey,
        ownerEmail: email.trim(),
        outletId: tenantId,
      });
      const joined = tenantId !== outlet.id;
      Alert.alert(
        'Connected',
        joined
          ? 'This device joined the store already linked to this backend. Sync is OFF — turn it on in Settings → Cloud sync when you are ready.'
          : 'Your backend is linked. Sync is OFF — turn it on in Settings → Cloud sync when you are ready.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [adapter, cfg, email, router]);

  const outlet = useOutletLite();

  const stepIndex = STEP_LABELS.findIndex(([s]) => s === step);
  const primary =
    step === 'creds'
      ? { label: 'Check connection', run: checkConnection }
      : step === 'sql'
        ? { label: 'I’ve run it — check setup', run: checkSchema }
        : step === 'account'
          ? { label: awaitingSignIn ? 'Sign in' : 'Create owner account', run: createAccount }
          : { label: 'Create store & connect', run: connect };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Step indicator */}
        <View style={styles.steps}>
          {STEP_LABELS.map(([s, label], i) => (
            <View key={s} style={styles.step}>
              <View
                style={[
                  styles.stepDot,
                  i < stepIndex && styles.stepDotDone,
                  i === stepIndex && styles.stepDotActive,
                ]}
              >
                {i < stepIndex ? (
                  <Ionicons name="checkmark" size={12} color={colors.white} />
                ) : (
                  <Text style={styles.stepNum}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.stepLabel, i === stepIndex && { color: colors.slate900 }]}>
                {label}
              </Text>
            </View>
          ))}
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {note && (
          <View style={styles.noteBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.noteText}>{note}</Text>
          </View>
        )}

        {step === 'creds' && (
          <Card>
            <Text style={styles.cardTitle}>Your Supabase project</Text>
            <Text style={styles.hint}>
              BYO cloud: create a FREE Supabase project (supabase.com) and paste its
              credentials here. Your data lives in YOUR project — Nurledger never operates
              or accesses it.
            </Text>
            <Field label="Project URL">
              <TextInput
                style={styles.input}
                value={url}
                onChangeText={setUrl}
                placeholder="https://xxxx.supabase.co"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </Field>
            <Field label="anon / public key">
              <TextInput
                style={styles.inputMono}
                value={anonKey}
                onChangeText={setAnonKey}
                placeholder="eyJhbGciOi…"
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={2}
              />
            </Field>
            <Field label="service_role key">
              <TextInput
                style={styles.inputMono}
                value={serviceKey}
                onChangeText={setServiceKey}
                placeholder="eyJhbGciOi…"
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={2}
              />
              <Text style={styles.keyNote}>
                Used only on this device, only to verify your schema. It never leaves the
                phone.
              </Text>
            </Field>
            <Field label="Owner email">
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@store.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
            </Field>
            <Field label="Owner password">
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="min 6 characters"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>
          </Card>
        )}

        {step === 'sql' && (
          <Card>
            <Text style={styles.cardTitle}>
              Run the setup SQL (schema v{CLOUD_SCHEMA_VERSION})
            </Text>
            <Text style={styles.hint}>
              1. Open your project → <Text style={styles.link}>SQL Editor</Text> → New query.
              2. Paste this bundle and press Run. 3. Come back and check.
            </Text>
            <View style={styles.sqlBox}>
              <ScrollView nestedScrollEnabled horizontal style={styles.sqlScroll}>
                <Text style={styles.sqlText}>{CLOUD_SCHEMA_SQL}</Text>
              </ScrollView>
            </View>
            <Pressable
              style={[styles.copyBtn, busy && { opacity: 0.6 }]}
              onPress={async () => {
                await Clipboard.setStringAsync(CLOUD_SCHEMA_SQL);
                Alert.alert('Copied', 'SQL bundle copied — paste it into the SQL Editor.');
              }}
            >
              <Ionicons name="copy-outline" size={16} color={colors.white} />
              <Text style={styles.copyText}>Copy SQL</Text>
            </Pressable>
          </Card>
        )}

        {step === 'account' && (
          <Card>
            <Text style={styles.cardTitle}>Owner account</Text>
            <Text style={styles.hint}>
              Creates the store’s owner login in YOUR project (it is how this device — and
              any second device — signs in to sync). Cashiers keep using their local PINs;
              this account is for sync only.
            </Text>
            <Field label="Email">
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@store.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
            </Field>
            <Field label="Password">
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="min 6 characters"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>
          </Card>
        )}

        {step === 'store' && outlet && (
          <Card>
            <Text style={styles.cardTitle}>Link this store</Text>
            <Text style={styles.hint}>
              Creates the outlet record and makes the signed-in owner a member, then saves
              the connection on this device.
            </Text>
            <View style={styles.storeRow}>
              <Ionicons name="storefront-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName}>{outlet.name}</Text>
                <Text style={styles.storeSub}>
                  {outlet.currency} · {outlet.locale} · {taxEngineLabel(outlet.taxEngine)}
                </Text>
              </View>
            </View>
          </Card>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step !== 'creds' && (
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.backText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          onPress={() => void primary.run()}
          disabled={busy}
        >
          <Text style={styles.primaryText}>{busy ? 'Working…' : primary.label}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/** Local outlet for the final step (read once; the screen is short-lived). */
function useOutletLite() {
  const [outlet, setOutlet] = useState<{
    id: string;
    name: string;
    currency: string;
    locale: string;
    taxEngine: string;
  } | null>(null);
  useEffect(() => {
    void getOutlet().then(setOutlet);
  }, []);
  return outlet;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 16 },
  steps: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  step: { alignItems: 'center', gap: 4, width: 72 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.slate200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.positive },
  stepDotActive: { backgroundColor: colors.primary },
  stepNum: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.slate500 },
  stepLabel: { fontFamily: fonts.sansSemiBold, fontSize: 10, color: colors.slate400, textAlign: 'center' },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  errorText: { flex: 1, fontFamily: fonts.sans, fontSize: typography.caption, color: colors.danger },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  noteText: { flex: 1, fontFamily: fonts.sans, fontSize: typography.caption, color: colors.primary },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: typography.title, color: colors.slate900, marginBottom: 6 },
  hint: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500, lineHeight: 17, marginBottom: spacing.md },
  link: { fontFamily: fonts.sansSemiBold, color: colors.primary },
  field: { marginBottom: spacing.md },
  fieldLabel: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.slate700, marginBottom: 4 },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.slate900,
  },
  inputMono: {
    backgroundColor: colors.white,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.slate900,
  },
  keyNote: { fontFamily: fonts.sans, fontSize: 11, color: colors.slate400, marginTop: 4 },
  sqlBox: {
    backgroundColor: colors.slate900,
    borderRadius: radius.control,
    padding: spacing.md,
    maxHeight: 180,
    marginBottom: spacing.md,
  },
  sqlScroll: { flexGrow: 0 },
  sqlText: { fontFamily: fonts.mono, fontSize: 10, color: '#E2E8F0', lineHeight: 14 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: radius.control,
    backgroundColor: colors.primary,
  },
  copyText: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.white },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.slate50,
    borderRadius: radius.control,
    padding: spacing.md,
  },
  storeName: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.slate900 },
  storeSub: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.white,
  },
  backBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.slate300,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.slate700 },
  primaryBtn: {
    flex: 2,
    height: 52,
    borderRadius: radius.control,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.white },
});
