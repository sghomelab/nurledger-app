import { layoutFor, APP_MAX_WIDTH } from '../lib/layout';

describe('layoutFor', () => {
  it('phones (portrait) are compact, single column, single pane', () => {
    const l = layoutFor(390, 844);
    expect(l).toMatchObject({ isTablet: false, sizeClass: 'compact', twoPane: false, columns: 1 });
  });
  it('a phone in LANDSCAPE stays on the phone layout (shortest side < 600)', () => {
    const l = layoutFor(932, 430);
    expect(l).toMatchObject({ isTablet: false, twoPane: false, columns: 1 });
  });
  it('small tablet portrait (600×960): tablet but not wide enough for two panes', () => {
    const l = layoutFor(600, 960);
    expect(l).toMatchObject({ isTablet: true, sizeClass: 'medium', twoPane: false, columns: 1 });
  });
  it('iPad portrait (820×1180) → two panes, 2 columns', () => {
    const l = layoutFor(820, 1180);
    expect(l).toMatchObject({ isTablet: true, sizeClass: 'medium', twoPane: true, columns: 2 });
  });
  it('iPad landscape (1180×820) → expanded, 3 columns', () => {
    const l = layoutFor(1180, 820);
    expect(l).toMatchObject({ isTablet: true, sizeClass: 'expanded', twoPane: true, columns: 3 });
  });
  it('iPad split view that narrows the window collapses back (e.g. 507×1024 → short side < 600)', () => {
    expect(layoutFor(507, 1024)).toMatchObject({ isTablet: false, twoPane: false, columns: 1 });
  });
  it('cart pane width is clamped to a readable range and never exceeds the app max width logic', () => {
    expect(layoutFor(720, 800).cartPaneWidth).toBe(340);
    expect(layoutFor(1366, 1024).cartPaneWidth).toBeLessThanOrEqual(480);
    expect(layoutFor(3000, 2000).cartPaneWidth).toBe(Math.round(Math.min(480, APP_MAX_WIDTH * 0.38)));
  });
  it('is safe on zero / negative sizes (first layout pass)', () => {
    expect(layoutFor(0, 0)).toMatchObject({ isTablet: false, twoPane: false, columns: 1 });
    expect(layoutFor(-5, 10).width).toBe(0);
  });
});
