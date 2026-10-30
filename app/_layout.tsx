import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { loadFonts } from '../src/fonts';
import { getDb } from '../src/db/database';
import { colors } from '../src/theme/tokens';

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
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.slate50 } }} />
    </>
  );
}
