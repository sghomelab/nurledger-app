/**
 * Sync core logic (FR-502, ADR-002) — pure, unit-testable in node. No DB, no RN,
 * no network. This module owns the rules that make multi-device sync correct:
 *
 *  - **FIFO outbox**: ops upload strictly in creation order (created_at, then
 *    insertion seq). Order matters because a sale's ledger rows must land before
 *    any later op that depends on that stock state.
 *  - **Client-UUID idempotency**: every op carries a stable client-generated
 *    UUID (`opId`). The server applies ops `ON CONFLICT DO NOTHING`-style, so a
 *    retry after a dropped reply is a no-op. The client treats a server
 *    "duplicate" answer as SUCCESS and marks the op uploaded (no double-apply).
 *  - **Products: LWW with audit** — last-write-wins by `updatedAt`; ties break
 *    deterministically by `updatedByDevice` so every device agrees on the winner.
 *    A losing write must produce an audit row (server-side `product_audit`;
 *    `lwwOutcome` tells the caller which side lost).
 *  - **Stock is NEVER client-merged** — ledger rows and sales are applied as a
 *    pure UNION by UUID. A row already present locally is skipped, never
 *    overwritten. Stock on hand is always a projection of the ledger
 *    (ADR-002), so the union has no lost-update conflict at all.
 *  - **Delta cursors** advance to the max timestamp seen and never rewind.
 */

/** Outbox entities the M5 engine knows about. */
export type SyncEntity = 'sale' | 'ledger' | 'product' | 'refund' | 'category';

/** A queued outbox op (local row, pre-upload). */
export interface OutboxOp {
  /** Local row id. */
  id: string;
  /** Client-generated UUID — the server-side idempotency key. Stable across retries. */
  opId: string;
  entity: SyncEntity;
  /** Epoch ms — FIFO ordering primary key. */
  createdAt: number;
  /** Insertion order tie-breaker (SQLite rowid) for equal timestamps. */
  seq: number;
}

/**
 * Strict FIFO: `createdAt` ascending, `seq` ascending as the tie-breaker.
 * Never reorders an older op behind a newer one, even if the newer op was
 * enqueued first (clock skew between writes).
 */
export function fifoOrder(ops: OutboxOp[]): OutboxOp[] {
  return [...ops].sort((a, b) => (a.createdAt - b.createdAt) || (a.seq - b.seq));
}

