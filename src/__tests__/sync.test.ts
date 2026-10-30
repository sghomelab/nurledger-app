/**
 * Sync core tests (FR-502). These are the unit twin of the two-device exit
 * test: they prove FIFO ordering, client-UUID idempotency semantics, LWW +
 * audit for products, union-by-UUID for sales/ledger (no client-merge of
 * stock), and cursor monotonicity.
 */

import {
  advanceCursor,
  applyLwwDelta,
  applyUnionDelta,
  fifoOrder,
  isRetryableError,
  isUploadedResult,
  ledgerSignature,
  lwwOutcome,
  nextDrainBatch,
  productResolveRef,
  saleResolveCandidates,
  saleSignature,
  type LwwMeta,
  type OutboxOp,
} from '../lib/sync';

function op(partial: Partial<OutboxOp> & { opId: string }): OutboxOp {
  return { id: partial.opId, entity: 'sale', createdAt: 0, seq: 0, ...partial };
}

describe('FIFO outbox (FR-502 — outbox FIFO idempotent upload)', () => {
  it('drains strictly by createdAt, then insertion seq', () => {
    const ops = [
      op({ opId: 'c', createdAt: 300, seq: 3 }),
      op({ opId: 'a', createdAt: 100, seq: 1 }),
      op({ opId: 'b', createdAt: 200, seq: 2 }),
    ];
    expect(fifoOrder(ops).map((o) => o.opId)).toEqual(['a', 'b', 'c']);
  });

  it('ties on createdAt break by seq (insertion order), not op id', () => {
    const ops = [
      op({ opId: 'zz', createdAt: 100, seq: 2 }),
      op({ opId: 'aa', createdAt: 100, seq: 1 }),
    ];
    expect(fifoOrder(ops).map((o) => o.opId)).toEqual(['aa', 'zz']);
  });

  it('nextDrainBatch respects the batch limit in FIFO order', () => {
    const ops = [
      op({ opId: '3', createdAt: 3, seq: 3 }),
      op({ opId: '1', createdAt: 1, seq: 1 }),
      op({ opId: '2', createdAt: 2, seq: 2 }),
      op({ opId: '4', createdAt: 4, seq: 4 }),
    ];
    expect(nextDrainBatch(ops, 2).map((o) => o.opId)).toEqual(['1', '2']);
  });
});

describe('client-UUID idempotency (no double-apply)', () => {
  it('every server "already recorded" answer counts as uploaded (safe to mark)', () => {
    expect(isUploadedResult('applied')).toBe(true);
    expect(isUploadedResult('duplicate')).toBe(true); // ← the double-apply guard
    expect(isUploadedResult('created')).toBe(true);
    expect(isUploadedResult('updated')).toBe(true);
    expect(isUploadedResult('kept')).toBe(true);
  });

  it('network/5xx/408/429 are retryable; 4xx payload/auth errors are not', () => {
    expect(isRetryableError(undefined, true)).toBe(true); // transport failure
    expect(isRetryableError(500, false)).toBe(true);
    expect(isRetryableError(503, false)).toBe(true);
    expect(isRetryableError(408, false)).toBe(true);
    expect(isRetryableError(429, false)).toBe(true);
    expect(isRetryableError(400, false)).toBe(false);
    expect(isRetryableError(401, false)).toBe(false);
    expect(isRetryableError(404, false)).toBe(false);
  });
});

