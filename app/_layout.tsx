import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { loadFonts } from '../src/fonts';
import { getDb } from '../src/db/database';
import { colors, fonts } from '../src/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Root layout — brand fonts + DB bootstrap (schema + first-run seed) gate the UI.
 * Offline-first: no network involvement on startup (spec §4.2 rule 1).
 */
export default function RootLayout() {
  useEffect(() => {
    (async () => {
      try {
        await loadFonts();
        await getDb();
      } finally {
        await SplashScreen.hideAsync().catch(() => {});
      }
    })();
  }, []);

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
        <Stack.Screen name="settings" options={{ ...headerOptions, title: 'Store settings' }} />
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
