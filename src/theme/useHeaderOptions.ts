import { useTheme } from './ThemeContext';
import { fonts } from './tokens';

/**
 * Theme-aware header style for stack screens outside the tab group (issue #22).
 * Replaces the old module-scoped `headerOptions` export in app/_layout.tsx,
 * which froze the light palette.
 */
export function useHeaderOptions() {
  const { colors } = useTheme();
  return {
    headerShown: true,
    headerStyle: { backgroundColor: colors.slate50 },
    headerTitleStyle: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.slate900 },
    headerTintColor: colors.slate900,
    // Without this, screens pushed from a tab show the previous route's NAME as
    // the back-button label — and the tab root lives in the "(tabs)" group folder,
    // so users saw a literal "(tabs)" next to the chevron (issue #7).
    // Empty = chevron-only back button on the JS-rendered header (Android/Web).
    headerBackTitle: '',
    // The iOS NATIVE bar drops an empty back title (react-native-screens turns ''
    // into nil, then falls back to the previous screen's title — "(tabs)"), so
    // '' alone cannot hide the label there. 'minimal' forces chevron-only on the
    // native bar. (issue #7 — survived on iOS despite the line above.)
    headerBackButtonDisplayMode: 'minimal',
  } as const;
}