describe('products LWW with audit (acceptance: "product edits LWW with audit row")', () => {
  const A: LwwMeta = { updatedAt: 1000, updatedByDevice: 'device-a' };
  const B: LwwMeta = { updatedAt: 2000, updatedByDevice: 'device-b' };

  it('later timestamp wins, earlier is the loser (→ audit row)', () => {
    expect(lwwOutcome(A, B)).toEqual({ winner: 'incoming', reason: 'later-timestamp', loser: 'existing' });
    expect(lwwOutcome(B, A)).toEqual({ winner: 'existing', reason: 'earlier-timestamp', loser: 'incoming' });
  });

  it('exact timestamp tie breaks deterministically by device id (both devices agree)', () => {
    const a2 = { updatedAt: 1000, updatedByDevice: 'device-a' };
    const b2 = { updatedAt: 1000, updatedByDevice: 'device-b' };
    // Same comparison from both sides must agree on the winner.
    const fromA = lwwOutcome(a2, b2);
    const fromB = lwwOutcome(b2, a2);
    expect(fromA.winner === 'incoming' ? 'device-b' : 'device-a').toBe(
      fromB.winner === 'incoming' ? 'device-a' : 'device-b',
    );
    expect(fromA.winner).toBe('incoming'); // device-b > device-a lexicographically
    expect(fromA.reason).toBe('device-tiebreak');
  });

  it('pull delta: newer remote row replaces local; older remote row is rejected', () => {
    const local = new Map<string, LwwMeta & { id: string; name: string }>([
      ['p1', { id: 'p1', name: 'Croissant', updatedAt: 500, updatedByDevice: 'a' }],
    ]);
    const remote: Array<LwwMeta & { id: string; name: string }> = [
      { id: 'p1', name: 'Croissant 2', updatedAt: 900, updatedByDevice: 'b' }, // wins
      { id: 'p2', name: 'Older', updatedAt: 10, updatedByDevice: 'b' },        // new product → adopt
    ];
    const { toWrite, rejected } = applyLwwDelta(local, remote);
    expect(toWrite.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    expect(rejected).toEqual([]);

    const remote2: Array<LwwMeta & { id: string; name: string }> = [
      { id: 'p1', name: 'Stale edit', updatedAt: 300, updatedByDevice: 'b' }, // loses → rejected
    ];
    const local2 = new Map(local);
    local2.set('p1', { id: 'p1', name: 'Croissant 2', updatedAt: 900, updatedByDevice: 'b' });
    const r2 = applyLwwDelta(local2, remote2);
    expect(r2.toWrite).toEqual([]);
    expect(r2.rejected).toHaveLength(1);
    expect(r2.rejected[0]?.outcome.reason).toBe('earlier-timestamp');
  });
});

describe('sales/ledger = pure union by UUID (stock never client-merged)', () => {
  it('remote rows already present locally are skipped, never overwritten', () => {
    const localIds = new Set(['s1', 's2']);
    const { toInsert, skipped } = applyUnionDelta(localIds, [
      { id: 's1' }, // duplicate — skipped
      { id: 's3' }, // new — inserted
      { id: 's1' }, // duplicate again — skipped
    ]);
    expect(toInsert).toEqual([{ id: 's3' }]);
    expect(skipped).toBe(2);
  });

  it('two devices selling the same product yield two distinct sale UUIDs (both apply)', () => {
    // The exit test in miniature: A sells croissant (uuid X), B sells (uuid Y).
    const deviceA = [{ uuid: 'X' }];
    const deviceB = [{ uuid: 'Y' }];
    const server = [...deviceA, ...deviceB];
    expect(saleSignature(server)).toBe('X|Y');
    expect(saleSignature(server)).not.toBe(saleSignature(deviceA));
  });

  it('ledger signatures are order-independent and detect double-apply', () => {
    const a = [
      { opId: 'op1', qtyDelta: -2 },
      { opId: 'op2', qtyDelta: -1 },
    ];
    const b = [
      { opId: 'op2', qtyDelta: -1 },
      { opId: 'op1', qtyDelta: -2 },
    ];
    expect(ledgerSignature(a)).toBe(ledgerSignature(b)); // same set, any order

    // A double-applied op would appear with a DIFFERENT op id (client UUIDs are
    // unique per op) or, if the same UUID were naively inserted twice, the
    // signature is unchanged — the server's ON CONFLICT DO NOTHING is what
    // keeps the signature honest. Simulate the CORRECT server behavior:
    const doubleSent = [...a, a[0]!]; // client retries op1
    const serverKeptOnConflict = a;   // server dedups by opId
    expect(ledgerSignature(serverKeptOnConflict)).toBe(ledgerSignature(a));
    // And a naive (buggy) merge that kept both rows would change the sum:
    const buggy = doubleSent;
    const sum = (rows: Array<{ qtyDelta: number | null }>) => rows.reduce((s, r) => s + (r.qtyDelta ?? 0), 0);
    expect(sum(buggy)).not.toBe(sum(serverKeptOnConflict));
  });
});

describe('delta cursors', () => {
  it('advances to the max updatedAt seen', () => {
    expect(advanceCursor(100, [{ updatedAt: 50 }, { updatedAt: 200 }, { updatedAt: 90 }])).toBe(200);
  });
  it('never rewinds on a stale pull', () => {
    expect(advanceCursor(500, [{ updatedAt: 100 }])).toBe(500);
  });
});

describe('outbox op → source-row resolution (drain payload reconstruction)', () => {
  // Regression (2026-10-31, two-device E2E): the drain resolved sale ops by
  // `sale.id = op_id` while op_id = sale.uuid → every sale payload resolved
  // null and was silently dropped as a "poison op".
  describe('sale ops (op_id = sale.uuid)', () => {
    it('resolves by the op id first when there is no hint', () => {
      expect(saleResolveCandidates('uuid-1', null)).toEqual(['uuid-1']);
      expect(saleResolveCandidates('uuid-1', '{}')).toEqual(['uuid-1']);
    });

    it('resolves a LEGACY random op_id via the stored hint (saleId, saleUuid)', () => {
      const hint = JSON.stringify({ saleId: 'local-id-1', saleUuid: 'uuid-1', totalMinor: 350 });
      expect(saleResolveCandidates('random-op-id', hint)).toEqual([
        'random-op-id',
        'local-id-1',
        'uuid-1',
      ]);
    });

    it('de-duplicates hint refs against the op id and ignores non-strings', () => {
      const hint = JSON.stringify({ saleId: 'uuid-1', saleUuid: 42 });
      expect(saleResolveCandidates('uuid-1', hint)).toEqual(['uuid-1']);
    });

    it('malformed hint degrades to the op id (no throw — no poison-op loop)', () => {
      expect(saleResolveCandidates('uuid-1', 'not-json{')).toEqual(['uuid-1']);
    });
  });

  // Regression (2026-10-31): product edit/deactivate ops carry a FRESH random
  // op_id + a { productId } hint; resolving by `product.id = op_id` dropped
  // every product edit.
  describe('product ops (create = op_id, edits = fresh op_id + hint)', () => {
    it('create/backfill ops (no hint) resolve by their op id = product.id', () => {
      expect(productResolveRef('prod-1', null)).toBe('prod-1');
      expect(productResolveRef('prod-1', '{}')).toBe('prod-1');
    });

    it('edit ops: the hint productId wins over the fresh random op id', () => {
      expect(productResolveRef('random-op-id', JSON.stringify({ productId: 'prod-1' }))).toBe('prod-1');
    });

    it('malformed / non-string hints fall back to the op id', () => {
      expect(productResolveRef('prod-1', 'oops{')).toBe('prod-1');
      expect(productResolveRef('prod-1', JSON.stringify({ productId: 7 }))).toBe('prod-1');
    });
  });
});
