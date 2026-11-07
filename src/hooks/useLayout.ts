import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { layoutFor, type LayoutInfo } from '../lib/layout';

/** Current window size → responsive layout flags (re-renders on rotation / split-screen). */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions();
  return useMemo(() => layoutFor(width, height), [width, height]);
}
