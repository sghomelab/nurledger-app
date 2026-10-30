/**
 * Nurledger domain types.
 *
 * Money rule (ADR-004): ALL monetary values are integer minor units
 * (cents/cents-equivalent for the outlet currency). Never floats.
 */

export interface Outlet {
  id: string;
  name: string;
  /** ISO-4217 code, e.g. 'SGD'. */
  currency: string;
  /** BCP-47 locale, e.g. 'en-SG'. */
  locale: string;
  /** Tax engine id — never a hardcoded rate (ADR-004). */
  taxEngine: string;
  createdAt: number;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
}

export type UnitType = 'each' | 'kg' | 'carton';
export type VelocityClass = 'A' | 'B' | 'C';

export interface Product {
  id: string;
  outletId: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unitType: UnitType;
  isWeighed: boolean;
  /** Unit barcode (FR-322). */
  barcode: string | null;
  /** Carton barcode — scans sell `cartonSize` base units (FR-322). */
  cartonBarcode: string | null;
  /** FR-318: 1 carton = N base units. */
  cartonSize: number;
  /** Last/average cost for display & reporting (ADR-003). */
  costMinor: number;
  /** Owner-set stable selling price (ADR-003). */
  priceMinor: number;
  taxCategory: string;
  /** Reorder threshold (low-stock trigger). */
  minQty: number;
  /** Max level for reorder suggestions (suggest = max − on-hand). */
  maxQty: number;
  velocityClass: VelocityClass | null;
  description: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Lot {
  id: string;
  productId: string;
  outletId: string;
  lotCode: string;
  /** ISO date 'YYYY-MM-DD' or null. */
  expiryDate: string | null;
  receivedAt: number;
}

export type StockMoveType =
  | 'sale'
  | 'refund'
  | 'receive_po'
  | 'adjustment'
  | 'transfer_out'
  | 'transfer_in'
  | 'waste'
  | 'expiry_loss';

/**
 * FR-316 / ADR-002 — immutable ledger row. Stock on hand is always a
 * projection of these rows; a row is never updated or deleted.
 */
export interface StockLedgerRow {
  id: string;
  outletId: string;
  productId: string;
  lotId: string | null;
  type: StockMoveType;
  /** Base-unit delta (negative = out). Null for weighed movements. */
  qtyDelta: number | null;
  /** Grams delta for weighed items (negative = out). */
  qtyGDelta: number | null;
  /** Unit cost (minor) at the time of the movement. */
  unitCostMinor: number | null;
  /** Realized COGS (minor) for this movement (sales/refunds). FR-321. */
  cogsMinor: number | null;
  refType: string | null;
  refId: string | null;
  deviceId: string | null;
  /** Client-generated UUID — idempotency key for sync (FR-502). */
  syncOpId: string | null;
  createdAt: number;
  createdBy: string | null;
}

/** FIFO costing cursor (ADR-003). qty_remaining is the only mutable field. */
export interface CostLayer {
  id: string;
  outletId: string;
  productId: string;
  unitCostMinor: number;
  qtyRemaining: number;
  refType: string | null;
  refId: string | null;
  receivedAt: number;
}

export type StockStatus = 'in_stock' | 'low_stock' | 'depleted' | 'sold_out';

/** Product joined with its projected on-hand stock. */
export interface ProductWithStock extends Product {
  stockQty: number;
  status: StockStatus;
}

export type UserRole = 'owner' | 'manager' | 'cashier';

export interface AppUser {
  id: string;
  name: string;
  role: UserRole;
  pinHash: string | null;
  active: boolean;
  createdAt: number;
}

export interface OutboxOp {
  id: string;
  opId: string;
  entity: string;
  payload: string;
  createdAt: number;
  uploadedAt: number | null;
}
