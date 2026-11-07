import { View } from 'react-native';
import type { ReactNode } from 'react';
import { colors } from '../theme/tokens';

/** Keeps full-screen modal content (payment, receipt, weigh) a readable column on tablets. */
export function ModalFrame({ children, maxWidth = 560 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: colors.slate50 }}>
      <View style={{ flex: 1, width: '100%', maxWidth }}>{children}</View>
    </View>
  );
}
