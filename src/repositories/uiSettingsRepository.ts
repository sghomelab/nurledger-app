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
