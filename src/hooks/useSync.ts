/**
 * useSync — the M5 sync engine (FR-502, FR-503, ADR-002/ADR-010).
 *
 * One engine, shared by every mounted hook instance (Sell banner + Settings):
 * a module-level in-flight guard dedupes concurrent `syncNow()` calls.
 *
 * A sync = two phases, in order:
 *  1. **PUSH** — drain the outbox in FIFO batches. Each op's payload is
 *     RECONSTRUCTED at drain time from the immutable local source rows (so
 *     pre-M5 history syncs too). The server answers idempotently by client
 *     UUID; a confirmed op is marked uploaded. A batch failure stops the drain
 *     at the first failing op (FIFO) and is retried on the next tick.
 *  2. **PULL** — delta-pull products / sales / ledger rows since the stored
 *     cursors and apply them locally:
 *      - products: LWW (updated_at, device tie-break) — a local winner is kept,
 *        a remote winner is written;
 *      - sales + lines + payments + ledger rows: pure UNION by UUID (a row
 *        already present locally is skipped, NEVER overwritten) — stock is
 *        never client-merged; it stays a projection of the ledger (ADR-002).
 *      - refunds (M6): same union-by-UUID append-only rule; the header's sale
 *        uuid is resolved to the local sale id, the child lines' refund uuid to
 *        the local refund id (restock ledger rows arrive via the ledger pull).
 *     Cursors then advance (monotonic).
 *
 * Sync is OFF by default (cloud.sync_enabled = '0'/missing): the engine stays
 * idle, the outbox keeps queueing, nothing is dropped. Turning it on drains
 * the backlog (after a one-time backfill of pre-M5 rows).
 */

import { useCallback, useEffect, useState } from 'react';
import { getDb } from '../db/database';
import { createSupabaseAdapter } from '../lib/cloud/supabaseAdapter';
import type { CloudAdapter, CloudConfig } from '../lib/cloud/types';
import type { ProductDeltaRow, SyncPullResult, TableCursors } from '../lib/cloud/types';
import {
  advanceCursor,
  isRetryableError,
  planProductPull,
  pruneCategoryRemap,
  resolveCategoryDelta,
  type LocalProductMeta,
} from '../lib/sync';
import {
  clearSyncError,
  getCloudConfig,
  getLastSyncedAt,
  getLastSyncError,
  isSyncEnabled,
  recordSyncError,
  sdkStorage,
  setLastSyncedAt,
} from '../repositories/cloudConfigRepository';
import {
  backfillCategoriesOnce,
  backfillOnce,
  buildCategoryPayload,
  buildLedgerPayload,
  buildProductPayload,
  buildRefundPayload,
  buildSalePayload,
  getCursor,
  markUploaded,
  pendingCount,
  pendingOps,
  setCursor,
} from '../repositories/outboxRepository';
import { getDeviceId } from '../repositories/shiftRepository';

const DRAIN_BATCH = 20;
const DRAIN_MAX_ROUNDS = 50; // safety cap: 1000 ops per sync tick
const AUTO_SYNC_MS = 30_000;

