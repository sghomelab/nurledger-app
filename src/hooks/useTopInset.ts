import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Top safe-area inset for screens that draw their OWN header.
 *
 * The root Stack sets `headerShown: false` (app/_layout.tsx), and a hidden
 * react-navigation header means NOTHING consumes the top inset — the screen
 * content starts at the very top of the window. On iOS the status bar
 * (clock / battery / Dynamic Island) then sits ON TOP of the screen's title
 * text and swallows taps meant for the back chevron (issue #4: "texts are
 * superimposed and hence back arrow … not working").
 *
 * Screens WITH a native stack header (settings, cloud-setup, inventory/*,
 * po/*, csv, import-csv, shift/[id]) get the inset from that header and must
 * NOT add it again.
 */
export function useTopInset(): number {
  return useSafeAreaInsets().top;
}
