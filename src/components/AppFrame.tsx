import { View } from 'react-native';
import type { ReactNode } from 'react';
import { APP_MAX_WIDTH } from '../lib/layout';
import { colors } from '../theme/tokens';

/** Caps the app's layout width on very large screens (13" iPad landscape, resizable windows). */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: colors.slate100 }}>
      <View style={{ flex: 1, width: '100%', maxWidth: APP_MAX_WIDTH }}>{children}</View>
    </View>
  );
}
