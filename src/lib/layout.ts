/**
 * Responsive layout helpers (pure — unit-tested; the hook in hooks/useLayout.ts
 * feeds them the window size).
 *
 * A device is "tablet class" when its SHORTEST side is ≥ 600 dp (Android's
 * sw600dp rule; every iPad). Using the shortest side keeps a phone held in
 * landscape (e.g. 850×400) on the phone layout instead of a cramped two-pane.
 */
export const TABLET_MIN_SHORT_SIDE = 600;
/** Width at which the register switches to catalogue + cart side by side. */
export const TWO_PANE_MIN_WIDTH = 720;
/** Widest readable column for forms / detail screens. */
export const FORM_MAX_WIDTH = 720;
/** Widest the whole app is laid out (very large iPads / desktops). */
export const APP_MAX_WIDTH = 1280;

export type SizeClass = 'compact' | 'medium' | 'expanded';

export interface LayoutInfo {
  width: number;
  height: number;
  /** Shortest side ≥ 600 dp. */
  isTablet: boolean;
  sizeClass: SizeClass;
  /** Register: catalogue + cart side by side. */
  twoPane: boolean;
  /** Columns for card/list grids (1 on phones). */
  columns: 1 | 2 | 3;
  /** Width of the right-hand cart pane in two-pane mode. */
  cartPaneWidth: number;
}

export function layoutFor(width: number, height: number): LayoutInfo {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const isTablet = Math.min(w, h) >= TABLET_MIN_SHORT_SIDE;
  const usable = Math.min(w, APP_MAX_WIDTH);
  const sizeClass: SizeClass = !isTablet ? 'compact' : usable >= 1000 ? 'expanded' : 'medium';
  const twoPane = isTablet && usable >= TWO_PANE_MIN_WIDTH;
  const columns: 1 | 2 | 3 = !isTablet ? 1 : usable >= 1000 ? 3 : usable >= TWO_PANE_MIN_WIDTH ? 2 : 1;
  // ~38% of the usable width, clamped so the cart stays readable and the
  // catalogue keeps the larger share.
  const cartPaneWidth = Math.round(Math.min(480, Math.max(340, usable * 0.38)));
  return { width: w, height: h, isTablet, sizeClass, twoPane, columns, cartPaneWidth };
}

/** Centered, width-capped column for forms and detail screens (apply to ScrollView contentContainerStyle). */
export const centeredColumn = { alignSelf: 'center', width: '100%', maxWidth: FORM_MAX_WIDTH } as const;
/** Wider cap for dashboards (Insights, Shift) that lay out KPI grids. */
export const wideColumn = { alignSelf: 'center', width: '100%', maxWidth: 1000 } as const;
