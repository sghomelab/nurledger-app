/**
 * Run with: npm run test:cloud-schema   (Node >= 22.6, needs devDependency
 * @electric-sql/pglite). NOT part of `jest`: PGlite loads its WASM via dynamic
 * import, which jest's VM sandbox rejects without --experimental-vm-modules.
 *
 * The BYO cloud schema bundle executed on a REAL Postgres engine (PGlite =
 * Postgres compiled to WASM, in-process). The string-level guards in
 * src/__tests__/cloudSchema.test.ts cannot see runtime errors or privilege
 * leaks; this suite caught all four v4 defects:
 *   1. a FRESH deploy aborted ("relation public.category does not exist");
 *   2. apply_product's duplicate-SKU handler raised "column reference
 *      outlet_id is ambiguous" (stalls the client's FIFO drain);
 *   3. any signed-in user could INSERT themselves into org_member and then
 *      read/write the store (member_insert_self policy);
 *   4. `anon` (public key) could read stock_view across tenants.
 *
 * Supabase pieces are stubbed: roles anon/authenticated/service_role, the
 * auth schema, and auth.uid() (reads request.jwt.claim.sub).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { CLOUD_SCHEMA_SQL, CLOUD_SCHEMA_VERSION } from '../src/lib/cloud/schemaSql.ts';

const U_OWNER = '11111111-1111-1111-1111-111111111111';
const U_STRANGER = '22222222-2222-2222-2222-222222222222';

async function boot() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    -- stock Supabase default privileges: new public tables are open to anon/authenticated
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  `);
  await db.exec(CLOUD_SCHEMA_SQL);
  await db.exec(`
    INSERT INTO auth.users VALUES ('${U_OWNER}'), ('${U_STRANGER}');
    INSERT INTO public.outlet (id, name, currency, locale, tax_engine) VALUES ('O1', 'Shop', 'MYR', 'en', 'sst');
    INSERT INTO public.org_member (org_id, user_id, role) VALUES ('O1', '${U_OWNER}', 'owner');
  `);
  return db;
}

async function as(db, role, uid, sql, params = []) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try {
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows  };
  } catch (e) {
    return { ok: false, err: e.message };
  } finally {
    await db.exec('RESET ROLE');
  }
}

const prod = (id, sku, t, dev) =>
  JSON.stringify({
    outlet_id: 'O1', id, sku, name: `P${id}`, created_at: 1000, updated_at: t,
    updated_by_device: dev, price_minor: 100, cost_minor: 50,
  });

describe('cloud schema on real Postgres', () => {
    let db;
  before(async () => {
    db = await boot();
  });

  it('a FRESH deploy applies, and re-applying is idempotent, and records the version', async () => {
    await db.exec(CLOUD_SCHEMA_SQL); // second run (boot ran the first)
    const v = await db.query('SELECT max(version) AS v FROM public.cloud_schema_meta');
    assert.equal(Number(v.rows[0].v), CLOUD_SCHEMA_VERSION);
  });

  it('apply_product: create, then a DIFFERENT id with the same SKU resolves by LWW instead of raising', async () => {
    const a = await as(db, 'authenticated', U_OWNER, 'SELECT apply_product($1::jsonb) AS r', [prod('a', 'SKU1', 1000, 'd1')]);
    assert.deepEqual(a, { ok: true, rows: [{ r: 'created' }] });
    const b = await as(db, 'authenticated', U_OWNER, 'SELECT apply_product($1::jsonb) AS r', [prod('b', 'SKU1', 2000, 'd2')]);
    assert.deepEqual(b, { ok: true, rows: [{ r: 'updated' }] });
    const stale = await as(db, 'authenticated', U_OWNER, 'SELECT apply_product($1::jsonb) AS r', [prod('c', 'SKU1', 500, 'd3')]);
    assert.deepEqual(stale, { ok: true, rows: [{ r: 'kept' }] });
  });

  it('members can push (sale/ledger idempotent) and read their outlet', async () => {
    const op = JSON.stringify({ outlet_id: 'O1', op_id: 'op1', id: 'l1', product_id: 'a', type: 'adjust', qty_delta: 5, created_at: 1000 });
    assert.deepEqual(await as(db, 'authenticated', U_OWNER, 'SELECT apply_ledger($1::jsonb) AS r', [op]), { ok: true, rows: [{ r: 'applied' }] });
    assert.deepEqual(await as(db, 'authenticated', U_OWNER, 'SELECT apply_ledger($1::jsonb) AS r', [op]), { ok: true, rows: [{ r: 'duplicate' }] });
    const r = await as(db, 'authenticated', U_OWNER, 'SELECT count(*)::int AS n FROM public.product');
    assert.deepEqual(r, { ok: true, rows: [{ n: 1 }] });
  });

  it('SECURITY: a signed-in NON-member cannot join the store or read/write it', async () => {
    const join = await as(db, 'authenticated', U_STRANGER, `INSERT INTO public.org_member (org_id, user_id, role) VALUES ('O1', '${U_STRANGER}', 'owner')`);
    assert.equal(join.ok, false);
    assert.deepEqual(await as(db, 'authenticated', U_STRANGER, 'SELECT count(*)::int AS n FROM public.product'), { ok: true, rows: [{ n: 0 }] });
    const op = JSON.stringify({ outlet_id: 'O1', op_id: 'evil', id: 'evil', product_id: 'a', type: 'adjust', qty_delta: -9999, created_at: 1000 });
    const w = await as(db, 'authenticated', U_STRANGER, 'SELECT apply_ledger($1::jsonb) AS r', [op]);
    assert.equal(w.ok, false);
    const row = await db.query("SELECT count(*)::int AS n FROM public.stock_ledger WHERE sync_op_id = 'evil'");
    assert.equal(row.rows[0].n, 0);
  });

  it('SECURITY: anon (public key) can read nothing — not tables, not stock_view, not schema meta', async () => {
    for (const rel of ['stock_view', 'product', 'sale', 'stock_ledger', 'org_member', 'cloud_schema_meta']) {
      const r = await as(db, 'anon', null, `SELECT * FROM public.${rel}`);
      assert.equal(r.ok, false, `anon could read ${rel}`);
    }
    const f = await as(db, 'anon', null, "SELECT apply_ledger('{}'::jsonb)");
    assert.equal(f.ok, false);
  });

  it('stock_view is caller-scoped for members (security_invoker)', async () => {
    const own = await as(db, 'authenticated', U_OWNER, 'SELECT product_id, qty::int AS qty FROM public.stock_view');
    assert.deepEqual(own, { ok: true, rows: [{ product_id: 'a', qty: 5 }] });
    const stranger = await as(db, 'authenticated', U_STRANGER, 'SELECT * FROM public.stock_view');
    assert.equal(stranger.ok && stranger.rows.length, 0);
  });
});
