/**
 * Security repository (issue #26 design §2–§5) — the ONLY writer of
 * `security_events` (insert-only, hash-chained audit log) and the home of the
 * Store PIN + one-time recovery code (secureKv/keystore — NEVER SQLite: the
 * settings table is world-readable by any local process with the app's uid).
 *
 * Discipline (design §4, ADR-002):
 *  - appendSecurityEvent is the only mutation of security_events; no
 *    update/delete path exists anywhere in the codebase.
 *  - Store-PIN operations are attributed: setStorePin / consumeRecoveryCode
 *    take the acting user id and log themselves.
 *  - A Store-PIN unlock is ALWAYS attributed to the Owner (design §2
 *    attribution rule) — that happens in the caller (useSecurity), which
 *    passes the owner's user id.
 */

import { getDb } from '../db/database';
import { createSecureKv } from '../lib/secureKv';
import { expoSecureBackend } from '../lib/secureKvBackend';
import {
  GENESIS_HASH,
  computeRowHash,
  verifyChain,
  type ChainVerification,
} from '../lib/auditChain';
import { createPinHash, isValidPin, verifyPin } from '../lib/pin';
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from '../lib/storePin';

const kv = createSecureKv(expoSecureBackend);
const K = {
  pinHash: 'store.pin_hash',
  recoveryHash: 'store.recovery_hash',
} as const;

/** The event vocabulary (design §4) — kept narrow so reports stay legible. */
export type SecurityEventType =
  | 'shift_start'
  | 'shift_end'
  | 'user_switch'
  | 'auto_lock'
  | 'unlock'
  | 'pin_set'
  | 'pin_reset'
  | 'recovery_used'
  | 'integrity_check';

export interface SecurityEventInput {
  /** The identity the event is attributed to (never null for actor events;
   *  null only for system events that have no actor). */
  user_id: string | null;
  /** user_switch: the identity being switched FROM. */
  from_user_id?: string | null;
  /** user_switch / unlock-as-other: the identity being switched TO. */
  to_user_id?: string | null;
  event_type: SecurityEventType;
  /** How it happened: 'pin' | 'store_pin' | 'recovery_code' | 'system'. */
  method?: string | null;
  /** Free-form detail (e.g. 'ok' / 'FAIL first_bad_seq=3 checked=41'). */
  detail?: string | null;
}

/** A stored chain row (what listSecurityEvents returns, in ASCENDING seq order). */
export interface SecurityEventRow {
  seq: number;
  ts: number;
  user_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  event_type: string;
  method: string | null;
  detail: string | null;
  prev_hash: string;
  row_hash: string;
}

/**
 * Append one event to the chain (the only write path). The read of the chain
 * tail + the insert run in ONE transaction so two concurrent appends can
 * never fork the chain (same single connection, serialized by the txn).
 */
