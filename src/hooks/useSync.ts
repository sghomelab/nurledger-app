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
  applyLwwDelta,
  isRetryableError,
  type LwwMeta,
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
  backfillOnce,
  buildLedgerPayload,
  buildProductPayload,
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

  const prepared: Array<{ opId: string; entity: 'sale' | 'ledger' | 'product'; payload: string; createdAt: number }> = [];
  for (const op of ops) {
    // cfg.outletId is the CLOUD tenant id — payloads are re-keyed from the
    // device's local outlet id when this device joined an existing store.
    const payload =
      op.entity === 'sale'
        ? await buildSalePayload(op.opId, op.payload, cfg.outletId)
        : op.entity === 'ledger'
          ? await buildLedgerPayload(op.opId, cfg.outletId)
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

/** Apply pulled deltas to the local DB (one transaction). */
async function applyPullLocally(pull: SyncPullResult): Promise<void> {
  const db = await getDb();
  const outletRow = await db.getFirstAsync<{ id: string }>('SELECT id FROM outlet LIMIT 1');
  if (!outletRow) throw new Error('No outlet — DB not seeded');
  const outletId = outletRow.id;
  await db.withTransactionAsync(async () => {
    // --- products: LWW (updated_at, device tie-break) ---
    if (pull.products.length > 0) {
      const ph = pull.products.map(() => '?').join(', ');
      const local = await db.getAllAsync<{ id: string; updatedAt: number }>(
        `SELECT id, updated_at AS updatedAt FROM product WHERE id IN (${ph})`,
        pull.products.map((p) => p.id),
      );
      const localDevice = (await getDeviceId()) ?? 'unknown'; // matches buildProductPayload's fallback
      const localById = new Map<string, LwwMeta>(
        local.map((r): [string, LwwMeta] => [r.id, { updatedAt: r.updatedAt, updatedByDevice: localDevice }]),
      );
      const { toWrite } = applyLwwDelta(localById, pull.products);
      for (const p of toWrite) {
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
            p.id, outletId, p.sku, p.name, p.categoryId, p.unitType, p.isWeighed ? 1 : 0,
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
        // Integrity surprise: a pulled line whose sale is absent locally.
        // Fail loudly rather than write an orphan (the FK would reject it).
        throw new Error(`Pulled sale_line ${l.id} references unknown sale uuid ${l.saleUuid}`);
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
        throw new Error(`Pulled payment ${p.id} references unknown sale uuid ${p.saleUuid}`);
      }
      await db.runAsync(
        `INSERT INTO payment (id, sale_id, method, amount_minor, reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, saleId, p.method, p.amountMinor, p.reference, p.createdAt],
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

      // Phase 1 — PUSH (FIFO drain).
      for (let round = 0; round < DRAIN_MAX_ROUNDS; round++) {
        const pushed = await drainBatch(cfg);
        if (pushed === 0) break;
      }

      // Phase 2 — PULL (deltas since cursors) + local apply + cursor advance.
      const cursors: TableCursors = {
        product: await getCursor('product'),
        sale: await getCursor('sale'),
        ledger: await getCursor('ledger'),
      };
      const pull = await adapter().pullDeltas(cfg, cursors);
      await applyPullLocally(pull);
      await setCursor('product', advanceCursor(cursors.product, pull.products));
      await setCursor('sale', advanceCursor(cursors.sale, pull.sales));
      await setCursor('ledger', advanceCursor(cursors.ledger, pull.ledger));

      await clearSyncError();
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