export interface SyncState {
  /** A BYO connection is stored. */
  connected: boolean;
  /** The in-app toggle (OFF by default). */
  enabled: boolean;
  /** A sync is running right now. */
  syncing: boolean;
  /** Ops waiting in the outbox. */
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Engine (module-level — shared across hook instances)
// ---------------------------------------------------------------------------

let adapterSingleton: CloudAdapter | null = null;
function adapter(): CloudAdapter {
  if (!adapterSingleton) adapterSingleton = createSupabaseAdapter(sdkStorage);
  return adapterSingleton;
}

/** The shared CloudAdapter (session KV = local DB). The BYO setup wizard
 *  uses this so its sign-up lands in the same session store the engine uses. */
export function getCloudAdapter(): CloudAdapter {
  return adapter();
}

let inFlight: Promise<void> | null = null;

/** Push one FIFO batch; returns how many ops were confirmed uploaded. */
async function drainBatch(cfg: CloudConfig): Promise<number> {
  if (!cfg) return 0;
  const ops = await pendingOps(DRAIN_BATCH);
  if (ops.length === 0) return 0;

  const prepared: Array<{ opId: string; entity: 'sale' | 'ledger' | 'product' | 'refund' | 'category'; payload: string; createdAt: number }> = [];
  for (const op of ops) {
    // cfg.outletId is the CLOUD tenant id — payloads are re-keyed from the
    // device's local outlet id when this device joined an existing store.
    const payload =
      op.entity === 'sale'
        ? await buildSalePayload(op.opId, op.payload, cfg.outletId)
        : op.entity === 'ledger'
          ? await buildLedgerPayload(op.opId, cfg.outletId)
          : op.entity === 'refund'
            ? await buildRefundPayload(op.opId, op.payload, cfg.outletId)
            : op.entity === 'category'
              ? await buildCategoryPayload(op.opId, op.payload, cfg.outletId)
              : await buildProductPayload(op.opId, op.payload, cfg.outletId);
    if (payload == null) {
      // Poison op: the source row is gone (rows are immutable, so this is a
      // data-integrity surprise) — drop it so it cannot block the FIFO.
      await markUploaded([op.opId]);
      continue;
    }
    prepared.push({ opId: op.opId, entity: op.entity, payload, createdAt: op.createdAt });
  }
  if (prepared.length === 0) return 0;

  await adapter().pushOps(cfg, prepared); // throws on the first failing op (batch stops there)
  await markUploaded(prepared.map((p) => p.opId));
  return prepared.length;
}

/**
 * Apply pulled deltas to the local DB (one transaction).
 *
 * Returns the pulled rows that were SKIPPED because their parent record is
 * missing locally (CR-03, PR-2026-11). The old code THREW inside the
 * transaction on such a row: the whole pull rolled back, the cursors never
 * advanced, and every subsequent tick re-pulled the same batch and hit the
 * same row — a permanent, unrecoverable sync lockup. The parent of a pulled
 * child row can only be missing when the server itself holds an orphan (the
 * outbox is FIFO and the server's FKs normally prevent this), so the correct
 * response is to skip the child, keep the batch moving, and surface a
 * visible diagnostic — never to wedge the engine.
 */
async function applyPullLocally(pull: SyncPullResult): Promise<{ skipped: string[] }> {
  const db = await getDb();
  const outletRow = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outletRow) throw new Error('No outlet — DB not seeded');
  const outletId = outletRow.id;
  const skipped: string[] = [];
  await db.withTransactionAsync(async () => {
    // --- categories FIRST (M6, schema v3) — LWW by id, same rules as products.
    // Pulled before products so a product's category_id FK can never dangle:
    // without this, one device's CSV-created category broke EVERY other
    // device's pull batch (FK violation on the product upsert).
    //
    // Name-collision guard: the local `category.name` is UNIQUE, but two
    // devices can create same-named categories with different ids offline
    // (ids are per-device UUIDs; there is no rename path today). The pure
    // resolver (lib/sync.ts) keeps the LOCAL row's identity and remaps the
    // remote id onto it — pulled products referencing the remote id are
    // re-keyed below. (A hard INSERT would fail the whole batch — the exact
    // bug this fix removes.) The full local table is compared (small: shop
    // master data), not just the ids in the batch — a name clash with a
    // local row whose id isn't pulled this round must still be caught.
    // CR-04: the remap is PERSISTED (category_id_map, schema v7) and loaded
    // on EVERY tick. The old in-memory map only survived within a tick where
    // pull.categories was non-empty — on later ticks a product referencing a
    // previously-remapped remote category fell back to the raw remote id →
    // FK violation → the whole pull rolled back and wedged forever. The
    // loader only keeps entries whose local target still exists, so stale
    // rows self-clean.
    const catIdRemap = new Map<string, string>();
    const persisted = await db.getAllAsync<{ remote_id: string; local_id: string }>(
      `SELECT m.remote_id, m.local_id
         FROM category_id_map m
        WHERE m.local_id IN (SELECT id FROM category)`,
    );
    for (const r of persisted) catIdRemap.set(r.remote_id, r.local_id);

    if (pull.categories.length > 0) {
      const local = await db.getAllAsync<{ id: string; name: string; updatedAt: number }>(
        'SELECT id, name, COALESCE(updated_at, 0) AS updatedAt FROM category',
      );
      const localDevice = (await getDeviceId()) ?? 'unknown';
      const { toWrite, remap } = resolveCategoryDelta(
        local.map((r) => ({ ...r, updatedByDevice: localDevice })),
        pull.categories,
      );
      for (const [k, v] of remap) {
        catIdRemap.set(k, v);
        await db.runAsync(
          `INSERT INTO category_id_map (remote_id, local_id) VALUES (?, ?)
             ON CONFLICT (remote_id) DO UPDATE SET local_id = excluded.local_id`,
          [k, v],
        );
      }
      for (const cat of toWrite) {
        await db.runAsync(
          `INSERT INTO category (id, name, active, created_at, updated_at)
             VALUES (?, ?, 1, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               name = excluded.name, updated_at = excluded.updated_at`,
          [cat.id, cat.name, cat.createdAt, cat.updatedAt],
        );
      }
    }
    // CR-04: a remote id that now exists locally AS ITSELF no longer needs a
    // mapping (products referencing it resolve directly) — dropping the entry
    // keeps the table small and a stale entry can never re-key a product
    // onto a different row. Runs every tick: a category pulled as itself in
    // an earlier tick can invalidate an entry remapped before it landed.
    await db.runAsync(
      'DELETE FROM category_id_map WHERE remote_id IN (SELECT id FROM category)',
    );

    // --- products: LWW (updated_at, device tie-break) + CR-05 sku collisions ---
    if (pull.products.length > 0) {
      const ids = pull.products.map((p) => p.id);
      const skus = [...new Set(pull.products.map((p) => p.sku).filter((s) => s.length > 0))];
      const idPh = ids.map(() => '?').join(', ');
      const skuPh = skus.length > 0 ? skus.map(() => '?').join(', ') : 'NULL';
      // Load every local row that can interact with this batch: same-id rows
      // (LWW) AND (outlet-scoped) same-sku rows (CR-05 collision candidates).
      const local = await db.getAllAsync<{ id: string; sku: string; updatedAt: number }>(
        `SELECT id, sku, updated_at AS updatedAt FROM product
          WHERE id IN (${idPh}) OR (outlet_id = ? AND sku IN (${skuPh}))`,
        [...ids, outletId, ...skus],
      );
      const localDevice = (await getDeviceId()) ?? 'unknown'; // matches buildProductPayload's fallback
      const localMeta: LocalProductMeta[] = local.map((r) => ({
        id: r.id,
        sku: r.sku,
        updatedAt: r.updatedAt,
        updatedByDevice: localDevice,
      }));
      const plan = planProductPull(localMeta, pull.products);
      for (const item of plan) {
        const p = item;
        // A same-name/different-id category created offline on another
        // device is re-keyed onto the local row (see catIdRemap above) so
        // the local UNIQUE(name) invariant — and this FK — hold.
        const categoryId = p.categoryId ? (catIdRemap.get(p.categoryId) ?? p.categoryId) : null;

        if (p.decision.kind === 'write' && p.decision.preserveIdentity) {
          // CR-05: a (outlet_id, sku) collision where the INCOMING row won —
          // written under the EXISTING row's id, which keeps its id/sku/
          // created_at (local identity is canonical — the server's
          // apply_product unique_violation handler does the same with its
          // own id). No column may collide: sku is unchanged by design.
          await db.runAsync(
            `UPDATE product SET
               name = ?, category_id = ?, unit_type = ?, is_weighed = ?, barcode = ?,
               carton_barcode = ?, carton_size = ?, cost_minor = ?, price_minor = ?,
               tax_category = ?, min_qty = ?, max_qty = ?, velocity_class = ?,
               description = ?, active = ?, updated_at = ?
             WHERE id = ?`,
            [
              p.name, categoryId, p.unitType, p.isWeighed ? 1 : 0, p.barcode,
              p.cartonBarcode, p.cartonSize, p.costMinor, p.priceMinor, p.taxCategory,
              p.minQty, p.maxQty, p.velocityClass, p.description, p.active ? 1 : 0,
              p.updatedAt, p.decision.localId,
            ],
          );
          continue;
        }
        if (p.decision.kind === 'kept') continue;
        if (p.decision.kind === 'skipped') {
          // CR-05 guard: a same-id winner would rename its sku onto one owned
          // by another local row. The server RAISEs on this edge (its op
          // stays queued); locally we skip + surface (CR-03 philosophy)
          // instead of rolling the whole batch on the unique index.
          skipped.push(`product ${p.id} — rename to sku '${p.sku}' collides with a local row`);
          continue;
        }
        // 'write' + preserveIdentity=false: new row or same-id LWW winner —
        // the standard upsert (ON CONFLICT (id)).
        await db.runAsync(
          `INSERT INTO product
             (id, outlet_id, sku, name, category_id, unit_type, is_weighed, barcode,
              carton_barcode, carton_size, cost_minor, price_minor, tax_category,
              min_qty, max_qty, velocity_class, description, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             sku = excluded.sku, name = excluded.name, category_id = excluded.category_id,
             unit_type = excluded.unit_type, is_weighed = excluded.is_weighed,
             barcode = excluded.barcode, carton_barcode = excluded.carton_barcode,
             carton_size = excluded.carton_size, cost_minor = excluded.cost_minor,
             price_minor = excluded.price_minor, tax_category = excluded.tax_category,
             min_qty = excluded.min_qty, max_qty = excluded.max_qty,
             velocity_class = excluded.velocity_class, description = excluded.description,
             active = excluded.active, created_at = excluded.created_at, updated_at = excluded.updated_at`,
          [
            p.id, outletId, p.sku, p.name,
            categoryId,
            p.unitType, p.isWeighed ? 1 : 0,
            p.barcode, p.cartonBarcode, p.cartonSize, p.costMinor, p.priceMinor, p.taxCategory,
            p.minQty, p.maxQty, p.velocityClass, p.description, p.active ? 1 : 0,
            p.createdAt, p.updatedAt,
          ],
        );
      }
    }

    // --- sales + lines + payments: union by UUID (never overwrite local) ---
    // Remote rows carry the CLOUD tenant's outlet id; re-map to THIS device's
    // local outlet id so every local query (which is single-tenant) sees them.
    for (const s of pull.sales) {
      await db.runAsync(
        `INSERT INTO sale (id, uuid, outlet_id, device_id, cashier_id, shift_id, status,
           subtotal_minor, discount_minor, tax_minor, total_minor, cogs_minor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (uuid) DO NOTHING`,
        [
          s.id, s.uuid, outletId, s.deviceId, s.cashierId, s.shiftId, s.status,
          s.subtotalMinor, s.discountMinor, s.taxMinor, s.totalMinor, s.cogsMinor, s.createdAt,
        ],
      );
    }
    // Child rows (lines, payments) are keyed by the CLOUD sale uuid, but the
    // LOCAL FK points at sale.id — a different value, generated together with
    // the uuid at sale time on the originating device. Resolve uuid -> local
    // id from what is now in the local table (the insert above used the
    // original local id; a pre-existing local row keeps its own id).
    const saleIds = pull.sales.length > 0
      ? await db.getAllAsync<{ id: string; uuid: string }>(
        `SELECT id, uuid FROM sale WHERE uuid IN (${pull.sales.map(() => '?').join(', ')})`,
        pull.sales.map((s) => s.uuid),
      )
      : [];
    const saleIdByUuid = new Map(saleIds.map((r) => [r.uuid, r.id] as [string, string]));
    for (const l of pull.saleLines) {
      const saleId = saleIdByUuid.get(l.saleUuid);
      if (!saleId) {
        // CR-03: parent sale absent locally — skip (an FK would reject an
        // orphan) and keep the batch moving; the lockup came from throwing.
        skipped.push(`sale_line ${l.id} → sale ${l.saleUuid}`);
        continue;
      }
      await db.runAsync(
        `INSERT INTO sale_line (id, sale_id, product_id, lot_id, qty, qty_g, unit_price_minor,
           discount_minor, tax_minor, line_total_minor, unit_cost_minor, cogs_minor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [
          l.id, saleId, l.productId, l.lotId, l.qty, l.qtyG, l.unitPriceMinor,
          l.discountMinor, l.taxMinor, l.lineTotalMinor, l.unitCostMinor, l.cogsMinor, l.createdAt,
        ],
      );
    }
    for (const p of pull.payments) {
      const saleId = saleIdByUuid.get(p.saleUuid);
      if (!saleId) {
        skipped.push(`payment ${p.id} → sale ${p.saleUuid}`);
        continue;
      }
      await db.runAsync(
        `INSERT INTO payment (id, sale_id, method, amount_minor, reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, saleId, p.method, p.amountMinor, p.reference, p.createdAt],
      );
    }

    // --- refunds + lines (M6): union by UUID (append-only, never overwrite) ---
    // The refund header references the sale by uuid; resolve it to the local
    // sale id (the sale itself may have just landed in this same batch).
    const refundSaleUuids = pull.refunds
      .map((r) => r.saleUuid)
      .filter((u) => !saleIdByUuid.has(u));
    if (refundSaleUuids.length > 0) {
      const more = await db.getAllAsync<{ id: string; uuid: string }>(
        `SELECT id, uuid FROM sale WHERE uuid IN (${refundSaleUuids.map(() => '?').join(', ')})`,
        refundSaleUuids,
      );
      for (const r of more) saleIdByUuid.set(r.uuid, r.id);
    }
    for (const rf of pull.refunds) {
      const saleId = saleIdByUuid.get(rf.saleUuid);
      if (!saleId) {
        // CR-03: was `throw` — a refund whose sale hadn't landed rolled back
        // the whole pull and wedged every later tick on the same row.
        skipped.push(`refund ${rf.uuid} → sale ${rf.saleUuid}`);
        continue;
      }
      await db.runAsync(
        `INSERT INTO refund (id, uuid, sale_id, reason_code, restock, amount_minor, pin_verified_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (uuid) DO NOTHING`,
        [rf.id, rf.uuid, saleId, rf.reasonCode, rf.restock ? 1 : 0, rf.amountMinor, rf.userId, rf.createdAt],
      );
    }
    // refund_line.refund_id is the LOCAL refund id (the server row's `id` is
    // the same value — generated together with the uuid on the origin device).
    const refundIdByUuid = new Map<string, string>(
      pull.refunds.length > 0
        ? (await db.getAllAsync<{ id: string; uuid: string }>(
          `SELECT id, uuid FROM refund WHERE uuid IN (${pull.refunds.map(() => '?').join(', ')})`,
          pull.refunds.map((r) => r.uuid),
        )).map((r) => [r.uuid, r.id] as [string, string])
        : [],
    );
    for (const rl of pull.refundLines) {
      const refundId = refundIdByUuid.get(rl.refundUuid);
      if (!refundId) {
        skipped.push(`refund_line ${rl.id} → refund ${rl.refundUuid}`);
        continue;
      }
      await db.runAsync(
        `INSERT INTO refund_line (id, refund_id, sale_line_id, product_id, qty, qty_g, amount_minor, restock)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING`,
        [rl.id, refundId, rl.saleLineId, rl.productId, rl.qty, rl.qtyG, rl.amountMinor, rl.restock ? 1 : 0],
      );
    }

    // --- ledger rows: union by row UUID / op id (stock is NEVER client-merged) ---
    for (const l of pull.ledger) {
      await db.runAsync(
        `INSERT INTO stock_ledger (id, outlet_id, product_id, lot_id, type, qty_delta,
           qty_g_delta, unit_cost_minor, cogs_minor, ref_type, ref_id, reason,
           device_id, sync_op_id, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [
          l.rowId, outletId, l.productId, l.lotId, l.type, l.qtyDelta, l.qtyGDelta,
          l.unitCostMinor, l.cogsMinor, l.refType, l.refId, l.reason, l.deviceId,
          l.opId, l.createdAt, null,
        ],
      );
    }
  });
  return { skipped };
}

/** One full sync tick. Deduped across hook instances (in-flight guard). */
function syncTick(): Promise<void> {
  if (!inFlight) {
    inFlight = (async () => {
      const cfg = await getCloudConfig();
      if (!cfg) return; // not connected — nothing to do
      if (!(await isSyncEnabled())) return; // OFF by default — stay idle

      // First connect: enqueue pre-M5 history exactly once.
      await backfillOnce();
      // Schema v3: enqueue pre-v3 categories exactly once (seed/CSV categories
      // predate the category outbox entity; without this, the other devices
      // could never see them and product pulls would dangle on category_id).
      await backfillCategoriesOnce();

      // Phase 1 — PUSH (FIFO drain).
      for (let round = 0; round < DRAIN_MAX_ROUNDS; round++) {
        const pushed = await drainBatch(cfg);
        if (pushed === 0) break;
      }

      // Phase 2 — PULL (deltas since cursors) + local apply + cursor advance.
      const cursors: TableCursors = {
        category: await getCursor('category'),
        product: await getCursor('product'),
        sale: await getCursor('sale'),
        ledger: await getCursor('ledger'),
        refund: await getCursor('refund'),
      };
      const pull = await adapter().pullDeltas(cfg, cursors);
      const { skipped } = await applyPullLocally(pull);
      await setCursor('category', advanceCursor(cursors.category, pull.categories));
      await setCursor('product', advanceCursor(cursors.product, pull.products));
      await setCursor('sale', advanceCursor(cursors.sale, pull.sales));
      await setCursor('ledger', advanceCursor(cursors.ledger, pull.ledger));
      await setCursor('refund', advanceCursor(cursors.refund, pull.refunds));

      await clearSyncError();
      if (skipped.length > 0) {
        // CR-03: surface the skips in the sync banner (a missing parent is a
        // data-integrity surprise the owner should see, not a silent no-op).
        // Recorded AFTER clearSyncError so this tick's success doesn't wipe it;
        // the next clean tick clears it. Full details in the app log.
        console.warn(`[sync] skipped ${skipped.length} pulled row(s) with missing parent: ${skipped.join('; ')}`);
        await recordSyncError(
          `Skipped ${skipped.length} pulled record(s) — their parent (sale/refund) is missing on the server. Check your data or re-run the setup SQL.`,
        );
      }
      const now = Date.now();
      await setLastSyncedAt(now);
    })().catch(async (e) => {
      const message = e instanceof Error ? e.message : String(e);
      const status = typeof (e as { status?: unknown })?.status === 'number'
        ? ((e as { status?: number }).status as number)
        : undefined;
      // Retryable (transport/5xx/408/429) or permanent (4xx) — either way this
      // tick stops at the failing op and surfaces the error; the next tick
      // retries (a permanent error keeps failing until the user fixes the
      // connection, e.g. wrong service key).
      if (isRetryableError(status, status == null)) {
        await recordSyncError(message);
      } else {
        await recordSyncError(`Permanent error: ${message}`);
      }
    }).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const initialState: SyncState = {
  connected: false,
  enabled: false,
  syncing: false,
  pending: 0,
  lastSyncedAt: null,
  lastError: null,
};

export function useSync() {
  const [state, setState] = useState<SyncState>(initialState);

  const refresh = useCallback(async () => {
    const [connected, enabled, pending, lastSyncedAt, lastError] = await Promise.all([
      getCloudConfig().then((c) => c !== null),
      isSyncEnabled(),
      pendingCount(),
      getLastSyncedAt(),
      getLastSyncError().then((e) => (e ? e.message : null)),
    ]);
    setState((s) => ({ ...s, connected, enabled, pending, lastSyncedAt, lastError }));
  }, []);

  const syncNow = useCallback(async () => {
    // Pre-check (cheap settings reads) so an idle device never flashes the
    // "Syncing…" state, and so the banner refreshes even while the engine is
    // idle — the wizard may have saved a BYO connection while this screen was
    // mounted, and `connected` must track that without a remount.
    const [connected, enabled] = await Promise.all([
      getCloudConfig().then((c) => c !== null),
      isSyncEnabled(),
    ]);
    if (!connected || !enabled) {
      await refresh();
      return;
    }
    setState((s) => ({ ...s, syncing: true }));
    try {
      await syncTick();
    } finally {
      setState((s) => ({ ...s, syncing: false }));
      await refresh();
    }
  }, [refresh]);

  // Auto-sync while mounted: once on mount, then every AUTO_SYNC_MS. The
  // in-flight guard makes overlapping ticks (multiple mounted hooks) a no-op.
  useEffect(() => {
    void refresh();
    void syncNow();
    const iv = setInterval(() => {
      void syncNow();
    }, AUTO_SYNC_MS);
    return () => clearInterval(iv);
  }, [refresh, syncNow]);

  return { ...state, syncNow, refresh };
}
