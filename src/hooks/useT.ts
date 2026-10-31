/**
 * useT — the bound translator for the DEVICE UI language (FR-115).
 *
 * The language is device-local (`settings['ui.language']` via
 * uiSettingsRepository), independent of the outlet's BUSINESS locale
 * (barcode parser / payment methods / tax engine read `outlet.locale`).
 *
 * Behavior:
 * - The active language lives in a module-level external store. Every
 *   mounted `useT` instance (including the root layout, whose header
 *   titles render from it) updates the INSTANT the language changes —
 *   setLanguage notifies all subscribers, so the Settings header flips
 *   live, not on the next navigation.
 * - A module-level seed (cachedLang) carries the value across mounts, so a
 *   screen mounted AFTER the language was first loaded renders in the right
 *   language from frame one (no English flash); same module-state precedent
 *   as sharedLowStock.
 * - useFocusEffect re-reads the setting on every focus, so a change made in
 *   Settings is picked up by every tab when you return (same mechanism as
 *   useOutlet after a store-settings save).
 * - setLanguage persists immediately and applies live (device-local
 *   preference — no PIN gate, same as receipt width).
 */

import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { getUiLanguage, setUiLanguage } from '../repositories/uiSettingsRepository';
import { bindT, type Lang, type TFn } from '../i18n';

let cachedLang: Lang = 'en';
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useT(): { t: TFn; lang: Lang; setLanguage: (lang: Lang) => Promise<void> } {
  const lang = useSyncExternalStore(subscribe, () => cachedLang);

  useFocusEffect(
    useCallback(() => {
      void getUiLanguage().then((l) => {
        if (l !== cachedLang) {
          cachedLang = l;
          emit();
        }
      });
    }, []),
  );

  const t = useCallback<TFn>((key, vars) => bindT(lang)(key, vars), [lang]);

  const setLanguage = useCallback(async (l: Lang) => {
    await setUiLanguage(l);
    cachedLang = l;
    emit();
  }, []);

  return { t, lang, setLanguage };
}
