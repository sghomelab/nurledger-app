/**
 * Hash-chained audit log (issue #26 design §4 — immutable security events).
 *
 * Pure logic — no DB/RN imports (only ./sha256). Each event row stores
 * `row_hash = sha256(prev_hash + '|' + canonicalJson(event))`. Any edit or
 * deletion of an old row breaks the chain from that point on; `verifyChain`
 * recomputes it. The repository (securityRepository) is the only writer and
 * exposes append-only paths — same discipline as the stock ledger (ADR-002).
 */

import { sha256Hex } from './sha256';

/** prev_hash of the first row of the chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** The fields that are covered by the chain (everything but the hashes). */
export interface SecurityEventFields {
  seq: number;
  ts: number;
  user_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  event_type: string;
  method: string | null;
  detail: string | null;
}

/** A stored row = the covered fields + its chain position. */
export interface ChainedSecurityEvent extends SecurityEventFields {
  prev_hash: string;
  row_hash: string;
}

/**
 * Canonical serialization: fixed key order, `null` → empty string, so the
 * hash is stable across JS engine/serialization differences.
 */
export function canonicalEventString(
  f: SecurityEventFields,
  prevHash: string,
): string {
  const s = (v: string | null) => v ?? '';
  return [
    prevHash,
    f.seq,
    f.ts,
    s(f.user_id),
    s(f.from_user_id),
    s(f.to_user_id),
    f.event_type,
    s(f.method),
    s(f.detail),
  ].join('|');
}

/** Compute the row hash for an event given its predecessor's hash. */
export function computeRowHash(
  f: SecurityEventFields,
  prevHash: string,
): string {
  return sha256Hex(canonicalEventString(f, prevHash));
}

export interface ChainVerification {
  ok: boolean;
  /** seq of the first row whose hash or predecessor link is invalid. */
  firstBadSeq: number | null;
  /** number of rows checked. */
  checked: number;
}

/**
 * Verify a chain given in ASCENDING seq order. Catches: edited fields (row
 * hash mismatch), edited/deleted middle rows (predecessor link mismatch),
 * re-ordered rows (link mismatch).
 */
export function verifyChain(events: ChainedSecurityEvent[]): ChainVerification {
  if (events.length === 0) return { ok: true, firstBadSeq: null, checked: 0 };
  let prev = GENESIS_HASH;
  for (const e of events) {
    if (e.prev_hash !== prev) {
      return { ok: false, firstBadSeq: e.seq, checked: events.length };
    }
    const { prev_hash: _p, row_hash: _r, ...fields } = e;
    if (computeRowHash(fields, prev) !== e.row_hash) {
      return { ok: false, firstBadSeq: e.seq, checked: events.length };
    }
    prev = e.row_hash;
  }
  return { ok: true, firstBadSeq: null, checked: events.length };
}
