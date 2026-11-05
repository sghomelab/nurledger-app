import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { loadFonts } from '../src/fonts';
import { getDb } from '../src/db/database';
import { isFirstRunPending, onFirstRunStateChange } from '../src/db/firstRun';
import { FirstRunScreen } from '../src/components/FirstRunScreen';
import { useT } from '../src/hooks/useT';
import { colors, fonts } from '../src/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Root layout — brand fonts + DB bootstrap gate the UI.
 * Offline-first: no network involvement on startup (spec §4.2 rule 1).
 *
 * First-run gate: a fresh install has no `seeded_v1` flag until the owner
 * chooses on the FirstRunScreen (sample data vs empty start —
 * src/db/firstRun.ts). While the choice is pending the tabs are not rendered
 * at all; a Settings → "Reset all data" wipes the flag and the subscription
 * below re-shows the same screen.
 */
export default function RootLayout() {
  const { t } = useT();
  // null = still bootstrapping (splash up); true = first-run choice pending.
  const [firstRunPending, setFirstRunPending] = useState<boolean | null>(null);

  const [bootFailed, setBootFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        await loadFonts();
        const db = await getDb();
        const pending = await isFirstRunPending(db);
        if (cancelled) return;
        setFirstRunPending(pending);
        // Re-gate on first-run state changes (factory reset from Settings).
        unsubscribe = onFirstRunStateChange(async () => {
          const d = await getDb();
          setFirstRunPending(await isFirstRunPending(d));
        });
        // Unmounted while awaiting → drop the listener we just added.
        if (cancelled) unsubscribe();
      } catch {
        // A failed bootstrap used to leave a permanent blank screen.
        if (!cancelled) setBootFailed(true);
      } finally {
        await SplashScreen.hideAsync().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [attempt]);

  if (bootFailed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.slate50 }}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 16, color: colors.slate900, textAlign: 'center' }}>
          {t('app.bootFailed')}
        </Text>
        <Pressable
          style={{ marginTop: 16, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.primary }}
          onPress={() => {
            setBootFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, color: colors.white }}>{t('app.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  if (firstRunPending === null) return null; // splash still covering
  if (firstRunPending) return <FirstRunScreen />;

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.slate50 } }}>
        {/* Non-tab screens live outside the (tabs) group — header + back button. */}
        <Stack.Screen name="inventory/new" options={{ ...headerOptions, title: 'New product' }} />
        <Stack.Screen name="inventory/[id]" options={{ ...headerOptions, title: 'Product' }} />
        <Stack.Screen name="inventory/edit" options={{ ...headerOptions, title: 'Edit product' }} />
        <Stack.Screen name="po" options={{ ...headerOptions, title: 'Purchase Orders' }} />
        <Stack.Screen name="po/new" options={{ ...headerOptions, title: 'New PO' }} />
        <Stack.Screen name="po/[id]" options={{ ...headerOptions, title: 'PO' }} />
        <Stack.Screen name="settings" options={{ ...headerOptions, title: t('settings.title') }} />
        <Stack.Screen name="cloud-setup" options={{ ...headerOptions, title: t('cloudsetup.title') }} />
      </Stack>
    </>
  );
}

/** Shared header style for stack screens outside the tab group. */
const headerOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.slate50 },
  headerTitleStyle: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.slate900 },
  headerTintColor: colors.slate900,
} as const;
