import {
  __pullAllPagesForTest as pullAllPages,
  __pullAllKeysetPagesForTest as pullAllKeysetPages,
} from '../lib/cloud/supabaseAdapter';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

/** Fake PostgREST: returns at most `cap` rows per request regardless of range. */
function fakeServer(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: String(i).padStart(6, '0') }));
  return async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + cap)),
    error: null,
  });
}

describe('pullAllPages (child-row paging)', () => {
  it('returns every row across pages (e.g. 50 sales x 30 lines = 1,500 rows)', async () => {
    const out = await pullAllPages(fakeServer(1500, 1000), 'pull sale_line', (r) => r.id);
    expect(out).toHaveLength(1500);
    expect(new Set(out).size).toBe(1500);
  });
  it('handles an exact page-size multiple and an empty result', async () => {
    expect(await pullAllPages(fakeServer(500, 1000), 'x', (r) => r.id)).toHaveLength(500);
    expect(await pullAllPages(fakeServer(0, 1000), 'x', (r) => r.id)).toHaveLength(0);
  });
  it('surfaces server errors with the label', async () => {
    await expect(
      pullAllPages(async () => ({ data: null, error: { message: 'boom' } }), 'pull payment', (r) => r),
    ).rejects.toThrow('pull payment: boom');
  });
});

// ---------------- keyset paging (parent tables) ----------------

type KRow = { synced_at: string; id: string };
const MIN = 60_000;
const ts = (m: number) => new Date(m * MIN).toISOString();

/**
 * Fake PostgREST speaking the keyset contract: `anchor` is the previous
 * page's last row (the adapter's KeysetAnchor); the server returns rows
 * strictly after it, ordered (synced_at, id), capped per page.
 */
function fakeKeysetServer(opts: { total: number; pageCap: number; afterFirstPage?: (rows: KRow[]) => void }) {
  const rows: KRow[] = Array.from({ length: opts.total }, (_, i) => ({
    synced_at: ts(1000 + i), // strictly increasing
    id: String(i).padStart(6, '0'),
  }));
  const cmp = (a: KRow, b: KRow) =>
    a.synced_at === b.synced_at ? (a.id < b.id ? -1 : 1) : a.synced_at < b.synced_at ? -1 : 1;
  let first = true;
  return async (anchor: { syncedAt: string; id: string } | null) => {
    const filtered =
      anchor == null
        ? rows.slice()
        : rows.filter(
            (r) => r.synced_at > anchor.syncedAt || (r.synced_at === anchor.syncedAt && r.id > anchor.id),
          );
    filtered.sort(cmp);
    const page = filtered.slice(0, opts.pageCap);
    if (first) {
      first = false;
      opts.afterFirstPage?.(rows); // write lands AFTER page 1 is served (true mid-pull)
    }
    return { data: page, error: null };
  };
}

describe('pullAllKeysetPages (parent-table paging)', () => {
  it('returns every row across pages, no dupes', async () => {
    const out = await pullAllKeysetPages(fakeKeysetServer({ total: 1200, pageCap: 500 }), 'pull ledger', (r) => r.id);
    expect(out).toHaveLength(1200);
    expect(new Set(out).size).toBe(1200);
  });

  it('handles an exact page-size multiple and an empty result', async () => {
    expect(await pullAllKeysetPages(fakeKeysetServer({ total: 1000, pageCap: 500 }), 'x', (r) => r.id)).toHaveLength(1000);
    expect(await pullAllKeysetPages(fakeKeysetServer({ total: 0, pageCap: 500 }), 'x', (r) => r.id)).toHaveLength(0);
  });

  it('surfaces server errors with the label', async () => {
    await expect(
      pullAllKeysetPages(async () => ({ data: null, error: { message: 'boom' } }), 'pull products', (r) => r),
    ).rejects.toThrow('pull products: boom');
  });

  it('update-mid-pull: pre-existing rows are never skipped or duplicated when a concurrent write lands in the window', async () => {
    // The failure mode this exists for: OFFSET paging over a live table shifts
    // the window when a write lands in the not-yet-fetched region, so a
    // PRE-EXISTING row slides past the pull's end while the cursor has already
    // advanced past it — silent, permanent loss. Keyset anchors on the last
    // row itself, so an insert cannot move any committed row out of the window.
    const out = await pullAllKeysetPages(
      fakeKeysetServer({
        total: 1200,
        pageCap: 500,
        afterFirstPage: (rows) => {
          // "backfill"/clock-step write: lands INSIDE the already-fetched
          // region. It violates the server-stamp monotonicity invariant, so it
          // is outside this pull's window by contract — keyset must NOT
          // distort the committed rows because of it.
          rows.push({ synced_at: ts(1001), id: 'zzz-early' });
          // normal concurrent write: server-stamped AFTER the pull started —
          // must land in THIS pull, not be lost.
          rows.push({ synced_at: ts(1000 + 1200 + 5), id: 'zzz-tail' });
        },
      }),
      'pull ledger',
      (r) => r.id,
    );
    // all 1,200 pre-existing rows exactly once + the tail write (1,201).
    expect(out).toHaveLength(1201);
    expect(out).toContain('zzz-tail');
    expect(out).not.toContain('zzz-early');
    const pre = out.filter((id) => id !== 'zzz-tail');
    expect(pre).toHaveLength(1200);
    expect(new Set(pre).size).toBe(1200);
  });
});
