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

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        await loadFonts();
        const db = await getDb();
        setFirstRunPending(await isFirstRunPending(db));
        // Re-gate on first-run state changes (factory reset from Settings).
        unsubscribe = onFirstRunStateChange(async () => {
          const d = await getDb();
          setFirstRunPending(await isFirstRunPending(d));
        });
      } finally {
        await SplashScreen.hideAsync().catch(() => {});
      }
    })();
    return () => {
      unsubscribe?.();
    };
  }, []);

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
        <Stack.Screen name="cloud-setup" options={{ ...headerOptions, title: 'Connect your backend' }} />
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