/** First `limit` pending ops in FIFO order (the drain batch). */
export function nextDrainBatch(ops: OutboxOp[], limit: number): OutboxOp[] {
  return fifoOrder(ops).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Outbox op → source-row resolution (drain-time payload reconstruction)
// ---------------------------------------------------------------------------

/**
 * Ordered, de-duplicated candidate refs for resolving a SALE op to its source
 * row at drain time. The sale path enqueues with `op_id = sale.uuid`, so the
 * op id itself is the first candidate; legacy ops (early M5 builds) queued a
 * RANDOM op_id whose only pointer to the sale is the stored hint's
 * `saleId`/`saleUuid`. The caller matches each candidate against BOTH
 * `sale.uuid` and `sale.id` (the DB does the existence check).
 *
 * Regression (2026-10-31, two-device E2E): the drain previously resolved by
 * `sale.id = op_id` only — since sale.id ≠ sale.uuid for every sale, every
 * sale payload resolved null and the FIFO silently dropped all sales as
 * "poison ops".
 */
export function saleResolveCandidates(opId: string, payloadHint: string | null): string[] {
  const out: string[] = [opId];
  if (payloadHint) {
    try {
      const hint = JSON.parse(payloadHint) as Record<string, unknown>;
      for (const key of ['saleId', 'saleUuid']) {
        const v = hint[key];
        if (typeof v === 'string' && v.length > 0 && !out.includes(v)) out.push(v);
      }
    } catch {
      // malformed hint — the op id is the only candidate
    }
  }
  return out;
}

/**
 * Resolve a PRODUCT op to the row it reconstructs. Create/backfill ops carry
 * `op_id = product.id`; edit + deactivate ops carry a FRESH random op_id
 * (distinct edits must not dedupe against each other via ON CONFLICT) and
 * point at the row through the stored hint `{ productId }`.
 *
 * Regression (2026-10-31): resolving by `product.id = op_id` matched create
 * ops only — every product edit/deactivation payload resolved null and was
 * dropped as a poison op.
 */
export function productResolveRef(opId: string, payloadHint: string | null): string {
  if (payloadHint) {
    try {
      const hint = JSON.parse(payloadHint) as { productId?: unknown };
      if (typeof hint.productId === 'string' && hint.productId.length > 0) return hint.productId;
    } catch {
      // malformed hint — fall back to the op id
    }
  }
  return opId;
}

/**
 * Server answers to an idempotent push. ANY of these means "the server has
 * recorded this op (or already had it)" — the client may mark it uploaded.
 * A throw / transport error means "retry later" (see isRetryableError).
 */
export type OpResult =
  | 'applied'      // sale inserted + ledger rows appended
  | 'duplicate'    // sale uuid already present → no-op (idempotency proof)
  | 'created'      // product did not exist → inserted + audit row
  | 'updated'      // product LWW: incoming won → audit row for the overwritten value
  | 'kept';        // product LWW: existing won → audit row for the rejected write

/** True for every result the client should treat as "uploaded successfully". */
export function isUploadedResult(r: OpResult): boolean {
  return r === 'applied' || r === 'duplicate' || r === 'created' || r === 'updated' || r === 'kept';
}

/**
 * Retry policy: network/5xx → retry (with backoff); 4xx (except 408/429) →
 * permanent (bad payload / auth) — stop and surface the error. The sync engine
 * never loops forever on a poison op.
 */
export function isRetryableError(status: number | undefined, networkError: boolean): boolean {
  if (networkError) return true;
  if (status == null) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

// ---------------------------------------------------------------------------
// Last-write-wins (products) — acceptance: "product edits LWW with audit row"
// ---------------------------------------------------------------------------

export interface LwwMeta {
  /** Client-observed edit time, epoch ms. */
  updatedAt: number;
  /** Which device made the edit — deterministic tie-breaker (null-safe: '' ). */
  updatedByDevice: string | null;
}

export interface LwwOutcome {
  /** Which record is the final state. */
  winner: 'incoming' | 'existing';
  /** Why (for the audit row + tests). */
  reason: 'later-timestamp' | 'earlier-timestamp' | 'device-tiebreak';
  /** The record that did NOT win (payload for the audit row). */
  loser: 'incoming' | 'existing';
}

/**
 * Pure LWW decision. Greater `updatedAt` wins; on an exact tie the
 * lexicographically GREATER `updatedByDevice` wins (deterministic on every
 * device — two devices comparing the same two records must agree). Null
 * devices sort as '' (never wins a tie against a named device).
 */
export function lwwOutcome(existing: LwwMeta, incoming: LwwMeta): LwwOutcome {
  if (incoming.updatedAt > existing.updatedAt) {
    return { winner: 'incoming', reason: 'later-timestamp', loser: 'existing' };
  }
  if (incoming.updatedAt < existing.updatedAt) {
    return { winner: 'existing', reason: 'earlier-timestamp', loser: 'incoming' };
  }
  const eDev = existing.updatedByDevice ?? '';
  const iDev = incoming.updatedByDevice ?? '';
  if (iDev >= eDev) {
    return { winner: 'incoming', reason: 'device-tiebreak', loser: 'existing' };
  }
  return { winner: 'existing', reason: 'device-tiebreak', loser: 'incoming' };
}

// ---------------------------------------------------------------------------
// Delta application (pull direction)
// ---------------------------------------------------------------------------

/**
 * Apply rows pulled from the server to a local set, mode 'lww' (products).
 * Returns the rows that should be WRITTEN locally (winners only) and the
 * rejected ones (for a local audit note). Existing local rows that lose are
 * replaced; rows that win over the remote are left untouched (nothing returned
 * for them).
 */
export function applyLwwDelta<R extends LwwMeta & { id: string }>(
  localById: Map<string, LwwMeta>,
  remote: R[],
): { toWrite: R[]; rejected: Array<{ id: string; outcome: LwwOutcome }> } {
  const toWrite: R[] = [];
  const rejected: Array<{ id: string; outcome: LwwOutcome }> = [];
  for (const r of remote) {
    const existing = localById.get(r.id);
    if (!existing) {
      toWrite.push(r); // new product — adopt
      continue;
    }
    if (existing.updatedAt === r.updatedAt && existing.updatedByDevice === r.updatedByDevice) {
      continue; // identical — nothing to do
    }
    const outcome = lwwOutcome(existing, r);
    if (outcome.winner === 'incoming') toWrite.push(r);
    else rejected.push({ id: r.id, outcome });
  }
  return { toWrite, rejected };
}

/**
 * Apply rows pulled from the server to a local set, mode 'union' (sales,
 * ledger rows, payments) — idempotent by id: a row already present locally is
 * SKIPPED (never overwritten). Returns the rows to insert.
 */
export function applyUnionDelta<R extends { id: string }>(
  localIds: Set<string>,
  remote: R[],
): { toInsert: R[]; skipped: number } {
  const toInsert: R[] = [];
  let skipped = 0;
  for (const r of remote) {
    if (localIds.has(r.id)) skipped += 1;
    else toInsert.push(r);
  }
  return { toInsert, skipped };
}

/**
 * Advance a per-table delta cursor to the max `syncedAt` observed (v4: the
 * server-stamped receipt time — client `updatedAt` is the LWW key on
 * product/category and must NOT drive cursors; a backdated client time is
 * exactly how offline rows got stranded, PR-2026-11 / CR-02). Never rewinds
 * (a stale pull must not lose rows).
 */
export function advanceCursor(current: number, rows: Array<{ syncedAt: number }>): number {
  let max = current;
  for (const r of rows) if (r.syncedAt > max) max = r.syncedAt;
  return max;
}

// ---------------------------------------------------------------------------
// Categories (M6, cloud schema v3) — pull resolution
// ---------------------------------------------------------------------------

/**
 * Resolve pulled CATEGORIES against local state (M6, schema v3).
 *
 * Categories sync like products (LWW by updated_at, device tie-break) but
 * carry one extra invariant: the LOCAL `category.name` is UNIQUE, while ids
 * are per-device UUIDs — two devices can create same-named categories with
 * DIFFERENT ids while offline. The server deliberately has no
 * UNIQUE(outlet_id, name) (a constraint would stall the FIFO drain), so the
 * collision must be resolved on pull:
 *  - same id → LWW (a remote winner updates the local name);
 *  - different id but same name (case-insensitive) → the LOCAL row keeps
 *    identity and the remote id is REMAPPED onto it (returned in `remap`),
 *    so products referencing the remote id are re-keyed and the UNIQUE(name)
 *    invariant never breaks the pull batch (the exact bug that stranded
 *    device B's pull on a product.category_id FK violation, 2026-10-31).
 *
 * Returns the categories to WRITE (id- and name-clean) plus the
 * remote-id → local-id remap.
 */
export function resolveCategoryDelta<R extends LwwMeta & { id: string; name: string }>(
  local: Array<LwwMeta & { id: string; name: string }>,
  remote: R[],
): { toWrite: R[]; remap: Map<string, string> } {
  const localById = new Map(local.map((c): [string, LwwMeta] => [c.id, c]));
  const { toWrite } = applyLwwDelta(localById, remote);
  const remap = new Map<string, string>();
  const localNameById = new Map(local.map((c): [string, string] => [c.name.toLowerCase(), c.id]));
  // Names already claimed earlier in THIS batch (two new same-named remote
  // categories from two devices, pulled by a third — the server holds both).
  const writtenNameById = new Map<string, string>();
  const writes: R[] = [];
  for (const w of toWrite) {
    const lc = w.name.toLowerCase();
    const clashId = writtenNameById.get(lc) ?? localNameById.get(lc);
    if (clashId !== undefined && clashId !== w.id) {
      remap.set(w.id, clashId);
    } else {
      writes.push(w);
      writtenNameById.set(lc, w.id);
    }
  }
  return { toWrite: writes, remap };
}

// ---------------------------------------------------------------------------
// Product pull plan (CR-05) — concurrent offline SKU collisions
// ---------------------------------------------------------------------------

/** The local state needed to plan a product pull (identity + sku + LWW meta). */
export interface LocalProductMeta extends LwwMeta {
  id: string;
  sku: string;
}

export type ProductPullDecision =
  /** Write the row under `localId`.
   *  - `preserveIdentity: false` — normal upsert (`localId` === the incoming
   *    id; every field including sku is written).
   *  - `preserveIdentity: true` — the winner of a (outlet_id, sku) collision,
   *    written under the EXISTING row's id, which keeps its id/sku/created_at
   *    (local identity is canonical — mirrors the server's `apply_product`
   *    unique_violation handler, which keeps the existing row's id). */
  | { kind: 'write'; localId: string; preserveIdentity: boolean }
  /** No write: the local row won the LWW, or the row is identical (replay). */
  | { kind: 'kept'; reason: 'loser' | 'identical' }
  /** No write + diagnostic: a same-id LWW winner would rename its sku onto a
   *  sku already owned by another local row. The server RAISEs on this edge
   *  (its op stays queued); locally we skip + surface it (CR-03 philosophy)
   *  instead of rolling the whole pull batch on a SQLite unique-constraint
   *  failure. */
  | { kind: 'skipped'; reason: 'sku-rename-collision' };

/**
 * Decide, per incoming product, how to apply it against local state (CR-05).
 *
 * Two offline devices can create different rows (different ids) with the SAME
 * (outlet_id, sku) before either syncs. The local `idx_product_sku` UNIQUE
 * index makes a blind upsert throw and roll back the ENTIRE pull — the bug
 * this planner removes. Per incoming row:
 *  - a local row with the SAME id exists → plain LWW (the current rule);
 *  - otherwise a local row owns the incoming (outlet_id, sku) → LWW on that
 *    row; the winner is written under the EXISTING row's id (local identity
 *    canonical, exactly the server's semantics), keeping its id/sku/created_at;
 *  - otherwise → a new row under the incoming id.
 *
 * Within-batch sku ownership is tracked as the plan proceeds (an earlier
 * insert/same-id rename must be visible to a later row). `local` must contain
 * every local row whose id or (outlet-scoped) sku is referenced by `incoming`
 * — the caller loads both sets in one query.
 */
export function planProductPull<R extends LwwMeta & { id: string; sku: string }>(
  local: LocalProductMeta[],
  incoming: R[],
): Array<R & { decision: ProductPullDecision }> {
  const localById = new Map(local.map((r): [string, LocalProductMeta] => [r.id, r]));
  const skuOwner = new Map<string, string>(); // sku → local row id
  for (const r of local) if (r.sku) skuOwner.set(r.sku, r.id);

  const out: Array<R & { decision: ProductPullDecision }> = [];
  for (const p of incoming) {
    const existing = localById.get(p.id);
    if (existing) {
      if (existing.updatedAt === p.updatedAt && existing.updatedByDevice === p.updatedByDevice) {
        out.push({ ...p, decision: { kind: 'kept', reason: 'identical' } });
        continue;
      }
      if (lwwOutcome(existing, p).winner !== 'incoming') {
        out.push({ ...p, decision: { kind: 'kept', reason: 'loser' } });
        continue;
      }
      // Same-id winner — but its (possibly renamed) sku may be owned by
      // another row: the server RAISEs on that edge; locally skip + surface.
      const owner = p.sku ? skuOwner.get(p.sku) : undefined;
      if (owner !== undefined && owner !== p.id) {
        out.push({ ...p, decision: { kind: 'skipped', reason: 'sku-rename-collision' } });
        continue;
      }
      out.push({ ...p, decision: { kind: 'write', localId: p.id, preserveIdentity: false } });
      if (p.sku) {
        if (existing.sku && skuOwner.get(existing.sku) === p.id) skuOwner.delete(existing.sku);
        skuOwner.set(p.sku, p.id);
      }
      continue;
    }
    // New id — does another local row own its sku?
    const owner = p.sku ? skuOwner.get(p.sku) : undefined;
    if (owner === undefined) {
      out.push({ ...p, decision: { kind: 'write', localId: p.id, preserveIdentity: false } });
      if (p.sku) skuOwner.set(p.sku, p.id); // visible to later rows in THIS batch
      continue;
    }
    const ownerRow = localById.get(owner);
    if (!ownerRow) {
      // Unreachable (skuOwner is derived from the same `local` list) — adopt.
      out.push({ ...p, decision: { kind: 'write', localId: p.id, preserveIdentity: false } });
      continue;
    }
    if (ownerRow.updatedAt === p.updatedAt && ownerRow.updatedByDevice === p.updatedByDevice) {
      out.push({ ...p, decision: { kind: 'kept', reason: 'identical' } });
      continue;
    }
    if (lwwOutcome(ownerRow, p).winner !== 'incoming') {
      out.push({ ...p, decision: { kind: 'kept', reason: 'loser' } });
      continue;
    }
    // Incoming wins: written under the existing row's id, preserving its
    // id/sku/created_at (the server keeps ITS row's id — same rule, local
    // mirror).
    out.push({ ...p, decision: { kind: 'write', localId: owner, preserveIdentity: true } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Category remap persistence (CR-04)
// ---------------------------------------------------------------------------

/**
 * CR-04: drop remap entries whose remote id now EXISTS locally as itself.
 * Once the remote row is in the local `category` table, products referencing
 * it resolve directly — a leftover `remote → other` mapping would wrongly
 * re-key them onto a different local row. Entries whose LOCAL target is gone
 * are dropped by the loader (it only selects rows joined to live `category`).
 */
export function pruneCategoryRemap(
  remap: Map<string, string>,
  localCategoryIds: Set<string>,
): Map<string, string> {
  const out = new Map(remap);
  for (const remoteId of [...out.keys()]) {
    if (localCategoryIds.has(remoteId)) out.delete(remoteId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convergence helpers (used by the two-device exit test + its unit twin)
// ---------------------------------------------------------------------------

/**
 * Two ledgers are identical iff they contain the same set of ledger-op UUIDs,
 * each with the same signed delta. Order-independent — the union of both
 * devices' appends must equal the server's set.
 */
export function ledgerSignature(rows: Array<{ opId: string; qtyDelta: number | null }>): string {
  const m = new Map<string, number>();
  for (const r of rows) if (r.opId) m.set(r.opId, r.qtyDelta ?? 0);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join('|');
}

/** Signature of the sales a ledger/outbox represents (client UUIDs). */
export function saleSignature(rows: Array<{ uuid: string }>): string {
  return [...new Set(rows.map((r) => r.uuid))].sort().join('|');
}
