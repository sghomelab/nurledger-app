/**
 * BYO cloud schema bundle — structural guards (PR-2026-11, CR-02).
 *
 * The bundle is SQL pasted into the store's OWN Supabase project; nothing else
 * tests it end-to-end in CI. These string-level guards pin the invariants that
 * keep delta pulls from silently losing data:
 *  - the bundle header/meta version matches CLOUD_SCHEMA_VERSION (the wizard
 *    gates on exactly this number);
 *  - every synced table carries the server-stamped `synced_at` cursor column
 *    (fresh deploys AND the v3→v4 upgrade ALTERs);
 *  - every RPC write path stamps `synced_at = now()` — the original bug
 *    stamped the CLIENT's created/edited time, which stranded offline rows
 *    behind peers' already-advanced cursors.
 */

import { CLOUD_SCHEMA_SQL, CLOUD_SCHEMA_VERSION } from '../lib/cloud/schemaSql';

const SYNCED_TABLES = ['category', 'product', 'sale', 'stock_ledger', 'refund'] as const;

describe('cloud schema bundle (v4 — synced_at cursor)', () => {
  it('declares exactly the version the wizard gates on', () => {
    expect(CLOUD_SCHEMA_VERSION).toBe(4);
    expect(CLOUD_SCHEMA_SQL).toContain(`NURLEDGER BYO SCHEMA v${CLOUD_SCHEMA_VERSION}`);
    expect(CLOUD_SCHEMA_SQL).toContain(`INSERT INTO public.cloud_schema_meta (version) VALUES (${CLOUD_SCHEMA_VERSION})`);
  });

  it('adds synced_at to every synced table (fresh deploys)', () => {
    for (const t of SYNCED_TABLES) {
      expect(CLOUD_SCHEMA_SQL).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS synced_at`));
      const idxName =
        t === 'stock_ledger' ? 'idx_ledger_outlet_synced' : `idx_${t}_outlet_synced`;
      expect(CLOUD_SCHEMA_SQL).toContain(idxName);
    }
  });

  it('stamps server now() on every RPC write site (exact counts)', () => {
    // The count of `now()` inside each function body MUST equal the number of
    // stamps — a missing stamp is the original CR-02 bug resurfacing.
    // Append-only write sites stamp BOTH updated_at and synced_at (2 each);
    // LWW write sites stamp only synced_at (1 each — updated_at must stay the
    // client's in_updated, guarded separately below).
    //   apply_sale:     sale insert + nested ledger-row loop          = 2×2 = 4
    //   apply_ledger:   standalone ledger insert                      = 1×2 = 2
    //   apply_refund:   refund insert + nested restock ledger loop    = 2×2 = 4
    //   apply_product:  created-insert + sku-collision update + LWW   = 3×1 = 3
    //   apply_category: insert + LWW update                           = 2×1 = 2
    const expected: Array<[name: string, nowCount: number]> = [
      ['apply_sale', 4],
      ['apply_ledger', 2],
      ['apply_refund', 4],
      ['apply_product', 3],
      ['apply_category', 2],
    ];
    // Regex built by concatenation (template-literal escaping is a trap here).
    // 'END; \\$\\$' as a string = regex /END; \$\$/ = the literal "END; $$"
    // that terminates each plpgsql function body.
    const fnRe = (name: string) =>
      new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '[\\s\\S]*?END; \\$\\$');
    for (const [name, nowCount] of expected) {
      const m = CLOUD_SCHEMA_SQL.match(fnRe(name));
      if (!m) throw new Error(`${name} body not found in bundle`);
      const body = m[0];
      const stamps = (body.match(/now\(\)/g) ?? []).length;
      expect(stamps).toBe(nowCount); // `${name} must stamp exactly ${nowCount} write sites`
      expect(body).toContain('synced_at'); // `${name} must reference the synced_at column`
    }
  });

  it('keeps client updated_at as the LWW key on product/category (no server stamp there)', () => {
    // Regression guard for the WRONG fix: stamping product/category
    // updated_at with now() would make a late offline push beat a newer edit.
    const product = CLOUD_SCHEMA_SQL.match(/CREATE OR REPLACE FUNCTION public\.apply_product[\s\S]*?END; \$\$/)![0];
    const category = CLOUD_SCHEMA_SQL.match(/CREATE OR REPLACE FUNCTION public\.apply_category[\s\S]*?END; \$\$/)![0];
    for (const [name, body] of [['apply_product', product], ['apply_category', category]] as const) {
      // every `updated_at =` assignment/comparison in the LWW tables must be
      // against the client's in_updated — never a server now()
      const updatedAssignments = [...body.matchAll(/updated_at\s*=\s*([a-z_]+)/g)].map((m) => m[1]);
      expect(updatedAssignments.length).toBeGreaterThan(0);
      expect(updatedAssignments).toEqual(updatedAssignments.map(() => 'in_updated'));
    }
  });
});
