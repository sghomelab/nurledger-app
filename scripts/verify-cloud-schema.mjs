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
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { CLOUD_SCHEMA_SQL, CLOUD_SCHEMA_VERSION, schemaSqlWithClaim } from '../src/lib/cloud/schemaSql.ts';
import { createHash } from 'node:crypto';

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
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
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


// ---------------------------------------------------------------------------
// Upgrade paths + tenant isolation + blast radius (second review pass)
// ---------------------------------------------------------------------------
const fixture = (v) => readFileSync(new URL(`./fixtures/cloud-schema-v${v}.sql`, import.meta.url), 'utf8');

async function rawDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);
  return db;
}
const P = (o, id, sku, t, dev, extra = {}) =>
  JSON.stringify({ outlet_id: o, id, sku, name: `N-${id}`, created_at: 1000, updated_at: t, updated_by_device: dev, price_minor: 100, cost_minor: 50, ...extra });

describe('upgrade paths keep data and end at the current version', () => {
  const paths = {
    'v3 -> current (direct)': [3],
    'v3 -> v4 -> current': [3, 4],
    'v3 -> v4 -> v5 -> current': [3, 4, 5],
    'v3 -> v4 -> v5 -> v6 -> current': [3, 4, 5, 6],
    'fresh v6 -> current': [6],
    'fresh v5 -> current': [5],
  };
  for (const [name, steps] of Object.entries(paths)) {
    it(name, async () => {
      const db = await rawDb();
      for (const v of steps) await db.exec(fixture(v));
      await db.exec(`
        INSERT INTO auth.users VALUES ('${U_OWNER}');
        INSERT INTO public.outlet (id, name, currency, locale, tax_engine) VALUES ('O1', 'S', 'MYR', 'en', 'x');
        INSERT INTO public.org_member VALUES ('O1', '${U_OWNER}', 'owner');
        INSERT INTO public.product (id, outlet_id, sku, name, created_at, updated_at) VALUES ('p1', 'O1', 'S1', 'x', now(), now());
      `);
      await db.exec(CLOUD_SCHEMA_SQL);
      await db.exec(CLOUD_SCHEMA_SQL); // idempotent
      const v = await db.query('SELECT max(version)::int AS v FROM public.cloud_schema_meta');
      assert.equal(v.rows[0].v, CLOUD_SCHEMA_VERSION);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.product')).rows[0].n, 1);
      assert.equal((await as(db, 'anon', null, 'SELECT * FROM public.stock_view')).ok, false);
      assert.deepEqual(await as(db, 'authenticated', U_OWNER, 'SELECT count(*)::int AS n FROM public.product'), { ok: true, rows: [{ n: 1 }] });
    });
  }
});