export async function appendSecurityEvent(input: SecurityEventInput): Promise<SecurityEventRow> {
  const db = await getDb();
  const row: { value: SecurityEventRow } = { value: null as unknown as SecurityEventRow };
  await db.withTransactionAsync(async () => {
    const last = await db.getFirstAsync<{ seq: number; row_hash: string }>(
      `SELECT seq, row_hash FROM security_events ORDER BY seq DESC LIMIT 1`,
    );
    const seq = (last?.seq ?? 0) + 1;
    const prev_hash = last?.row_hash ?? GENESIS_HASH;
    const fields = {
      seq,
      ts: Date.now(),
      user_id: input.user_id,
      from_user_id: input.from_user_id ?? null,
      to_user_id: input.to_user_id ?? null,
      event_type: input.event_type,
      method: input.method ?? null,
      detail: input.detail ?? null,
    };
    const row_hash = computeRowHash(fields, prev_hash);
    await db.runAsync(
      `INSERT INTO security_events
         (seq, ts, user_id, from_user_id, to_user_id, event_type, method, detail, prev_hash, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fields.seq,
        fields.ts,
        fields.user_id,
        fields.from_user_id,
        fields.to_user_id,
        fields.event_type,
        fields.method,
        fields.detail,
        prev_hash,
        row_hash,
      ],
    );
    row.value = { ...fields, prev_hash, row_hash };
  });
  return row.value;
}

/** All events in ascending chain order (empty list on a fresh install). */
export async function listSecurityEvents(): Promise<SecurityEventRow[]> {
  const db = await getDb();
  return db.getAllAsync<SecurityEventRow>(
    `SELECT seq, ts, user_id, from_user_id, to_user_id, event_type, method, detail,
            prev_hash, row_hash
       FROM security_events ORDER BY seq ASC`,
  );
}

/** Recompute the whole chain and report where (if anywhere) it breaks. */
export async function verifySecurityChain(): Promise<ChainVerification> {
  return verifyChain(await listSecurityEvents());
}

/**
 * Integrity check (design §4): verify the chain AND log the check itself as
 * an event (so the log also shows WHEN the last check ran and what it found).
 * Returns the verification result; the appended event's detail carries it.
 */
export async function runIntegrityCheck(actorUserId: string | null): Promise<ChainVerification> {
  const result = await verifySecurityChain();
  const detail = result.ok
    ? `ok checked=${result.checked}`
    : `FAIL first_bad_seq=${result.firstBadSeq} checked=${result.checked}`;
  await appendSecurityEvent({
    user_id: actorUserId,
    event_type: 'integrity_check',
    method: 'system',
    detail,
  });
  return result;
}

// ── Store PIN (design §2/§3) ────────────────────────────────────────────────

/** The stored Store PIN hash, or null if the owner has not set one yet. */
export async function getStorePinHash(): Promise<string | null> {
  return kv.getItem(K.pinHash);
}

/** True once the owner has set a Store PIN (gates the lock-screen flow). */
export async function hasStorePin(): Promise<boolean> {
  return (await getStorePinHash()) !== null;
}

/** Verify a PIN against the stored Store PIN hash. */
export async function verifyStorePin(pin: string): Promise<boolean> {
  return verifyPin(await getStorePinHash(), pin);
}

/**
 * Set (or replace) the Store PIN. Generates a FRESH one-time recovery code —
 * the plaintext is returned exactly ONCE, for the owner to store offline
 * (Copy / Print / Email me, design §3). The old recovery code, if any, is
 * invalidated. Logs a `pin_set` event attributed to the acting owner.
 */
export async function setStorePin(
  pin: string,
  actorUserId: string,
): Promise<{ recoveryCode: string }> {
  if (!isValidPin(pin)) throw new Error('store pin invalid');
  const recoveryCode = generateRecoveryCode();
  await kv.setItem(K.pinHash, createPinHash(pin));
  await kv.setItem(K.recoveryHash, hashRecoveryCode(recoveryCode)!);
  await appendSecurityEvent({
    user_id: actorUserId,
    event_type: 'pin_set',
    method: 'store_pin',
    detail: 'store pin set',
  });
  return { recoveryCode };
}

/**
 * Consume the one-time recovery code (design §3): if it matches, it is DELETED
 * (single use) and a `recovery_used` event is logged; the caller then runs
 * setStorePin to choose the new Store PIN (which issues a new recovery code).
 * Returns false (and changes nothing) on a wrong code.
 */
export async function consumeRecoveryCode(
  input: string,
  actorUserId: string,
): Promise<boolean> {
  const stored = await kv.getItem(K.recoveryHash);
  if (!stored || !verifyRecoveryCode(input, stored)) return false;
  await kv.removeItem(K.recoveryHash);
  await appendSecurityEvent({
    user_id: actorUserId,
    event_type: 'recovery_used',
    method: 'recovery_code',
    detail: 'one-time recovery code consumed',
  });
  return true;
}

/**
 * Wipe Store-PIN state (factory reset / disconnect). The audit table itself
 * is wiped by the caller's DB reset — this only clears the keystore secrets.
 * clearAll (not per-key remove) so the kv index row goes too.
 */
export async function clearStorePin(): Promise<void> {
  await kv.clearAll();
}
