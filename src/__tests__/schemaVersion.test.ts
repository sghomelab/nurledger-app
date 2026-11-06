import { createSupabaseAdapter, isTableMissingError, isFunctionMissingError, formatInviteCode } from '../lib/cloud/supabaseAdapter';
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
  outletId: 'outlet-1',
});

/** Fake supabase client: .rpc(fn, args) → result (and records the calls). */
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
function fakeClient(result: { data?: unknown; error?: unknown }, user: unknown = { id: 'u1' }) {
  return {
    rpc: async (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args });
      return result;
    },
    auth: {
      signUp: jest.fn(), signInWithPassword: jest.fn(), signOut: jest.fn(),
      getUser: async () => ({ data: { user: user }, error: null }),
    },
  };
}

const adapterFor = (result: { data?: unknown; error?: unknown }, user: unknown = { id: 'u1' }) => {
  rpcCalls.length = 0;
  mockCreateClient.mockReturnValue(fakeClient(result, user));
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

  it('PGRST202 / 42883 (pre-v7 project: no nurledger_schema_version function) → null = "paste the current SQL"', async () => {
    const a = adapterFor({ error: { code: 'PGRST202', message: 'Could not find the function public.nurledger_schema_version without parameters in the schema cache' } });
    expect(await a.schemaVersion(cfgFor())).toBeNull();
    const b = adapterFor({ error: { code: '42883', message: 'function nurledger_schema_version() does not exist' } });
    expect(await b.schemaVersion(cfgFor())).toBeNull();
  });

  it('bad anon key (PGRST301) → REJECTS with the real error text (no false "schema not deployed")', async () => {
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
    const a = adapterFor({ data: 7 });
    expect(await a.schemaVersion(cfgFor())).toBe(7);
    expect(rpcCalls[0]!.fn).toBe('nurledger_schema_version');
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

describe('isFunctionMissingError', () => {
  it.each([
    [{ code: 'PGRST202', message: 'x' }, true],
    [{ code: '42883', message: 'x' }, true],
    [{ message: 'Could not find the function public.foo in the schema cache' }, true],
    [{ code: 'PGRST301', message: 'Invalid JWT' }, false],
    [null, false],
  ])('%j → %s', (e, want) => expect(isFunctionMissingError(e as never)).toBe(want));
});

describe('adapter.provisionStore / createInvite (no service key)', () => {
  const outlet = { id: 'o1', name: 'Shop', currency: 'MYR', locale: 'en', taxEngine: 'x' };

  it('create: sends the claim, never a service key, and returns the tenant id', async () => {
    const a = adapterFor({ data: 'o1' });
    expect(await a.provisionStore(cfgFor(), outlet, { claim: 'ABCD1234EF567890' })).toBe('o1');
    expect(rpcCalls[0]!.fn).toBe('provision_store');
    expect(rpcCalls[0]!.args).toEqual({
      p: { outlet: { id: 'o1', name: 'Shop', currency: 'MYR', locale: 'en', tax_engine: 'x' }, claim: 'ABCD1234EF567890', invite: null },
    });
    // the client is built with the ANON key only
    expect(mockCreateClient.mock.calls.every((c) => c[1] === 'anon-key')).toBe(true);
  });

  it('join: sends the invite and returns the tenant outlet id (may differ from local)', async () => {
    const a = adapterFor({ data: 'tenant-9' });
    expect(await a.provisionStore(cfgFor(), outlet, { invite: 'AAAA-BBBB-CCCC-DDDD' })).toBe('tenant-9');
    expect((rpcCalls[0]!.args as { p: { invite: string } }).p.invite).toBe('AAAA-BBBB-CCCC-DDDD');
  });

  it('surfaces the server message (bad invite) and refuses when not signed in', async () => {
    const bad = adapterFor({ error: { message: 'Invalid or expired invite code' } });
    await expect(bad.provisionStore(cfgFor(), outlet, { invite: 'x' })).rejects.toThrow('Invalid or expired invite code');
    const anon = adapterFor({ data: 'o1' }, null);
    await expect(anon.provisionStore(cfgFor(), outlet, { claim: 'x' })).rejects.toThrow(/Not signed in/);
    expect(rpcCalls).toHaveLength(0);
  });

  it('createInvite formats the code for display and clamps nothing client-side', async () => {
    const a = adapterFor({ data: 'ABCD1234EF567890' });
    expect(await a.createInvite(cfgFor(), 12)).toBe('ABCD-1234-EF56-7890');
    expect(rpcCalls[0]).toEqual({ fn: 'create_invite', args: { p_hours: 12 } });
  });
});

describe('formatInviteCode', () => {
  it('groups by 4, uppercases, tolerates dashes/spaces', () => {
    expect(formatInviteCode('abcd1234ef567890')).toBe('ABCD-1234-EF56-7890');
    expect(formatInviteCode('ABCD-1234-EF56-7890')).toBe('ABCD-1234-EF56-7890');
    expect(formatInviteCode('abc')).toBe('ABC');
  });
});