describe('tenant isolation across outlets', () => {
  let db;
  before(async () => {
    db = await boot();
    await db.exec(`
      INSERT INTO public.outlet (id, name, currency, locale, tax_engine) VALUES ('O2', 'Other', 'MYR', 'en', 'x');
      INSERT INTO public.org_member VALUES ('O2', '${U_STRANGER}', 'owner');
    `);
    await as(db, 'authenticated', U_STRANGER, 'SELECT apply_product($1::jsonb)', [P('O2', 'b-prod', 'SEC', 1000, 'd2', { name: 'TENANT-B-SECRET', cost_minor: 777 })]);
    await as(db, 'authenticated', U_STRANGER, 'SELECT apply_category($1::jsonb)', [JSON.stringify({ outlet_id: 'O2', id: 'b-cat', name: 'B-CAT', created_at: 1000, updated_at: 1000 })]);
  });
  it("a member of one outlet cannot overwrite another outlet's product or category by id", async () => {
    const p = await as(db, 'authenticated', U_OWNER, 'SELECT apply_product($1::jsonb) AS r', [P('O1', 'b-prod', 'HIJACK', 9000, 'dX', { name: 'HIJACKED' })]);
    assert.equal(p.ok, false);
    const c = await as(db, 'authenticated', U_OWNER, 'SELECT apply_category($1::jsonb) AS r', [JSON.stringify({ outlet_id: 'O1', id: 'b-cat', name: 'HIJACK', created_at: 1000, updated_at: 9000 })]);
    assert.equal(c.ok, false);
    const row = await db.query("SELECT name FROM public.product WHERE id = 'b-prod'");
    assert.equal(row.rows[0].name, 'TENANT-B-SECRET');
    const audit = await as(db, 'authenticated', U_OWNER, "SELECT count(*)::int AS n FROM public.product_audit WHERE before_json->>'name' = 'TENANT-B-SECRET'");
    assert.deepEqual(audit, { ok: true, rows: [{ n: 0 }] });
  });
  it('replaying another outlet\'s sale uuid / line id never overwrites or leaks', async () => {
    const sale = (o, u, lines) => JSON.stringify({ outlet_id: o, uuid: u, id: u, created_at: 1000, subtotal_minor: 100, discount_minor: 0, tax_minor: 0, total_minor: 100, cogs_minor: 0, lines, payments: [], ledger_rows: [] });
    const ln = (id) => ({ id, product_id: 'p', qty: 1, qty_g: null, unit_price_minor: 100, discount_minor: 0, tax_minor: 0, line_total_minor: 100, created_at: 1000 });
    await as(db, 'authenticated', U_STRANGER, 'SELECT apply_sale($1::jsonb)', [sale('O2', 'sB', [ln('lineB')])]);
    assert.deepEqual(await as(db, 'authenticated', U_OWNER, 'SELECT apply_sale($1::jsonb) AS r', [sale('O1', 'sB', [])]), { ok: true, rows: [{ r: 'duplicate' }] });
    await as(db, 'authenticated', U_OWNER, 'SELECT apply_sale($1::jsonb)', [sale('O1', 'sNew', [ln('lineB')])]);
    const owner = await db.query("SELECT outlet_id FROM public.sale_line WHERE id = 'lineB'");
    assert.equal(owner.rows[0].outlet_id, 'O2');
  });
  it('stock_view only shows the caller\'s own outlet', async () => {
    await db.exec("INSERT INTO public.stock_ledger (sync_op_id, id, outlet_id, product_id, type, qty_delta, created_at) VALUES ('a1','a1','O1','pa','adjust',3,now()), ('b1','b1','O2','pb','adjust',9,now())");
    const mine = await as(db, 'authenticated', U_OWNER, 'SELECT product_id FROM public.stock_view ORDER BY 1');
    assert.deepEqual(mine, { ok: true, rows: [{ product_id: 'pa' }] });
  });
});

describe('blast radius: the bundle only touches its own objects', () => {
  it('leaves unrelated tables\' privileges alone and revokes anon/PUBLIC EXECUTE on its own functions', async () => {
    const db = await boot();
    await db.exec("CREATE TABLE public.other_app_table (id int); INSERT INTO public.other_app_table VALUES (1);");
    const before = await as(db, 'anon', null, 'SELECT * FROM public.other_app_table');
    assert.equal(before.ok, true);
    await db.exec(CLOUD_SCHEMA_SQL);
    assert.equal((await as(db, 'anon', null, 'SELECT * FROM public.other_app_table')).ok, true, 'anon access to an unrelated table must be unchanged');
    const priv = await db.query("SELECT has_function_privilege('anon','public.apply_sale(jsonb)','execute') AS a, has_function_privilege('authenticated','public.apply_sale(jsonb)','execute') AS b");
    assert.deepEqual(priv.rows[0], { a: false, b: true });
  });
});


