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
    // Empty = chevron-only back button.
    headerBackTitle: '',
  };
}
