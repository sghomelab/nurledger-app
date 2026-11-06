/**
 * Secure key/value store for the Supabase session (refresh token = a long-lived
 * credential for the store's cloud data). Replaces the plaintext `sb:*` rows in
 * the SQLite `settings` table.
 *
 * Backend = the platform keystore (iOS Keychain / Android Keystore via
 * expo-secure-store), injected so the logic is unit-testable in node.
 *
 *  - CHUNKED: a Supabase session JSON (access JWT + refresh token + user) is
 *    ~2-4 KB, over the ~2 KB value size SecureStore documents/warns about on
 *    iOS. Values are split by UTF-8 BYTES (<= 1800) across `<key>.0..n` chunks
 *    plus a `<key>.n` count.
 *  - SAFE KEYS: SecureStore keys may only contain [A-Za-z0-9._-]; anything else
 *    is replaced with `_` (supabase keys like `sb-proj-auth-token` are fine).
 *  - INDEXED: SecureStore cannot list keys, so a small index key records every
 *    key written, which is what lets `clearAll` (disconnect / factory reset)
 *    really wipe the session.
 *  - MIGRATING: a value found in the legacy plaintext store is moved into the
 *    keystore on first read and DELETED from the legacy store.
 *  - FAILS CLOSED: if the keystore throws, getItem rethrows / setItem rethrows —
 *    it NEVER silently falls back to plaintext storage.
 */

export interface SecureBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

/** The plaintext store being migrated away from (the settings table shim). */
export interface LegacyKv {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

export interface SecureKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Delete every key this store ever wrote (disconnect / factory reset). */
  clearAll(): Promise<void>;
}

/** Max UTF-8 BYTES per stored chunk — under SecureStore's documented ~2048-byte value size. */
export const CHUNK_BYTES = 1800;

const utf8Len = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Split by UTF-8 byte budget on code-point boundaries (never splits a surrogate pair). */
export function chunkByBytes(value: string, maxBytes: number = CHUNK_BYTES): string[] {
  const chunks: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of value) {
    const n = utf8Len(ch.codePointAt(0)!);
    if (bytes + n > maxBytes) {
      chunks.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  if (cur || chunks.length === 0) chunks.push(cur);
  return chunks;
}
const INDEX_KEY = 'nl.kv.index';

export const safeKey = (k: string): string => `nl.${k.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export function createSecureKv(backend: SecureBackend, legacy?: LegacyKv): SecureKv {
  async function readIndex(): Promise<string[]> {
    const raw = await backend.get(INDEX_KEY);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  async function addToIndex(key: string): Promise<void> {
    const idx = await readIndex();
    if (!idx.includes(key)) await backend.set(INDEX_KEY, JSON.stringify([...idx, key]));
  }
  async function removeFromIndex(key: string): Promise<void> {
    const idx = await readIndex();
    if (idx.includes(key)) await backend.set(INDEX_KEY, JSON.stringify(idx.filter((k) => k !== key)));
  }

  async function readSecure(key: string): Promise<string | null> {
    const base = safeKey(key);
    const countRaw = await backend.get(`${base}.n`);
    if (countRaw == null) return null;
    const n = Number(countRaw);
    if (!Number.isInteger(n) || n < 0) return null;
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = await backend.get(`${base}.${i}`);
      if (part == null) return null; // torn write → treat as absent (user re-signs in)
      out += part;
    }
    return out;
  }

  async function writeSecure(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    const prevRaw = await backend.get(`${base}.n`);
    const prevN = prevRaw == null ? 0 : Number(prevRaw) || 0;
    const chunks = chunkByBytes(value);
    // chunks first, count LAST: a crash mid-write leaves the old (complete) value readable.
    for (let i = 0; i < chunks.length; i++) await backend.set(`${base}.${i}`, chunks[i]!);
    await backend.set(`${base}.n`, String(chunks.length));
    for (let i = chunks.length; i < prevN; i++) await backend.del(`${base}.${i}`);
    await addToIndex(key);
  }

  async function deleteSecure(key: string): Promise<void> {
    const base = safeKey(key);
    const prevRaw = await backend.get(`${base}.n`);
    const prevN = prevRaw == null ? 0 : Number(prevRaw) || 0;
    await backend.del(`${base}.n`);
    for (let i = 0; i < prevN; i++) await backend.del(`${base}.${i}`);
    await removeFromIndex(key);
  }

  return {
    async getItem(key) {
      const v = await readSecure(key);
      if (v != null) return v;
      if (legacy) {
        const old = await legacy.getItem(key);
        if (old != null) {
          await writeSecure(key, old); // write first…
          await legacy.removeItem(key); // …delete plaintext only after it is safely stored
          return old;
        }
      }
      return null;
    },
    async setItem(key, value) {
      await writeSecure(key, value);
      if (legacy) await legacy.removeItem(key); // never leave a stale plaintext copy
    },
    async removeItem(key) {
      await deleteSecure(key);
      if (legacy) await legacy.removeItem(key);
    },
    async clearAll() {
      for (const key of await readIndex()) await deleteSecure(key);
      await backend.del(INDEX_KEY);
    },
  };
}
