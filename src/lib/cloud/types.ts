/**
 * CloudAdapter — the provider-swappable seam (ADR-010, BYO cloud).
 *
 * Everything cloud-side in the app goes through this interface. The sync engine
 * (useSync) talks ONLY to a CloudAdapter; the ledger/outbox/LWW rules live in
 * `src/lib/sync.ts` and are provider-agnostic. Swapping Supabase for another
 * provider (or self-hosted Postgres) = implement this interface; nothing else
 * changes.
 *
 * BYO model: the store's own backend. `anonKey` is safe to embed (RLS protects
 * data); `serviceKey` is used ONLY for the one-time schema-deployed check and
 * is stored in the device's local DB (the user's own key, on the user's own
 * device, talking to the user's own project — it never leaves the device).
 */

import type { SyncEntity } from '../sync';

/** Connection details the store pastes into the setup wizard. */
export interface CloudConfig {
  /** e.g. `https://xyz.supabase.co` or a local `http://10.0.2.2:54321`. */
  url: string;
  /** anon/public key (safe to ship). */
  anonKey: string;
  /** service_role key (sensitive; device-local only). */
  serviceKey: string;
  /** The outlet this device syncs as (local outlet id, shared across devices). */
  outletId: string;
  /** Owner's auth email (for sign-in on other devices). */
  ownerEmail?: string;
}

/** A payload-ready outbox op handed to the adapter for upload. */
export interface PushedOp {
  opId: string;
  entity: SyncEntity;
  /** Serialized op payload (JSON string). Provider encodes as it sees fit. */
  payload: string;
  createdAt: number;
}

/** Per-op server answer (see sync.ts OpResult — same contract). */
export type PushResult =
  | 'applied'
  | 'duplicate'
  | 'created'
  | 'updated'
  | 'kept';

/** Deltas pulled since per-table cursors (epoch ms). */
export interface ProductDeltaRow {
  id: string;
  outletId: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unitType: string;
  isWeighed: boolean;
  barcode: string | null;
  cartonBarcode: string | null;
  cartonSize: number;
  costMinor: number;
  priceMinor: number;
  taxCategory: string;
  minQty: number;
  maxQty: number;
  velocityClass: string | null;
  description: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  updatedByDevice: string | null;
}

export interface SaleDeltaRow {
  id: string;
  uuid: string;
  outletId: string;
  deviceId: string | null;
  cashierId: string | null;
  shiftId: string | null;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  cogsMinor: number;
  createdAt: number;
  updatedAt: number;
}

export interface SaleLineDeltaRow {
  id: string;
  saleUuid: string;
  productId: string;
  lotId: string | null;
  qty: number;
  qtyG: number | null;
  unitPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
  unitCostMinor: number | null;
  cogsMinor: number | null;
  createdAt: number;
}

export interface PaymentDeltaRow {
  id: string;
  saleUuid: string;
  method: string;
  amountMinor: number;
  reference: string | null;
  createdAt: number;
}

export interface LedgerDeltaRow {
  /** The ledger row's client row uuid (local primary key). */
  rowId: string;
  /** = client sync_op_id (the server idempotency key). */
  opId: string;
  productId: string;
  lotId: string | null;
  type: string;
  qtyDelta: number | null;
  qtyGDelta: number | null;
  unitCostMinor: number | null;
  cogsMinor: number | null;
  refType: string | null;
  refId: string | null;
  reason: string | null;
  deviceId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** M6 (FR-110): refund deltas (append-only, uuid = client UUID). */
export interface RefundDeltaRow {
  id: string;
  uuid: string;
  saleUuid: string;
  outletId: string;
  deviceId: string | null;
  userId: string | null;
  reasonCode: string;
  restock: boolean;
  amountMinor: number;
  createdAt: number;
  updatedAt: number;
}

export interface RefundLineDeltaRow {
  id: string;
  refundUuid: string;
  saleLineId: string;
  productId: string;
  qty: number;
  qtyG: number | null;
  amountMinor: number;
  restock: boolean;
}

/** M6 (schema v3): category deltas (LWW like products — pulled BEFORE
 *  products so a product's category_id FK can never dangle on pull). */
export interface CategoryDeltaRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  updatedByDevice: string | null;
}

export interface TableCursors {
  /** epoch ms per table; 0 = "pull everything". */
  product: number;
  sale: number;
  ledger: number;
  refund: number;
  category: number;
}

export interface SyncPullResult {
  categories: CategoryDeltaRow[];
  products: ProductDeltaRow[];
  sales: SaleDeltaRow[];
  saleLines: SaleLineDeltaRow[];
  payments: PaymentDeltaRow[];
  ledger: LedgerDeltaRow[];
  refunds: RefundDeltaRow[];
  refundLines: RefundLineDeltaRow[];
  /** Max updatedAt observed per table (for cursor advancement). */
  maxUpdatedAt: TableCursors;
}

/**
 * The seam. Implementations must be idempotent-safe: pushing the same opId
 * twice must not change server state (the server enforces this; the adapter
 * just reports the answer).
 */
export interface CloudAdapter {
  /** Reachability + auth sanity. Throws on hard failure. */
  ping(cfg: CloudConfig): Promise<boolean>;
  /**
   * True when the BYO schema bundle has been deployed to this project
   * (checked with the service key; tables must exist). Drives the setup
   * wizard's "run the SQL" step validation.
   */
  schemaDeployed(cfg: CloudConfig): Promise<boolean>;
  /**
   * Owner self-service signup (FR-505, BYO: in the store's own project).
   * `needsConfirm` = true when email confirmation is on and pending.
   */
  signUp(cfg: CloudConfig, email: string, password: string): Promise<{ needsConfirm: boolean }>;
  /** Owner sign-in (second devices use this). Throws on bad credentials. */
  signIn(cfg: CloudConfig, email: string, password: string): Promise<void>;
  signOut(cfg: CloudConfig): Promise<void>;
  /**
   * One-time BYO provisioning (wizard final step): upsert this store's outlet
   * row and register the CURRENTLY SIGNED-IN owner as an org_member. Runs on
   * the service-role key because membership RLS does not yet apply.
   *
   * **Create-or-join** (multi-device, ADR-007 single-tenant outlet): if the
   * project already holds an outlet row created by ANOTHER device, this device
   * joins that tenant — the existing row is left untouched and the owner is
   * added as a member of it.
   *
   * Returns the TENANT outlet id (the cloud row's id — may differ from this
   * device's local outlet id when joining). Idempotent — re-running the
   * wizard on the same store is a no-op.
   */
  provisionStore(cfg: CloudConfig, outlet: { id: string; name: string; currency: string; locale: string; taxEngine: string }): Promise<string>;
  /**
   * Idempotently push ops (FIFO order preserved by the caller). Returns one
   * result per op, in order. A thrown error = transport/server failure for the
   * WHOLE batch (retry from the first non-uploaded op).
   */
  pushOps(cfg: CloudConfig, ops: PushedOp[]): Promise<PushResult[]>;
  /** Delta pull since cursors. */
  pullDeltas(cfg: CloudConfig, cursors: TableCursors): Promise<SyncPullResult>;
}
