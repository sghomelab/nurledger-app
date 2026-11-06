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
 * data). The app never asks for, stores or uses the `service_role` key (v7):
 * schema checks, store provisioning and device joining go through narrow
 * SECURITY DEFINER functions guarded by a one-time claim code (first device)
 * or a single-use invite code (additional devices).
 */

import type { SyncEntity } from '../sync';

/** Connection details the store pastes into the setup wizard. */
export interface CloudConfig {
  /** e.g. `https://xyz.supabase.co` or a local `http://10.0.2.2:54321`. */
  url: string;
  /** anon/public key (safe to ship). */
  anonKey: string;
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
  /** LWW conflict key — the client's edit time (epoch ms). */
  updatedAt: number;
  updatedByDevice: string | null;
  /** Server-stamped receipt time (v4) — the delta-cursor field. */
  syncedAt: number;
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
  /** Server-stamped receipt time (v4) — the delta-cursor field. */
  syncedAt: number;
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
  /** Server-stamped receipt time (v4) — the delta-cursor field. */
  syncedAt: number;
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
  /** Server-stamped receipt time (v4) — the delta-cursor field. */
  syncedAt: number;
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
  /** LWW conflict key — the client's edit time (epoch ms). */
  updatedAt: number;
  updatedByDevice: string | null;
  /** Server-stamped receipt time (v4) — the delta-cursor field. */
  syncedAt: number;
}

export interface TableCursors {
  /** epoch ms per table (max `synced_at` pulled); 0 = "pull everything". */
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
  /** Max synced_at observed per table (for cursor advancement). */
  maxSyncedAt: TableCursors;
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
   * The version of the BYO schema bundle deployed in this project (the
   * `nurledger_schema_version()` function — callable with the anon key; a
   * pre-v7 project has no such function and reads as null, i.e. "paste the
   * current SQL"), or null if the schema is not deployed at all. Drives the setup wizard:
   * null → "deploy" step, version < CLOUD_SCHEMA_VERSION → "upgrade" step
   * (existing stores must re-paste the newer bundle — idempotent, never
   * touches data), otherwise → straight to the account step.
   */
  schemaVersion(cfg: CloudConfig): Promise<number | null>;
  /**
   * Owner self-service signup (FR-505, BYO: in the store's own project).
   * `needsConfirm` = true when email confirmation is on and pending.
   */
  signUp(cfg: CloudConfig, email: string, password: string): Promise<{ needsConfirm: boolean }>;
  /** Owner sign-in (second devices use this). Throws on bad credentials. */
  signIn(cfg: CloudConfig, email: string, password: string): Promise<void>;
  signOut(cfg: CloudConfig): Promise<void>;
  /**
   * One-time BYO provisioning (wizard final step) via the `provision_store`
   * SECURITY DEFINER function — no service key.
   *
   * - **create** (`auth.claim`): the first device of a brand-new store. Needs
   *   the claim code the wizard baked into the SQL the owner pasted.
   * - **join** (`auth.invite`): an additional device. Needs a single-use,
   *   expiring invite code created by the owner on a connected device.
   * - An already-registered member calling again is a no-op.
   *
   * Returns the TENANT outlet id (the cloud row's id — may differ from this
   * device's local outlet id when joining).
   */
  provisionStore(
    cfg: CloudConfig,
    outlet: { id: string; name: string; currency: string; locale: string; taxEngine: string },
    auth: { claim?: string; invite?: string },
  ): Promise<string>;
  /**
   * Owner only: mint a single-use join code (default 24 h) for one more
   * device/person. The code is shown once; the server stores only its hash.
   */
  createInvite(cfg: CloudConfig, hours?: number): Promise<string>;
  /** The signed-in user's role in the store ('owner' | 'member'), or null if not a member. */
  myRole(cfg: CloudConfig): Promise<'owner' | 'member' | null>;
  /**
   * In-app account deletion (store-policy requirement; `delete_my_account`, schema v8).
   * Deletes the caller's own sign-in + membership. The OWNER must pass
   * `deleteStore = true`, which also erases the store's cloud data; a member
   * must pass false. Other members' sign-ins are never deleted. Returns what
   * was deleted.
   */
  deleteAccount(cfg: CloudConfig, deleteStore: boolean): Promise<'account' | 'store_and_account'>;
  /**
   * Idempotently push ops (FIFO order preserved by the caller). Returns one
   * result per op, in order. A thrown error = transport/server failure for the
   * WHOLE batch (retry from the first non-uploaded op).
   */
  pushOps(cfg: CloudConfig, ops: PushedOp[]): Promise<PushResult[]>;
  /** Delta pull since cursors. */
  pullDeltas(cfg: CloudConfig, cursors: TableCursors): Promise<SyncPullResult>;
}
