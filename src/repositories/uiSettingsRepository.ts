/**
 * UI settings repository — device-local, non-synced preferences.
 *
 * The `settings` key-value table (schema v6) is the home of per-device
 * choices that must NOT sync to the cloud (same table/pattern as
 * `receipt.width` in saleRepository). Currently holds:
 *   - `ui.language` — interface language, 'en' | 'ms' | 'fil' (FR-115).
 *
 * This is deliberately NOT the outlet's BUSINESS locale (`outlet.locale`):
 * that one drives the barcode parser, payment methods and tax engine and
 * changes only via store settings (FR-600/FR-602).
 */

import { getDb } from '../db/database';
import { deviceLang, resolveLang, type Lang } from '../i18n';

const UI_LANGUAGE_KEY = 'ui.language';

/** The stored UI language, normalized (unknown/absent → 'en'). */
export async function getUiLanguage(): Promise<Lang> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = '${UI_LANGUAGE_KEY}'`,
  );
  // No saved choice yet → follow the device language (ms / fil), else English. An explicit choice always wins.
  return row?.value ? resolveLang(row.value) : deviceLang();
}

export async function setUiLanguage(lang: Lang): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
    UI_LANGUAGE_KEY,
    lang,
  ]);
}

// ── Theme (issue #22) ────────────────────────────────────────────────────────

export type UiTheme = 'system' | 'light' | 'dark';
const UI_THEME_KEY = 'ui.theme';

/** The stored theme choice; unknown/absent → 'light' (the app's default look). */
export async function getUiTheme(): Promise<UiTheme> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = '${UI_THEME_KEY}'`,
  );
  const v = row?.value;
  return v === 'dark' || v === 'system' ? v : 'light';
}

export async function setUiTheme(theme: UiTheme): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
    UI_THEME_KEY,
    theme,
  ]);
}

// ── Register auto-lock (issue #26 design §5) ────────────────────────────────

/** Allowed timeouts in minutes. 0 = Never. Default (unknown/absent) = 5. */
export const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 30] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number];
export const AUTO_LOCK_DEFAULT: AutoLockMinutes = 5;
const AUTO_LOCK_KEY = 'ui.auto_lock_minutes';

/** The stored auto-lock timeout; a non-allowlisted stored value falls back to 5. */
export async function getAutoLockMinutes(): Promise<AutoLockMinutes> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = '${AUTO_LOCK_KEY}'`,
  );
  const n = row ? Number(row.value) : NaN;
  return (AUTO_LOCK_CHOICES as readonly number[]).includes(n)
    ? (n as AutoLockMinutes)
    : AUTO_LOCK_DEFAULT;
}

export async function setAutoLockMinutes(mins: AutoLockMinutes): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
    AUTO_LOCK_KEY,
    String(mins),
  ]);
}
