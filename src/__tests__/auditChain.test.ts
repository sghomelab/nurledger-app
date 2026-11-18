/**
 * Hash-chained audit log (issue #26 design §4) — tamper detection.
 * @jest-environment node
 */
import {
  GENESIS_HASH,
  canonicalEventString,
  computeRowHash,
  verifyChain,
  type ChainedSecurityEvent,
  type SecurityEventFields,
} from '../lib/auditChain';

let n = 0;
function mkFields(over: Partial<SecurityEventFields> = {}): SecurityEventFields {
  n += 1;
  return {
    seq: n,
    ts: 1_700_000_000_000 + n,
    user_id: 'u1',
    from_user_id: null,
    to_user_id: null,
    event_type: 'unlock',
    method: 'pin',
    detail: null,
    ...over,
  };
}

beforeEach(() => {
  n = 0;
});

/** Build a valid chain of the given fields (in order). */
function buildChain(fields: SecurityEventFields[]): ChainedSecurityEvent[] {
  const out: ChainedSecurityEvent[] = [];
  let prev = GENESIS_HASH;
  for (const f of fields) {
    out.push({ ...f, prev_hash: prev, row_hash: computeRowHash(f, prev) });
    prev = out[out.length - 1]!.row_hash;
  }
  return out;
}

describe('auditChain', () => {
  it('genesis row links from the all-zero prev hash', () => {
    const chain = buildChain([mkFields()]);
    expect(chain[0]?.prev_hash).toBe(GENESIS_HASH);
    expect(verifyChain(chain).ok).toBe(true);
  });

  it('a clean chain verifies', () => {
    const chain = buildChain([mkFields(), mkFields({ event_type: 'lock' }), mkFields({ event_type: 'switch_user' })]);
    expect(verifyChain(chain)).toEqual({ ok: true, firstBadSeq: null, checked: 3 });
  });

  it('empty chain verifies', () => {
    expect(verifyChain([])).toEqual({ ok: true, firstBadSeq: null, checked: 0 });
  });

  it('detects an edited field (row hash mismatch)', () => {
    const chain = buildChain([mkFields(), mkFields({ event_type: 'lock' })]);
    chain[1]!.detail = 'tampered'; // field covered by the hash
    const v = verifyChain(chain);
    expect(v.ok).toBe(false);
    expect(v.firstBadSeq).toBe(2);
  });

  it('detects a deleted middle row (predecessor link mismatch)', () => {
    const chain = buildChain([mkFields(), mkFields({ event_type: 'lock' }), mkFields({ event_type: 'switch_user' })]);
    chain.splice(1, 1); // delete row 2 — row 3 still points at the deleted row's hash
    const v = verifyChain(chain);
    expect(v.ok).toBe(false);
    expect(v.firstBadSeq).toBe(3);
  });

  it('detects a re-ordered chain (link mismatch)', () => {
    const chain = buildChain([mkFields(), mkFields({ event_type: 'lock' })]);
    [chain[0], chain[1]] = [chain[1]!, chain[0]!];
    expect(verifyChain(chain).ok).toBe(false);
  });

  it('detects a forged row inserted at the head', () => {
    const chain = buildChain([mkFields(), mkFields({ event_type: 'lock' })]);
    const forged = mkFields({ seq: 0, event_type: 'shift_start' });
    chain.unshift({ ...forged, prev_hash: GENESIS_HASH, row_hash: computeRowHash(forged, GENESIS_HASH) });
    // real row 1 now claims prev = genesis, but the head row's hash is in front of it
    expect(verifyChain(chain).ok).toBe(false);
  });

  it('canonical form treats null as empty string and orders keys fixedly', () => {
    const base = { seq: 1, ts: 1_700_000_000_001, user_id: 'u1', from_user_id: null, to_user_id: null, event_type: 'unlock', method: 'pin' };
    const a = { ...base, detail: null };
    const b = { ...base, detail: '' };
    expect(canonicalEventString(a, GENESIS_HASH)).toBe(canonicalEventString(b, GENESIS_HASH));
    // key order is fixed regardless of object insertion order
    const reordered: SecurityEventFields = { method: a.method, detail: a.detail, seq: a.seq, ts: a.ts, user_id: a.user_id, from_user_id: a.from_user_id, to_user_id: a.to_user_id, event_type: a.event_type };
    expect(canonicalEventString(reordered, GENESIS_HASH)).toBe(canonicalEventString(a, GENESIS_HASH));
  });
});
