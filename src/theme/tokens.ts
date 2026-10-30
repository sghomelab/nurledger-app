/**
 * Design tokens — extracted from the KitePOS prototype (PROTOTYPE-REFERENCE §8, ADR-005).
 * indigo-600 primary · emerald-600 money · amber-500 low-stock · rose-500 expiry · slate neutrals.
 */

export const colors = {
  primary: '#4F46E5', // indigo-600 — active nav, primary buttons
  primarySoft: '#EEF2FF', // indigo-50
  positive: '#059669', // emerald-600 — money, success
  positiveSoft: '#ECFDF5',
  warning: '#F59E0B', // amber-500 — low stock
  warningSoft: '#FFFBEB',
  danger: '#F43F5E', // rose-500 — expiry
  dangerSoft: '#FFF1F2',
  slate50: '#F8FAFC', // app background
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1', // borders
  slate400: '#94A3B8',
  slate500: '#64748B', // secondary text
  slate700: '#334155', // body text
  slate900: '#0F172A', // headings
  white: '#FFFFFF', // cards on slate-50
} as const;

export type ColorName = keyof typeof colors;

/** Font families (registered in app/_layout.tsx via expo-font, one family per weight). */
export const fonts = {
  sans: 'PlusJakartaSans-Regular',
  sansMedium: 'PlusJakartaSans-Medium',
  sansSemiBold: 'PlusJakartaSans-SemiBold',
  sansBold: 'PlusJakartaSans-Bold',
  sansExtraBold: 'PlusJakartaSans-ExtraBold',
  mono: 'JetBrainsMono-Regular',
  monoMedium: 'JetBrainsMono-Medium',
  monoSemiBold: 'JetBrainsMono-SemiBold',
} as const;

export const radius = {
  card: 12, // rounded-xl
  chip: 8,
  control: 10,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const typography = {
  title: 22,
  heading: 17,
  body: 15,
  caption: 13,
  micro: 11,
} as const;

/** Min touch target (NFR-6). */
export const touchTarget = 48;
