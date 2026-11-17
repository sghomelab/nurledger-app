import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { colors, colorsDark, type Palette } from './tokens';
import { getUiTheme, setUiTheme, type UiTheme } from '../repositories/uiSettingsRepository';

interface ThemeContextValue {
  /** The stored choice — 'system' follows the device scheme. */
  theme: UiTheme;
  /** The resolved dark/light state. */
  isDark: boolean;
  /** The active palette — screens style with this, never with the raw token objects. */
  colors: Palette;
  setTheme: (t: UiTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Theme provider (issue #22) — light/dark/system, persisted device-local in
 * the `settings` table.
 *
 * Mount it AFTER the DB bootstrap gate (the choice is read from SQLite, and
 * this app is offline-first — no theme fetch, no network). Default is 'light'
 * until the stored value loads, so first paint matches the app's historic look.
 *
 * Screens convert styles to a per-theme build (`useMemo` keyed on `colors`)
 * because `StyleSheet.create` at module scope would freeze light values.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [theme, setThemeState] = useState<UiTheme>('light');

  useEffect(() => {
    let cancelled = false;
    void getUiTheme().then((t) => {
      if (!cancelled) setThemeState(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((t: UiTheme) => {
    setThemeState(t);
    void setUiTheme(t);
  }, []);

  const isDark = theme === 'dark' || (theme === 'system' && systemScheme === 'dark');
  const value = useMemo<ThemeContextValue>(
    () => ({ theme, isDark, colors: isDark ? colorsDark : colors, setTheme }),
    [theme, isDark, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
