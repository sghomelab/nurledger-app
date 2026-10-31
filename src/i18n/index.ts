/**
 * i18n core (FR-115) — pure module: no RN, no DB, no network (module-map
 * rule: `src/lib`-style purity so the logic is unit-testable in Node).
 *
 * Design notes (M6):
 * - The UI language is a DEVICE-LOCAL setting (`settings['ui.language']`),
 *   NEVER the outlet's BUSINESS locale — `outlet.locale` drives the barcode
 *   parser, payment-method list and cloud provisioning and must not change
 *   when the operator switches interface language.
 * - English is the reference/fallback: a key missing from `ms` renders the
 *   English value (never a raw key in production UI), and an unknown stored
 *   value resolves to English.
 */
import en from './en';
import ms from './ms';

export type Lang = 'en' | 'ms';
export type MsgKey = keyof typeof en;
export type TFn = (key: MsgKey, vars?: Record<string, string | number>) => string;

export const enDict: Record<MsgKey, string> = en;
export const msDict: Record<MsgKey, string> = ms;

/**
 * Map a stored UI-language value (or any raw tag) to a supported language.
 * 'ms' / 'ms-MY' / 'msa' → Malay; anything else (including null/unknown) →
 * English. Lenient on purpose — the setting is a plain TEXT column.
 */
export function resolveLang(value: string | null | undefined): Lang {
  if (!value) return 'en';
  const base = value.trim().toLowerCase().split('-')[0] ?? '';
  return base === 'ms' || base === 'msa' ? 'ms' : 'en';
}

/**
 * Translate `key` for `lang` with `{param}` interpolation.
 * Lookup order: active language → English → the key itself (last resort so
 * a typo'd key is visible rather than blank).
 */
export function t(lang: Lang, key: MsgKey, vars?: Record<string, string | number>): string {
  const active = lang === 'ms' ? msDict[key] : enDict[key];
  const template = active ?? enDict[key] ?? String(key);
  if (!vars) return template;
  let out = template;
  for (const [name, v] of Object.entries(vars)) {
    out = out.split(`{${name}}`).join(String(v));
  }
  return out;
}

/** A bound translator for a fixed language (used by useT and tests). */
export function bindT(lang: Lang): TFn {
  return (key, vars) => t(lang, key, vars);
}
