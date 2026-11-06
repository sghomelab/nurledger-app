/**
 * Cloud config repository (ADR-010, BYO) — the only module that reads/writes the
 * `cloud.*` settings + the Supabase SDK session KV.
 *
 * BYO model: every value here belongs to the STORE's own project (its URL, its
 * anon key, the signed-in user's email). The app never talks to a
 * creator-operated backend and — since schema v7 — never asks for, stores or
 * uses the project's `service_role` key (provisioning/joining go through
 * SECURITY DEFINER functions guarded by claim / invite codes). A key stored by
 * an OLDER build is deleted from the device on first read (`scrubLegacyServiceKey`).
 *
 * Sync is OFF by default: `cloud.sync_enabled` missing or '0' = off. Off = the
 * engine is idle; the outbox keeps queueing and nothing is dropped.
 */

import { getDb } from '../db/database';
import type { CloudConfig } from '../lib/cloud/types';
import type { KeyValueStorage } from '../lib/cloud/supabaseAdapter';
import { createSecureKv } from '../lib/secureKv';
import { expoSecureBackend } from '../lib/secureKvBackend';

const K = {
  url: 'cloud.url',
  anonKey: 'cloud.anon_key',
  /** LEGACY (pre-v7 builds stored the service_role key here). Only ever deleted. */
  legacyServiceKey: 'cloud.service_key',
  ownerEmail: 'cloud.owner_email',
  /** The TENANT outlet id (cloud row). May differ from the local outlet id
   *  when this device joined an existing store (multi-device, ADR-007). */
  outletId: 'cloud.outlet_id',
  syncEnabled: 'cloud.sync_enabled',
  lastSyncedAt: 'cloud.last_synced_at',
  lastError: 'cloud.last_error',
  lastErrorAt: 'cloud.last_error_at',
} as const;

async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string } | null>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  return row ? row.value : null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

async function deleteSetting(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
}

/**
 * Delete a `service_role` key persisted by a pre-v7 build. Cheap (one DELETE),
 * idempotent, and run on every config read so no code path can leave it behind.
 * The key itself stays valid server-side: the owner should ROTATE it in the
 * Supabase dashboard (Settings → API) — the app cannot do that for them.
 */
export async function scrubLegacyServiceKey(): Promise<void> {
  await deleteSetting(K.legacyServiceKey);
}

/** The stored BYO connection, or null when not connected. */
export async function getCloudConfig(): Promise<CloudConfig | null> {
  await scrubLegacyServiceKey();
  const [url, anonKey, ownerEmail, tenantOutletId] = await Promise.all([
    getSetting(K.url),
    getSetting(K.anonKey),
    getSetting(K.ownerEmail),
    getSetting(K.outletId),
  ]);
  if (!url || !anonKey) return null;

  const db = await getDb();
  const outlet = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outlet) return null;

  return {
    url,
    anonKey,
    // The cloud TENANT id — the local id when this device created the store,
    // the joined store's id otherwise. Fall back to the local id for
    // connections saved before the field existed.
    outletId: tenantOutletId ?? outlet.id,
    ownerEmail: ownerEmail ?? undefined,
  };
}

/** Store the BYO connection (wizard completion). */
export async function saveCloudConfig(cfg: {
  url: string;
  anonKey: string;
  ownerEmail?: string;
  /** The tenant outlet id returned by provisionStore (create-or-join). */
  outletId?: string;
}): Promise<void> {
  await setSetting(K.url, cfg.url.trim());
  await setSetting(K.anonKey, cfg.anonKey.trim());
  await deleteSetting(K.legacyServiceKey); // never persisted by this build
  if (cfg.ownerEmail) await setSetting(K.ownerEmail, cfg.ownerEmail.trim());
  if (cfg.outletId) await setSetting(K.outletId, cfg.outletId.trim());
}

/**
 * Disconnect (FR-503): removes the connection + the SDK session from this
 * device. Device data (sales, stock, outbox) is NEVER touched — a reconnect
 * resumes from the stored cursors.
 */
export async function disconnectCloud(): Promise<void> {
  await deleteSetting(K.url);
  await deleteSetting(K.anonKey);
  await deleteSetting(K.legacyServiceKey);
  await deleteSetting(K.ownerEmail);
  await deleteSetting(K.outletId);
  await deleteSetting(K.syncEnabled);
  await deleteSetting(K.lastSyncedAt);
  await deleteSetting(K.lastError);
  await deleteSetting(K.lastErrorAt);
  await clearStoredSession();
}

/** Sync toggle — OFF by default (key missing = off). */
export async function isSyncEnabled(): Promise<boolean> {
  const v = await getSetting(K.syncEnabled);
  return v === '1';
}

export async function setSyncEnabled(on: boolean): Promise<void> {
  await setSetting(K.syncEnabled, on ? '1' : '0');
}

export async function getLastSyncedAt(): Promise<number | null> {
  const v = await getSetting(K.lastSyncedAt);
  return v ? Number(v) : null;
}

export async function setLastSyncedAt(ts: number): Promise<void> {
  await setSetting(K.lastSyncedAt, String(ts));
}

export async function recordSyncError(message: string): Promise<void> {
  await setSetting(K.lastError, message.slice(0, 500));
  await setSetting(K.lastErrorAt, String(Date.now()));
}

export async function clearSyncError(): Promise<void> {
  await deleteSetting(K.lastError);
  await deleteSetting(K.lastErrorAt);
}

export async function getLastSyncError(): Promise<{ message: string; at: number } | null> {
  const message = await getSetting(K.lastError);
  if (!message) return null;
  const at = await getSetting(K.lastErrorAt);
  return { message, at: at ? Number(at) : 0 };
}

// ---------------------------------------------------------------------------
// Supabase SDK session storage — the refresh token lives in the platform
// KEYSTORE (iOS Keychain / Android Keystore), NOT in the SQLite settings table.
// A session left in plaintext `sb:*` rows by an older build is migrated into the
// keystore on first read and deleted from SQLite (see lib/secureKv.ts).
// ---------------------------------------------------------------------------

export const SB_SESSION_KEY = 'sb:session';

/** The legacy plaintext shim — now only a migration source / delete target. */
const legacySdkStorage = {
  async getItem(key: string) {
    return getSetting(`sb:${key}`);
  },
  async removeItem(key: string) {
    await deleteSetting(`sb:${key}`);
  },
};

const secureKv = createSecureKv(expoSecureBackend, legacySdkStorage);

export const sdkStorage: KeyValueStorage = {
  getItem: (key) => secureKv.getItem(key),
  setItem: (key, value) => secureKv.setItem(key, value),
  removeItem: (key) => secureKv.removeItem(key),
};

/**
 * Wipe the stored session from the keystore AND any plaintext remnants
 * (disconnect + factory reset). Safe to call when nothing is stored.
 */
export async function clearSecureSession(): Promise<void> {
  await secureKv.clearAll();
}

export async function clearStoredSession(): Promise<void> {
  await clearSecureSession();
  const db = await getDb();
  await db.runAsync("DELETE FROM settings WHERE key LIKE 'sb:%'");
}