// ---------------------------------------------------------------------------
// v7: service-key-free provisioning + invite codes
// ---------------------------------------------------------------------------
const norm = (c) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashOf = (c) => createHash('sha256').update(norm(c)).digest('hex');
const OUTLET = (id = 'OUT1') => ({ id, name: 'Shop', currency: 'MYR', locale: 'en', tax_engine: 'x' });
const U_C = '33333333-3333-3333-3333-333333333333';
const U_D = '44444444-4444-4444-4444-444444444444';

async function freshStore(claim = 'CLAIM-1234-ABCD') {
  const db = await rawDb();
  await db.exec(schemaSqlWithClaim(hashOf(claim)));
  await db.exec(`INSERT INTO auth.users VALUES ('${U_OWNER}'), ('${U_STRANGER}'), ('${U_C}'), ('${U_D}');`);
  return db;
}
const prov = (db, uid, p) => as(db, 'authenticated', uid, 'SELECT public.provision_store($1::jsonb) AS r', [JSON.stringify(p)]);

describe('provisioning without a service key', () => {
  it('the wizard SQL (bundle + claim) applies, and re-applying is a no-op once claimed', async () => {
    const db = await freshStore();
    await prov(db, U_OWNER, { outlet: OUTLET(), claim: 'claim-1234-abcd' });
    await db.exec(schemaSqlWithClaim(hashOf('SOMETHING-ELSE'))); // re-paste after the store exists
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.store_claim')).rows[0].n, 0, 'claim must not be re-armed on a claimed store');
  });
  it('the schema check is callable with only the anon key and returns just a number', async () => {
    const db = await freshStore();
    assert.deepEqual(await as(db, 'anon', null, 'SELECT public.nurledger_schema_version() AS v'), { ok: true, rows: [{ v: CLOUD_SCHEMA_VERSION }] });
  });
  it('first provisioning needs the claim code; wrong/missing claim cannot create the store', async () => {
    const db = await freshStore();
    assert.equal((await prov(db, U_STRANGER, { outlet: OUTLET() })).ok, false);
    assert.equal((await prov(db, U_STRANGER, { outlet: OUTLET(), claim: 'WRONG-CODE-0000' })).ok, false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.outlet')).rows[0].n, 0);
    const ok = await prov(db, U_OWNER, { outlet: OUTLET(), claim: 'claim-1234-abcd' }); // case/dash-insensitive
    assert.deepEqual(ok, { ok: true, rows: [{ r: 'OUT1' }] });
    const m = await db.query(`SELECT role FROM public.org_member WHERE user_id = '${U_OWNER}'`);
    assert.equal(m.rows[0].role, 'owner');
  });
  it('the claim is single use: it cannot create a second store or re-claim', async () => {
    const db = await freshStore();
    await prov(db, U_OWNER, { outlet: OUTLET(), claim: 'CLAIM-1234-ABCD' });
    assert.equal((await prov(db, U_STRANGER, { outlet: OUTLET('OUT2'), claim: 'CLAIM-1234-ABCD' })).ok, false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.outlet')).rows[0].n, 1);
  });
  it('a stranger cannot join an existing store without an invite; members re-provision idempotently', async () => {
    const db = await freshStore();
    await prov(db, U_OWNER, { outlet: OUTLET(), claim: 'CLAIM-1234-ABCD' });
    assert.equal((await prov(db, U_STRANGER, { outlet: OUTLET('OUT9') })).ok, false);
    assert.equal((await prov(db, U_STRANGER, { invite: 'AAAA-BBBB-CCCC-DDDD' })).ok, false);
    assert.deepEqual(await prov(db, U_OWNER, { outlet: OUTLET('IGNORED') }), { ok: true, rows: [{ r: 'OUT1' }] });
    assert.equal((await as(db, 'authenticated', U_STRANGER, 'SELECT count(*)::int AS n FROM public.product')).rows[0].n, 0);
  });
  it('invite codes: owner creates; invitee joins as a MEMBER; single use; expiry; members cannot invite', async () => {
    const db = await freshStore();
    await prov(db, U_OWNER, { outlet: OUTLET(), claim: 'CLAIM-1234-ABCD' });
    const mk = async (uid, hours) => as(db, 'authenticated', uid, 'SELECT public.create_invite($1::int) AS code', [hours ?? 24]);
    const inv = await mk(U_OWNER);
    assert.equal(inv.ok, true);
    const code = inv.rows[0].code;
    assert.match(code, /^[0-9A-F]{16}$/);
    // stored hashed only
    const stored = await db.query('SELECT encode(code_hash, \'hex\') AS h FROM public.store_invite');
    assert.equal(stored.rows[0].h, hashOf(code));
    // invitee (formatted + lowercase) joins as member
    const pretty = code.toLowerCase().replace(/(.{4})/g, '$1-').slice(0, -1);
    assert.deepEqual(await prov(db, U_C, { invite: pretty }), { ok: true, rows: [{ r: 'OUT1' }] });
    assert.equal((await db.query(`SELECT role FROM public.org_member WHERE user_id = '${U_C}'`)).rows[0].role, 'member');
    // single use
    assert.equal((await prov(db, U_D, { invite: code })).ok, false);
    // members cannot mint invites
    assert.equal((await mk(U_C)).ok, false);
    // expiry
    const code2 = (await mk(U_OWNER)).rows[0].code;
    await db.exec(`UPDATE public.store_invite SET expires_at = now() - interval '1 minute' WHERE code_hash = decode('${hashOf(code2)}', 'hex')`);
    assert.equal((await prov(db, U_D, { invite: code2 })).ok, false);
    // a joined member can sync like any member
    assert.equal((await as(db, 'authenticated', U_C, 'SELECT count(*)::int AS n FROM public.product')).ok, true);
  });
  it('invite hours are clamped (1h..7d) and strangers/anon cannot call create_invite', async () => {
    const db = await freshStore();
    await prov(db, U_OWNER, { outlet: OUTLET(), claim: 'CLAIM-1234-ABCD' });
    await as(db, 'authenticated', U_OWNER, 'SELECT public.create_invite(100000)');
    const mx = await db.query("SELECT (expires_at - now() <= interval '7 days 1 minute') AS ok FROM public.store_invite");
    assert.equal(mx.rows[0].ok, true);
    assert.equal((await as(db, 'authenticated', U_STRANGER, 'SELECT public.create_invite(24)')).ok, false);
    assert.equal((await as(db, 'anon', null, 'SELECT public.create_invite(24)')).ok, false);
    assert.equal((await as(db, 'anon', null, "SELECT public.provision_store('{}'::jsonb)")).ok, false);
  });
  it('claim/invite tables and the hash/claim functions are unreachable for client roles', async () => {
    const db = await freshStore();
    await prov(db, U_OWNER, { outlet: OUTLET(), claim: 'CLAIM-1234-ABCD' });
    await as(db, 'authenticated', U_OWNER, 'SELECT public.create_invite(24)');
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await as(db, role, U_OWNER, 'SELECT * FROM public.store_invite')).ok, false, `${role} read store_invite`);
      assert.equal((await as(db, role, U_OWNER, 'SELECT * FROM public.store_claim')).ok, false, `${role} read store_claim`);
      assert.equal((await as(db, role, U_OWNER, "SELECT public.nurledger_set_claim('" + '0'.repeat(64) + "')")).ok, false, `${role} set_claim`);
      assert.equal((await as(db, role, U_OWNER, "SELECT public.nurledger_hash_code('x')")).ok, false, `${role} hash_code`);
    }
  });
  it('schemaSqlWithClaim refuses anything that is not a 64-char hex hash (it is spliced into SQL)', () => {
    assert.throws(() => schemaSqlWithClaim("x'); DROP TABLE public.outlet; --"));
    assert.throws(() => schemaSqlWithClaim('ABCDEF'));
    assert.doesNotThrow(() => schemaSqlWithClaim('a'.repeat(64)));
  });
});
