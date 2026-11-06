/**
 * SupabaseAdapter — the M5 reference CloudAdapter implementation (ADR-010).
 *
 * BYO model: every call uses the STORE's own project (cfg.url + keys). The
 * app is a pure client; nothing here points at a Nurledger-owned backend.
 *
 * Session storage is injected (KV shim backed by the local DB) so this module
 * stays free of DB imports — the repository layer supplies the shim.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupportedStorage } from '@supabase/auth-js';
import type {
  CategoryDeltaRow,
  CloudAdapter,
  CloudConfig,
  LedgerDeltaRow,
  PaymentDeltaRow,
  ProductDeltaRow,
  PushedOp,
  PushResult,
  RefundDeltaRow,
  RefundLineDeltaRow,
  SaleDeltaRow,
  SaleLineDeltaRow,
  SyncPullResult,
  TableCursors,
} from './types';

/** Minimal async KV the SDK uses for session persistence (supplied by the repo layer). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Our KV shim satisfies the SDK's storage contract (PromisifyMethods keeps sync OK too). */
const asSdkStorage = (storage: KeyValueStorage): SupportedStorage => storage as SupportedStorage;

/** Map of client per project (single-connection MVP). */
const clients = new Map<string, SupabaseClient>();

function clientFor(cfg: CloudConfig, storage: KeyValueStorage): SupabaseClient {
  const key = `${cfg.url}::${cfg.anonKey}`;
  let c = clients.get(key);
  if (!c) {
    c = createClient(cfg.url, cfg.anonKey, {
      auth: {
        storage: asSdkStorage(storage),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    clients.set(key, c);
  }
  return c;
}

function isoSince(ms: number): string {
  return (ms > 0 ? new Date(ms) : new Date(0)).toISOString();
}

/**
 * Bundle-upgrade hint (v1 → v2 added the refund tables + apply_refund;
 * v2 → v3 added the category table + apply_category; v3 → v4 added the
 * server-stamped synced_at delta-cursor column). A store that has not
 * re-run the newer bundle gets Postgres "does not exist" errors — surface an
 * actionable message instead of a cryptic one.
 */
function withUpgradeHint(where: string, message: string): string {
  return /does not exist|could not find/i.test(message)
    ? `${where}: ${message} — the cloud schema looks outdated: re-run the setup SQL (latest version) in the Supabase SQL editor, then sync again.`
    : `${where}: ${message}`;
}

/**
 * True only when a PostgREST/Postgres error means "the table does not exist":
 * PGRST205 ("Could not find the table..."), Postgres 42P01 (undefined_table)
 * or the raw relation message. Everything else (PGRST301 invalid JWT, 403 RLS,
 * network failures, ...) is a REAL fault and must not be read as "schema not
 * deployed" by the wizard.
 */
export function isTableMissingError(
  e: { code?: string; message?: string; details?: string; hint?: string | null },
): boolean {
  const s = `${e.code ?? ''} ${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`;
  return /PGRST205|42P01|could not find the table|relation ["']?\w+["']? does not exist/i.test(s);
}

function normBool(v: unknown): boolean {
  return v === true || v === 1 || v === 'true' || v === '1';
}

function normInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normTs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Pull pagination (PR-2026-11 / CR-02+CR-11). PostgREST enforces a default
 * 1,000-row page cap; an UNORDERED, UNPAGINATED delta query silently returns
 * an arbitrary subset, and advancing the cursor to the max of that subset
 * skips every omitted row with an earlier timestamp — permanent data loss.
 * So: every delta query is ordered (synced_at, id) and paged to exhaustion.
 * The page size stays below the server cap; the page count is a runaway guard
 * (50,000 rows is far beyond a shop's backlog — hitting it means retry).
 *
 * Two shapes, because the two parent-row classes differ:
 *
 * - PARENT tables (category/product/sale/stock_ledger/refund) are paged
 *   KEYSET on (synced_at, id): each page starts strictly after the last row
 *   of the previous page — `(synced_at > a) OR (synced_at = a AND id > b)`.
 *   OFFSET/range paging over a live table shifts the window when a
 *   concurrent write lands inside the not-yet-fetched region (a backfill, a
 *   replay, or a clock-step on the server): a PRE-EXISTING row slides past
 *   the end of the pull while the cursor has already advanced past it —
 *   silent, permanent loss. Keyset paging is immune: a row already in the
 *   window can never be skipped by an insert, because the anchor is the row
 *   itself, not a positional offset. (A write that lands with a synced_at
 *   EARLIER than the anchor is a write violating the server-stamp invariant
 *   and is simply not part of this pull's window — same as before.)
 * - CHILD rows (sale_line/payment/refund_line) page by OFFSET over a FIXED
 *   id set (`in (sale_uuid)`); the set cannot grow mid-pull, so offset is
 *   safe there and the queries stay simpler.
 */
const PULL_PAGE_SIZE = 500;
const PULL_MAX_PAGES = 100;
/** Parent ids per child-row query (keeps the `in (...)` URL short; rows are paged anyway). */
const PULL_CHILD_CHUNK = 50;

type PullResponse = { data: unknown[] | null; error: { message: string } | null };
type PagedQuery = (from: number, to: number) => Promise<PullResponse>;
/** Keyset anchor: the last (synced_at, id) of the previous page; null = first page. */
type KeysetAnchor = { syncedAt: string; id: string } | null;
type KeysetQuery = (anchor: KeysetAnchor) => Promise<PullResponse>;

async function pullAllPages<T>(
  query: PagedQuery,
  label: string,
  map: (r: Record<string, unknown>) => T,
  hintOnUpgrade = false,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    const from = page * PULL_PAGE_SIZE;
    const res = await query(from, from + PULL_PAGE_SIZE - 1);
    if (res.error) {
      const msg = res.error.message;
      throw new Error(hintOnUpgrade ? withUpgradeHint(label, msg) : `${label}: ${msg}`);
    }
    const rows = res.data ?? [];
    for (const r of rows) out.push(map(r as Record<string, unknown>));
    if (rows.length < PULL_PAGE_SIZE) return out; // final page
  }
  throw new Error(`${label}: exceeded ${PULL_MAX_PAGES * PULL_PAGE_SIZE}-row page cap — retry sync`);
}

async function pullAllKeysetPages<T>(
  query: KeysetQuery,
  label: string,
  map: (r: Record<string, unknown>) => T,
  hintOnUpgrade = false,
): Promise<T[]> {
  const out: T[] = [];
  let anchor: KeysetAnchor = null;
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    const res = await query(anchor);
    if (res.error) {
      const msg = res.error.message;
      throw new Error(hintOnUpgrade ? withUpgradeHint(label, msg) : `${label}: ${msg}`);
    }
    const rows = res.data ?? [];
    for (const r of rows) out.push(map(r as Record<string, unknown>));
    if (rows.length < PULL_PAGE_SIZE) return out; // final page
    const last = rows[rows.length - 1] as Record<string, unknown>;
    anchor = { syncedAt: String(last.synced_at), id: String(last.id) };
  }
  throw new Error(`${label}: exceeded ${PULL_MAX_PAGES * PULL_PAGE_SIZE}-row page cap — retry sync`);
}

/** Test seams: exported so the paging contracts can be unit-tested without a network. */
export const __pullAllPagesForTest = pullAllPages;
export const __pullAllKeysetPagesForTest = pullAllKeysetPages;

/** PostgREST / Postgres: the RPC (function) does not exist (pre-v7 project). */
export function isFunctionMissingError(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === 'PGRST202' || e.code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(e.message ?? '');
}

/** `ABCD1234EF567890` → `ABCD-1234-EF56-7890` (display only; the server ignores dashes/case). */
export function formatInviteCode(raw: string): string {
  const c = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return c.replace(/(.{4})(?=.)/g, '$1-');
}

export function createSupabaseAdapter(storage: KeyValueStorage): CloudAdapter {
  return {
    async ping(cfg) {
      // True reachability probe: the auth health endpoint exists on every
      // Supabase project BEFORE the BYO schema is deployed (a data query would
      // 404 on the missing table and mask "wrong URL" as "schema not run").
      try {
        const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/auth/v1/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
      } catch (e) {
        throw new Error(`Backend unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    async schemaVersion(cfg) {
      // The anon-callable nurledger_schema_version() (v7+). Pre-v7 projects have
      // no such function → "not deployed / needs the current SQL" → null.
      const c = clientFor(cfg, storage);
      const { data, error } = await c.rpc('nurledger_schema_version');
      if (error) {
        // ONLY "the table / function does not exist" means a fresh or pre-v7
        // project → null, which the wizard renders as "run the SQL step". Every
        // other error (bad anon key, network, PostgREST misconfig) surfaces with
        // its REAL text — returning null for those made the wizard say "schema
        // not deployed" on a plain auth failure.
        if (isTableMissingError(error) || isFunctionMissingError(error)) return null;
        throw new Error(`Schema check failed: ${error.message}`);
      }
      const v = Number(data);
      return data != null && Number.isFinite(v) ? v : null;
    },

    async signUp(cfg, email, password) {
      const c = clientFor(cfg, storage);
      const { data, error } = await c.auth.signUp({ email, password });
      if (error) throw new Error(`Sign-up failed: ${error.message}`);
      // No session yet = email confirmation pending.
      return { needsConfirm: !data.session };
    },

    async signIn(cfg, email, password) {
      const c = clientFor(cfg, storage);
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Sign-in failed: ${error.message}`);
      if (!data.session) throw new Error('Sign-in succeeded but no session (email unconfirmed?)');
    },

    async signOut(cfg) {
      const c = clientFor(cfg, storage);
      await c.auth.signOut();
    },

    async provisionStore(cfg, outlet, auth) {
      // The account step must have signed this device in first.
      const c = clientFor(cfg, storage);
      const { data: userData, error: userErr } = await c.auth.getUser();
      if (userErr || !userData.user) {
        throw new Error('Not signed in — create your account first');
      }
      const { data, error } = await c.rpc('provision_store', {
        p: {
          outlet: {
            id: outlet.id,
            name: outlet.name,
            currency: outlet.currency,
            locale: outlet.locale,
            tax_engine: outlet.taxEngine,
          },
          claim: auth.claim ?? null,
          invite: auth.invite ?? null,
        },
      });
      if (error) throw new Error(withUpgradeHint('provision_store', error.message));
      if (typeof data !== 'string' || !data) throw new Error('provision_store returned no outlet id');
      return data;
    },

    async createInvite(cfg, hours = 24) {
      const c = clientFor(cfg, storage);
      const { data, error } = await c.rpc('create_invite', { p_hours: hours });
      if (error) throw new Error(withUpgradeHint('create_invite', error.message));
      return formatInviteCode(String(data));
    },

    async myRole(cfg) {
      const c = clientFor(cfg, storage);
      // RLS member_select_self: a user only ever sees their own membership rows.
      const { data, error } = await c.from('org_member').select('role');
      if (error) throw new Error(`Could not read your role: ${error.message}`);
      const roles = (data ?? []).map((r: { role: string }) => r.role);
      if (roles.includes('owner')) return 'owner';
      return roles.length > 0 ? 'member' : null;
    },

    async deleteAccount(cfg, deleteStore) {
      const c = clientFor(cfg, storage);
      const { data, error } = await c.rpc('delete_my_account', { p_delete_store: deleteStore });
      if (error) {
        if (isFunctionMissingError(error)) {
          throw new Error(
            'Your cloud setup is out of date and cannot delete accounts yet — re-run the latest setup SQL (Settings → Cloud sync → Disconnect → Connect), then try again.',
          );
        }
        throw new Error(`delete_my_account: ${error.message}`);
      }
      return data === 'store_and_account' ? 'store_and_account' : 'account';
    },

    async pushOps(cfg, ops) {
      const c = clientFor(cfg, storage);
      const results: PushResult[] = [];
      // Strictly sequential — preserves FIFO; a failure stops the batch at that op.
      // The thrown error carries `failedOpId` (which op) and `uploadedOpIds`
      // (the ops before it that the server CONFIRMED) so the engine can mark
      // those uploaded and judge the failing op on its own (quarantine).
      const uploadedOpIds: string[] = [];
      for (const op of ops) {
        const payload = JSON.parse(op.payload) as Record<string, unknown>;
        const fn =
          op.entity === 'sale' ? 'apply_sale'
          : op.entity === 'ledger' ? 'apply_ledger'
          : op.entity === 'refund' ? 'apply_refund'
          : op.entity === 'category' ? 'apply_category'
          : 'apply_product';
        const { data, error } = await c.rpc(fn, { p: payload });
        if (error) {
          const status = (error as { status?: number }).status ?? undefined;
          const code = (error as { code?: string }).code ?? undefined;
          throw Object.assign(new Error(withUpgradeHint(fn, error.message)), {
            status, code, failedOpId: op.opId, uploadedOpIds,
          });
        }
        const r = String(data) as PushResult;
        if (!['applied', 'duplicate', 'created', 'updated', 'kept'].includes(r)) {
          throw Object.assign(new Error(`${fn} returned unexpected result: ${r}`), {
            failedOpId: op.opId, uploadedOpIds,
          });
        }
        results.push(r);
        uploadedOpIds.push(op.opId);
      }
      return results;
    },

    async pullDeltas(cfg, cursors: TableCursors): Promise<SyncPullResult> {
      const c = clientFor(cfg, storage);

      // NOTE: `gte` (not `gt`) on purpose — the cursor is stored at ms
      // precision while the server holds µs timestamptz; a write landing in the
      // same millisecond as the cursor must be re-fetched next pull. Both apply
      // modes (union / LWW) are idempotent, so re-reading the boundary row is
      // always a no-op.
      //
      // v4 (PR-2026-11 / CR-02): cursors ride on `synced_at` — the SERVER's
      // receipt time, stamped by the RPCs on every write. The old bundle
      // stamped `updated_at` with the CLIENT's created/edited time, so an
      // offline batch pushed after peers' cursors had passed its creation
      // time was never pulled again (silent peer data loss).
      // Keyset on (synced_at, id) — see the paging block at the top of the
      // file. First page starts at the cursor (gte, ms-precision boundary);
      // later pages start strictly after the previous page's last row. The
      // anchor reuses the server-returned synced_at string verbatim, so no
      // timestamp is ever re-rounded. `.limit` (not `.range`): keyset pages
      // have no positional offset, and the limit keeps under PostgREST's cap.
      const tableQuery = (table: string, cursorMs: number): KeysetQuery => (anchor) =>
        Promise.resolve(
          (anchor == null
            ? c.from(table)
                .select('*')
                .eq('outlet_id', cfg.outletId)
                .gte('synced_at', isoSince(cursorMs))
            : c.from(table)
                .select('*')
                .eq('outlet_id', cfg.outletId)
                .or(`synced_at.gt.${anchor.syncedAt},and(synced_at.eq.${anchor.syncedAt},id.gt.${anchor.id})`)
          )
            .order('synced_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(PULL_PAGE_SIZE),
        );

      const [categories, products, sales, ledger, refunds] = await Promise.all([
        pullAllKeysetPages(tableQuery('category', cursors.category), 'pull categories', mapCategory, true),
        pullAllKeysetPages(tableQuery('product', cursors.product), 'pull products', mapProduct),
        pullAllKeysetPages(tableQuery('sale', cursors.sale), 'pull sales', mapSale),
        pullAllKeysetPages(tableQuery('stock_ledger', cursors.ledger), 'pull ledger', mapLedger),
        pullAllKeysetPages(tableQuery('refund', cursors.refund), 'pull refunds', mapRefund, true),
      ]);

      // Lines + payments ride on the pulled sales (they carry no updated_at).
      // Child rows are paged to exhaustion per chunk: PostgREST caps a response
      // at ~1,000 rows, and 100 sales x >10 lines silently exceeded it — the
      // truncated lines were never re-pulled because the sale cursor advanced.
      const childQuery = (table: string, col: string, ids: string[]): PagedQuery => (from, to) =>
        Promise.resolve(
          c.from(table).select('*').in(col, ids).order('id', { ascending: true }).range(from, to),
        );
      const saleUuids = sales.map((s) => s.uuid);
      let lines: SaleLineDeltaRow[] = [];
      let payments: PaymentDeltaRow[] = [];
      for (let i = 0; i < saleUuids.length; i += PULL_CHILD_CHUNK) {
        const chunk = saleUuids.slice(i, i + PULL_CHILD_CHUNK);
        const [l, pm] = await Promise.all([
          pullAllPages(childQuery('sale_line', 'sale_uuid', chunk), 'pull sale_line', mapLine),
          pullAllPages(childQuery('payment', 'sale_uuid', chunk), 'pull payment', mapPayment),
        ]);
        lines = lines.concat(l);
        payments = payments.concat(pm);
      }

      // Refund lines ride on the pulled refunds (same pattern).
      const refundUuids = refunds.map((r) => r.uuid);
      let refundLines: RefundLineDeltaRow[] = [];
      for (let i = 0; i < refundUuids.length; i += PULL_CHILD_CHUNK) {
        const chunk = refundUuids.slice(i, i + PULL_CHILD_CHUNK);
        refundLines = refundLines.concat(
          await pullAllPages(childQuery('refund_line', 'refund_uuid', chunk), 'pull refund_line', mapRefundLine, true),
        );
      }

      const max = (rows: Array<{ syncedAt: number }>): number =>
        rows.reduce((m, r) => Math.max(m, r.syncedAt), 0);

      return {
        categories,
        products,
        sales,
        saleLines: lines,
        payments,
        ledger,
        refunds,
        refundLines,
        maxSyncedAt: {
          category: max(categories),
          product: max(products),
          sale: max(sales),
          ledger: max(ledger),
          refund: max(refunds),
        },
      };
    },
  };
}

// ---------------- row mappers (snake_case Postgres → camelCase app types) ----------------

function mapCategory(r: Record<string, unknown>): CategoryDeltaRow {
  return {
    id: String(r.id),
    name: String(r.name),
    createdAt: normTs(r.created_at),
    updatedAt: normTs(r.updated_at),
    updatedByDevice: r.updated_by_device == null ? null : String(r.updated_by_device),
    syncedAt: normTs(r.synced_at),
  };
}

function mapProduct(r: Record<string, unknown>): ProductDeltaRow {
  return {
    id: String(r.id),
    outletId: String(r.outlet_id),
    sku: String(r.sku),
    name: String(r.name),
    categoryId: r.category_id == null ? null : String(r.category_id),
    unitType: String(r.unit_type ?? 'each'),
    isWeighed: normBool(r.is_weighed),
    barcode: r.barcode == null ? null : String(r.barcode),
    cartonBarcode: r.carton_barcode == null ? null : String(r.carton_barcode),
    cartonSize: normInt(r.carton_size) ?? 1,
    costMinor: normInt(r.cost_minor) ?? 0,
    priceMinor: normInt(r.price_minor) ?? 0,
    taxCategory: String(r.tax_category ?? 'standard'),
    minQty: normInt(r.min_qty) ?? 0,
    maxQty: normInt(r.max_qty) ?? 0,
    velocityClass: r.velocity_class == null ? null : String(r.velocity_class),
    description: r.description == null ? null : String(r.description),
    active: normBool(r.active),
    createdAt: normTs(r.created_at),
    updatedAt: normTs(r.updated_at),
    updatedByDevice: r.updated_by_device == null ? null : String(r.updated_by_device),
    syncedAt: normTs(r.synced_at),
  };
}

function mapSale(r: Record<string, unknown>): SaleDeltaRow {
  return {
    id: String(r.id),
    uuid: String(r.uuid),
    outletId: String(r.outlet_id),
    deviceId: r.device_id == null ? null : String(r.device_id),
    cashierId: r.cashier_id == null ? null : String(r.cashier_id),
    shiftId: r.shift_id == null ? null : String(r.shift_id),
    status: String(r.status ?? 'completed'),
    subtotalMinor: normInt(r.subtotal_minor) ?? 0,
    discountMinor: normInt(r.discount_minor) ?? 0,
    taxMinor: normInt(r.tax_minor) ?? 0,
    totalMinor: normInt(r.total_minor) ?? 0,
    cogsMinor: normInt(r.cogs_minor) ?? 0,
    createdAt: normTs(r.created_at),
    syncedAt: normTs(r.synced_at),
  };
}

function mapLine(r: Record<string, unknown>): SaleLineDeltaRow {
  return {
    id: String(r.id),
    saleUuid: String(r.sale_uuid),
    productId: String(r.product_id),
    lotId: r.lot_id == null ? null : String(r.lot_id),
    qty: normInt(r.qty) ?? 0,
    qtyG: normInt(r.qty_g),
    unitPriceMinor: normInt(r.unit_price_minor) ?? 0,
    discountMinor: normInt(r.discount_minor) ?? 0,
    taxMinor: normInt(r.tax_minor) ?? 0,
    lineTotalMinor: normInt(r.line_total_minor) ?? 0,
    unitCostMinor: normInt(r.unit_cost_minor),
    cogsMinor: normInt(r.cogs_minor),
    createdAt: normTs(r.created_at),
  };
}

function mapPayment(r: Record<string, unknown>): PaymentDeltaRow {
  return {
    id: String(r.id),
    saleUuid: String(r.sale_uuid),
    method: String(r.method),
    amountMinor: normInt(r.amount_minor) ?? 0,
    reference: r.reference == null ? null : String(r.reference),
    createdAt: normTs(r.created_at),
  };
}

function mapLedger(r: Record<string, unknown>): LedgerDeltaRow {
  return {
    rowId: String(r.id),
    opId: String(r.sync_op_id),
    productId: String(r.product_id),
    lotId: r.lot_id == null ? null : String(r.lot_id),
    type: String(r.type),
    qtyDelta: normInt(r.qty_delta),
    qtyGDelta: normInt(r.qty_g_delta),
    unitCostMinor: normInt(r.unit_cost_minor),
    cogsMinor: normInt(r.cogs_minor),
    refType: r.ref_type == null ? null : String(r.ref_type),
    refId: r.ref_id == null ? null : String(r.ref_id),
    reason: r.reason == null ? null : String(r.reason),
    deviceId: r.device_id == null ? null : String(r.device_id),
    createdAt: normTs(r.created_at),
    syncedAt: normTs(r.synced_at),
  };
}

function mapRefund(r: Record<string, unknown>): RefundDeltaRow {
  return {
    id: String(r.id),
    uuid: String(r.uuid),
    saleUuid: String(r.sale_uuid),
    outletId: String(r.outlet_id),
    deviceId: r.device_id == null ? null : String(r.device_id),
    userId: r.user_id == null ? null : String(r.user_id),
    reasonCode: String(r.reason_code),
    restock: normBool(r.restock),
    amountMinor: normInt(r.amount_minor) ?? 0,
    createdAt: normTs(r.created_at),
    syncedAt: normTs(r.synced_at),
  };
}

function mapRefundLine(r: Record<string, unknown>): RefundLineDeltaRow {
  return {
    id: String(r.id),
    refundUuid: String(r.refund_uuid),
    saleLineId: String(r.sale_line_id),
    productId: String(r.product_id),
    qty: normInt(r.qty) ?? 0,
    qtyG: normInt(r.qty_g),
    amountMinor: normInt(r.amount_minor) ?? 0,
    restock: normBool(r.restock),
  };
}
