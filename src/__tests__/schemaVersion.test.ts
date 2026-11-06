import { createSupabaseAdapter, isTableMissingError } from '../lib/cloud/supabaseAdapter';
import type { CloudConfig } from '../lib/cloud/types';

const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const storage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

/** One distinct project URL per test: the adapter caches clients per url::key. */
let hostSeq = 0;
const cfgFor = (): CloudConfig => ({
  url: `https://proj${hostSeq++}.supabase.co`,
  anonKey: 'anon-key',
  serviceKey: 'service-key',
  outletId: 'outlet-1',
});

/** Fake supabase client: .from(t).select(c).order(c,o).limit(n) → result. */
function fakeClient(result: { data?: unknown; error?: unknown }) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        order: (_col: string, _opts?: unknown) => ({
          limit: async () => result,
        }),
      }),
    }),
    auth: { signUp: jest.fn(), signInWithPassword: jest.fn(), signOut: jest.fn(), getUser: jest.fn() },
  };
}

const adapterFor = (result: { data?: unknown; error?: unknown }) => {
  mockCreateClient.mockReturnValue(fakeClient(result));
  return createSupabaseAdapter(storage);
};

describe('adapter.schemaVersion — error classification (wizard UX)', () => {
  it('PGRST205 (table missing) → null = "schema not deployed"', async () => {
    const a = adapterFor({
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.cloud_schema_meta' in the schema cache",
        details: 'The table is not in the schema cache because it does not exist, it belongs to another schema, or its schema is not in the exposed list.',
        hint: null,
      },
    });
    expect(await a.schemaVersion(cfgFor())).toBeNull();
  });

  it('Postgres 42P01 undefined_table → null = "schema not deployed"', async () => {
    const a = adapterFor({
      error: {
        code: '42P01',
        message: 'relation "cloud_schema_meta" does not exist',
        details: null,
        hint: null,
      },
    });
    expect(await a.schemaVersion(cfgFor())).toBeNull();
  });

  it('bad service key (PGRST301) → REJECTS with the real error text (no false "schema not deployed")', async () => {
    const a = adapterFor({
      error: {
        code: 'PGRST301',
        message: 'Invalid JWT token. Expected 12, got 5 parts.',
        details: null,
        hint: null,
      },
    });
    await expect(a.schemaVersion(cfgFor())).rejects.toThrow(
      'Schema check failed: Invalid JWT token. Expected 12, got 5 parts.',
    );
  });

  it('network failure → REJECTS with the real error text', async () => {
    const a = adapterFor({ error: { message: 'fetch failed' } });
    await expect(a.schemaVersion(cfgFor())).rejects.toThrow('Schema check failed: fetch failed');
  });

  it('deploys fine → returns the deployed version', async () => {
    const a = adapterFor({ data: [{ version: 6 }] });
    expect(await a.schemaVersion(cfgFor())).toBe(6);
  });
});

describe('isTableMissingError', () => {
  it.each([
    [{ code: 'PGRST205', message: 'Could not find the table in the schema cache' }, true],
    [{ code: '42P01', message: 'relation "cloud_schema_meta" does not exist' }, true],
    [{ message: 'relation cloud_schema_meta does not exist' }, true],
    [{ code: 'PGRST301', message: 'Invalid JWT token' }, false],
    [{ message: 'fetch failed' }, false],
    [{ code: 'PGRST116', message: 'Row level security policy: row not returned by the policy' }, false],
    [{ code: 'PGRST204', message: 'The result contains more than 1000 rows' }, false],
  ])('%j → %s', (e, expected) => {
    expect(isTableMissingError(e as never)).toBe(expected);
  });
});
