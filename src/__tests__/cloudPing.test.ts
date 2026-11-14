import { createSupabaseAdapter, type KeyValueStorage } from '../lib/cloud/supabaseAdapter';
import type { CloudConfig } from '../lib/cloud/types';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const memStorage: KeyValueStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
};

const cfg: CloudConfig = { url: 'https://xyz.supabase.co/', anonKey: 'anon-jwt', outletId: 'o1' };

const fetchMock = jest.fn();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/**
 * Regression: hosted Supabase key-auths EVERY path at the gateway, including
 * /auth/v1/health — a keyless probe 401s ("api identity required") on a
 * perfectly valid project, which made the connect wizard's "Check connection"
 * step impossible against any real (hosted) BYO project. The probe must carry
 * the anon key (safe to ship) as apikey + Bearer.
 */
describe('adapter.ping (hosted Supabase gateway identity)', () => {
  it('sends the anon key as apikey + Bearer on the health probe', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await createSupabaseAdapter(memStorage).ping(cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://xyz.supabase.co/auth/v1/health'); // trailing slash normalized
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.apikey).toBe('anon-jwt');
    expect(headers.Authorization).toBe('Bearer anon-jwt');
  });

  it('resolves true on 200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    expect(await createSupabaseAdapter(memStorage).ping(cfg)).toBe(true);
  });

  it('surfaces non-2xx with the real status (401 = bad/missing key on hosted)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(createSupabaseAdapter(memStorage).ping(cfg)).rejects.toThrow(
      'Backend unreachable: HTTP 401',
    );
  });

  it('surfaces network failures as unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));
    await expect(createSupabaseAdapter(memStorage).ping(cfg)).rejects.toThrow(
      'Backend unreachable: fetch failed',
    );
  });
});
