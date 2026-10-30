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
  CloudAdapter,
  CloudConfig,
  LedgerDeltaRow,
  PaymentDeltaRow,
  ProductDeltaRow,
  PushedOp,
  PushResult,
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

/** Service-role client (schema check only — never used for data). */
function serviceClientFor(cfg: CloudConfig): SupabaseClient {
  const key = `svc::${cfg.url}::${cfg.serviceKey}`;
  let c = clients.get(key);
  if (!c) {
    c = createClient(cfg.url, cfg.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    clients.set(key, c);
  }
  return c;
}

function isoSince(ms: number): string {
  return (ms > 0 ? new Date(ms) : new Date(0)).toISOString();
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

    async schemaDeployed(cfg) {
      const c = serviceClientFor(cfg);
      const { data, error } = await c.from('cloud_schema_meta').select('version').limit(1);
      if (error) {
        // PGRST205 "Could not find the table" → schema not deployed yet.
        return false;
      }
      return Array.isArray(data) && data.length > 0;
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

    async provisionStore(cfg, outlet) {
      // The owner account step must have signed this device in first.
      const c = clientFor(cfg, storage);
      const { data: userData, error: userErr } = await c.auth.getUser();
      if (userErr || !userData.user) {
        throw new Error('Not signed in — create the owner account first');
      }
      const svc = serviceClientFor(cfg);
      // A BYO project is a single-tenant outlet (ADR-007). If another device
      // already created the outlet, this device JOINS it: the cloud row is
      // left untouched and the owner simply becomes a member of it. (The
      // device's LOCAL outlet keeps its own id — sync maps local rows to the
      // tenant id in the payload, and pulled rows back to the local id.)
      const { data: existing, error: existingErr } = await svc
        .from('outlet')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (existingErr) throw new Error(`Read existing outlet: ${existingErr.message}`);
      const tenantId = existing?.id ?? outlet.id;
      if (!(existing && existing.id !== outlet.id)) {
        const { error: outletErr } = await svc
          .from('outlet')
          .upsert(
            {
              id: outlet.id,
              name: outlet.name,
              currency: outlet.currency,
              locale: outlet.locale,
              tax_engine: outlet.taxEngine,
            },
            { onConflict: 'id' },
          );
        if (outletErr) throw new Error(`Create outlet: ${outletErr.message}`);
      }
      const { error: memberErr } = await svc
        .from('org_member')
        .upsert(
          { org_id: tenantId, user_id: userData.user.id, role: 'owner' },
          { onConflict: 'org_id,user_id' },
        );
      if (memberErr) throw new Error(`Register owner: ${memberErr.message}`);
      return tenantId;
    },

    async pushOps(cfg, ops) {
      const c = clientFor(cfg, storage);
      const results: PushResult[] = [];
      // Strictly sequential — preserves FIFO; a failure stops the batch at that op.
      for (const op of ops) {
        const payload = JSON.parse(op.payload) as Record<string, unknown>;
        const fn = op.entity === 'sale' ? 'apply_sale' : op.entity === 'ledger' ? 'apply_ledger' : 'apply_product';
        const { data, error } = await c.rpc(fn, { p: payload });
        if (error) {
          const status = (error as { status?: number }).status ?? undefined;
          throw Object.assign(new Error(`${fn} failed: ${error.message}`), { status });
        }
        const r = String(data) as PushResult;
        if (!['applied', 'duplicate', 'created', 'updated', 'kept'].includes(r)) {
          throw new Error(`${fn} returned unexpected result: ${r}`);
        }
        results.push(r);
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
      const [productsRes, salesRes, ledgerRes] = await Promise.all([
        c.from('product').select('*').eq('outlet_id', cfg.outletId).gte('updated_at', isoSince(cursors.product)),
        c.from('sale').select('*').eq('outlet_id', cfg.outletId).gte('updated_at', isoSince(cursors.sale)),
        c.from('stock_ledger').select('*').eq('outlet_id', cfg.outletId).gte('updated_at', isoSince(cursors.ledger)),
      ]);
      if (productsRes.error) throw new Error(`pull products: ${productsRes.error.message}`);
      if (salesRes.error) throw new Error(`pull sales: ${salesRes.error.message}`);
      if (ledgerRes.error) throw new Error(`pull ledger: ${ledgerRes.error.message}`);

      const products = (productsRes.data ?? []).map(mapProduct);
      const sales = (salesRes.data ?? []).map(mapSale);
      const ledger = (ledgerRes.data ?? []).map(mapLedger);

      // Lines + payments ride on the pulled sales (they carry no updated_at).
      const saleUuids = sales.map((s) => s.uuid);
      let lines: SaleLineDeltaRow[] = [];
      let payments: PaymentDeltaRow[] = [];
      for (let i = 0; i < saleUuids.length; i += 100) {
        const chunk = saleUuids.slice(i, i + 100);
        if (chunk.length === 0) continue;
        const [linesRes, paymentsRes] = await Promise.all([
          c.from('sale_line').select('*').in('sale_uuid', chunk),
          c.from('payment').select('*').in('sale_uuid', chunk),
        ]);
        if (linesRes.error) throw new Error(`pull sale_line: ${linesRes.error.message}`);
        if (paymentsRes.error) throw new Error(`pull payment: ${paymentsRes.error.message}`);
        lines = lines.concat((linesRes.data ?? []).map(mapLine));
        payments = payments.concat((paymentsRes.data ?? []).map(mapPayment));
      }

      const max = (rows: Array<{ updatedAt: number }>): number =>
        rows.reduce((m, r) => Math.max(m, r.updatedAt), 0);

      return {
        products,
        sales,
        saleLines: lines,
        payments,
        ledger,
        maxUpdatedAt: {
          product: max(products),
          sale: max(sales),
          ledger: max(ledger),
        },
      };
    },
  };
}

// ---------------- row mappers (snake_case Postgres → camelCase app types) ----------------

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
    updatedAt: normTs(r.updated_at),
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
    updatedAt: normTs(r.updated_at),
  };
}
