import { View } from 'react-native';
import type { ReactNode } from 'react';
import { spacing } from '../theme/tokens';

/**
 * Cell wrapper for multi-column FlatLists on tablets: each item takes exactly
 * 1/columns of the row (a lone last item does not stretch full width).
 */
export function GridCell({ columns, children, gutter = spacing.sm }: { columns: number; children: ReactNode; gutter?: number }) {
  if (columns <= 1) return <>{children}</>;
  const pct = `${100 / columns}%` as const;
  return <View style={{ flexBasis: pct, maxWidth: pct, flexGrow: 0, paddingHorizontal: gutter }}>{children}</View>;
}
