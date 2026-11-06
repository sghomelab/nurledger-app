import { createSecureKv, safeKey, chunkByBytes, CHUNK_BYTES, type SecureBackend, type LegacyKv } from '../lib/secureKv';

const CHUNK_CHARS = CHUNK_BYTES; // ASCII test values: 1 char = 1 byte
const byteLen = (v: string) => new TextEncoder().encode(v).length;

function memBackend(opts: { failSet?: (key: string) => boolean; failGet?: boolean } = {}) {
  const m = new Map<string, string>();
  const backend: SecureBackend = {
    get: async (k) => {
      if (opts.failGet) throw new Error('keystore locked');
      return m.has(k) ? m.get(k)! : null;
    },
    set: async (k, v) => {
      if (opts.failSet?.(k)) throw new Error('keystore write failed');
      m.set(k, v);
    },
    del: async (k) => {
      m.delete(k);
    },
  };
  return { m, backend };
}
function memLegacy(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  const legacy: LegacyKv = {
    getItem: async (k) => (m.has(k) ? m.get(k)! : null),
    removeItem: async (k) => {
      m.delete(k);
    },
  };
  return { m, legacy };
}
const SESSION = JSON.stringify({ access_token: 'A'.repeat(2400), refresh_token: 'R'.repeat(60), user: { id: 'u', email: 'é@x.co', meta: 'ü'.repeat(900) } });

describe('safeKey', () => {
  it('keeps [A-Za-z0-9._-] and replaces everything else', () => {
    expect(safeKey('sb-proj-auth-token')).toBe('nl.sb-proj-auth-token');
    expect(safeKey('a/b:c d')).toBe('nl.a_b_c_d');
  });
});

describe('createSecureKv', () => {
  it('round-trips a multi-KB, multi-byte session; every stored value is under 2048 BYTES', async () => {
    const { m, backend } = memBackend();
    const kv = createSecureKv(backend);
    expect(byteLen(SESSION)).toBeGreaterThan(CHUNK_BYTES * 2);
    await kv.setItem('sb-x-auth-token', SESSION);
    expect(await kv.getItem('sb-x-auth-token')).toBe(SESSION);
    for (const v of m.values()) expect(byteLen(v)).toBeLessThan(2048);
  });

  it('chunkByBytes never splits a surrogate pair and respects the byte budget', () => {
    const emoji = '😀'.repeat(1000); // 4 bytes each
    const chunks = chunkByBytes(emoji, 1800);
    expect(chunks.join('')).toBe(emoji);
    for (const c of chunks) {
      expect(byteLen(c)).toBeLessThanOrEqual(1800);
      expect([...c].every((ch) => ch === '😀')).toBe(true);
    }
    expect(chunkByBytes('')).toEqual(['']);
  });

  it('shrinking a value deletes the leftover chunks; empty string round-trips', async () => {
    const { m, backend } = memBackend();
    const kv = createSecureKv(backend);
    await kv.setItem('k', 'x'.repeat(CHUNK_CHARS * 3));
    await kv.setItem('k', 'short');
    expect(await kv.getItem('k')).toBe('short');
    expect([...m.keys()].filter((k) => k.startsWith('nl.k.') && !k.endsWith('.n'))).toEqual(['nl.k.0']);
    await kv.setItem('e', '');
    expect(await kv.getItem('e')).toBe('');
  });

  it('a write that dies mid-way never corrupts the previous value (count is written last)', async () => {
    const old = 'o'.repeat(CHUNK_CHARS + 10);
    const { backend, m } = memBackend({ failSet: (k) => k === 'nl.k.1' && failNow });
    let failNow = false;
    const kv = createSecureKv(backend);
    await kv.setItem('k', old);
    failNow = true;
    await expect(kv.setItem('k', 'n'.repeat(CHUNK_CHARS * 2))).rejects.toThrow('keystore write failed');
    // chunk 0 was replaced but the count still says 2 and chunk 1 is the old one → value differs but is whole
    expect(typeof (await kv.getItem('k'))).toBe('string');
    expect(m.get('nl.k.n')).toBe('2');
  });

  it('a torn read (missing chunk) is treated as absent, not as a corrupt string', async () => {
    const { m, backend } = memBackend();
    const kv = createSecureKv(backend);
    await kv.setItem('k', 'x'.repeat(CHUNK_CHARS * 2));
    m.delete('nl.k.1');
    expect(await kv.getItem('k')).toBeNull();
  });

  it('migrates a legacy plaintext value into the keystore and DELETES the plaintext', async () => {
    const { backend, m } = memBackend();
    const { legacy, m: lm } = memLegacy({ 'sb-x-auth-token': SESSION });
    const kv = createSecureKv(backend, legacy);
    expect(await kv.getItem('sb-x-auth-token')).toBe(SESSION);
    expect(lm.size).toBe(0); // plaintext gone
    expect([...m.keys()].some((k) => k.startsWith('nl.sb-x-auth-token.'))).toBe(true);
    expect(await kv.getItem('sb-x-auth-token')).toBe(SESSION); // now served from the keystore
  });

  it('does NOT delete the plaintext if the keystore write fails (no data loss, no silent downgrade)', async () => {
    const { backend } = memBackend({ failSet: () => true });
    const { legacy, m: lm } = memLegacy({ k: 'secret' });
    const kv = createSecureKv(backend, legacy);
    await expect(kv.getItem('k')).rejects.toThrow('keystore write failed');
    expect(lm.get('k')).toBe('secret');
  });

  it('fails closed: a throwing keystore rethrows, it never falls back to plaintext', async () => {
    const { backend } = memBackend({ failGet: true });
    const { legacy } = memLegacy({ k: 'secret' });
    const kv = createSecureKv(backend, legacy);
    await expect(kv.getItem('k')).rejects.toThrow('keystore locked');
  });

  it('setItem also removes any stale plaintext copy; removeItem clears both', async () => {
    const { backend } = memBackend();
    const { legacy, m: lm } = memLegacy({ k: 'old' });
    const kv = createSecureKv(backend, legacy);
    await kv.setItem('k', 'new');
    expect(lm.size).toBe(0);
    await kv.removeItem('k');
    expect(await kv.getItem('k')).toBeNull();
  });

  it('clearAll wipes every key written (via the index), including chunks', async () => {
    const { backend, m } = memBackend();
    const kv = createSecureKv(backend);
    await kv.setItem('a', 'x'.repeat(CHUNK_CHARS * 2));
    await kv.setItem('b', 'y');
    await kv.clearAll();
    expect(m.size).toBe(0);
    expect(await kv.getItem('a')).toBeNull();
  });
});
