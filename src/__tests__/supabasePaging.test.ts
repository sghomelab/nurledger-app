import { __pullAllPagesForTest as pullAllPages } from '../lib/cloud/supabaseAdapter';

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
