import { View } from 'react-native';
import type { ReactNode } from 'react';
import { APP_MAX_WIDTH } from '../lib/layout';
import { touch } from '../hooks/useSecurity';
import { useTheme } from '../theme/ThemeContext';

/**
 * Caps the app's layout width on very large screens (13" iPad landscape,
 * resizable windows).
 *
 * The root View also resets the register's idle clock on ANY touch
 * (issue #26: the auto-lock must not fire mid-task on tabs that don't
 * touch() individually — Shift, Inventory, Insights, Settings).
 *
 * Uses the legacy bubbling `onTouchStart` (NOT the responder system):
 * `onStartShouldSetResponderCapture` on this node was verified on-device to
 * break the expo-router bottom tab bar (tab Pressables stopped receiving
 * touches), while onTouchStart fires for every touch in the subtree without
 * taking part in responder negotiation.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ flex: 1, alignItems: 'center', backgroundColor: colors.slate100 }}
      onTouchStart={() => touch()}
    >
      <View style={{ flex: 1, width: '100%', maxWidth: APP_MAX_WIDTH }}>{children}</View>
    </View>
  );
}
