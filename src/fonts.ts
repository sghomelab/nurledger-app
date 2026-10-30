import * as Font from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';

/**
 * Font family registry — one family per weight (cross-platform safe:
 * Android/Hermes cannot weight-match within a single registered family).
 */
export const FONT_BASE = {
  'PlusJakartaSans-Regular': PlusJakartaSans_400Regular,
  'PlusJakartaSans-Medium': PlusJakartaSans_500Medium,
  'PlusJakartaSans-SemiBold': PlusJakartaSans_600SemiBold,
  'PlusJakartaSans-Bold': PlusJakartaSans_700Bold,
  'PlusJakartaSans-ExtraBold': PlusJakartaSans_800ExtraBold,
  'JetBrainsMono-Regular': JetBrainsMono_400Regular,
  'JetBrainsMono-Medium': JetBrainsMono_500Medium,
  'JetBrainsMono-SemiBold': JetBrainsMono_600SemiBold,
};

/** Load brand fonts (Plus Jakarta Sans + JetBrains Mono — prototype tokens §8). */
export async function loadFonts(): Promise<void> {
  await Font.loadAsync(FONT_BASE);
}
