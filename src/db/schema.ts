/**
 * SQLite schema — spec §4 data model, ADR-002 (immutable ledger), ADR-007 (outlet_id everywhere).
 * Bump SCHEMA_VERSION and add a migration step in database.ts when changing existing tables.
 */

export const SCHEMA_VERSION = 4;

/**
 * M2: active-cart persistence (NFR-3 — every cart mutation is written to SQLite
 * so a kill mid-sale survives; the completed sale + stock decrement are atomic).
 * Kept as its own const so the same DDL is reused by the v1→v2 migration.
 */
const CART_TABLES_SQL = `
-- M2: the register's active order (parked orders land in M3).
CREATE TABLE IF NOT EXISTS current_order (
  id TEXT PRIMARY KEY,
  order_discount_minor INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS current_order_line (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES current_order(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  tax_category TEXT NOT NULL DEFAULT 'standard',
  discount_minor INTEGER NOT NULL DEFAULT 0,
  cogs_minor INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER,
  lot_id TEXT,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_current_order_line ON current_order_line(order_id, position);
`;

/**
 * M4: operating expenses for the P&L (prototype Analytics "Operating Costs":
 * Staff Payroll / Maintenance / Other Operational). Immutable rows (no
 * UPDATE/DELETE paths) — an expense is a fact, like a ledger row.
 */
const EXPENSE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS expense (
  id TEXT PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  outlet_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_created ON expense(created_at);
`;

/** FR-500 / FR-501: app users (roles + PIN hashes). */
const APP_USER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
`;

export const SCHEMA_SQL = `
-- FR-303 / ADR-007: single outlet at launch, multi-outlet schema from day one
CREATE TABLE IF NOT EXISTS outlet (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  locale TEXT NOT NULL,
  tax_engine TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

-- FR-300 / FR-301 / FR-318 / FR-322
CREATE TABLE IF NOT EXISTS product (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL REFERENCES outlet(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES category(id),
  unit_type TEXT NOT NULL DEFAULT 'each',
  is_weighed INTEGER NOT NULL DEFAULT 0,
  barcode TEXT,
  carton_barcode TEXT,
  carton_size INTEGER NOT NULL DEFAULT 1,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  price_minor INTEGER NOT NULL DEFAULT 0,
  tax_category TEXT NOT NULL DEFAULT 'standard',
  min_qty INTEGER NOT NULL DEFAULT 0,
  max_qty INTEGER NOT NULL DEFAULT 0,
  velocity_class TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_sku ON product(outlet_id, sku);
CREATE INDEX IF NOT EXISTS idx_product_barcode ON product(barcode);
CREATE INDEX IF NOT EXISTS idx_product_carton_barcode ON product(carton_barcode);

-- FR-307: FEFO lot tracking
CREATE TABLE IF NOT EXISTS lot (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product(id),
  outlet_id TEXT NOT NULL REFERENCES outlet(id),
  lot_code TEXT NOT NULL,
  expiry_date TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lot_fefo ON lot(product_id, expiry_date);

-- FR-316 / ADR-002: IMMUTABLE append-only stock ledger.
-- No UPDATE or DELETE statements may ever target this table.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  lot_id TEXT,
  type TEXT NOT NULL,
  qty_delta INTEGER,
  qty_g_delta INTEGER,
  unit_cost_minor INTEGER,
  cogs_minor INTEGER,
  ref_type TEXT,
  ref_id TEXT,
  reason TEXT,
  device_id TEXT,
  sync_op_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_product ON stock_ledger(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_lot ON stock_ledger(lot_id);

-- ADR-003: FIFO cost layers. qty_remaining is the sole mutable column (cost cursor, not stock).
CREATE TABLE IF NOT EXISTS cost_layer (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_cost_minor INTEGER NOT NULL,
  qty_remaining INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_layer_fifo ON cost_layer(product_id, received_at, id);

-- Stock on hand = projection of the ledger (never stored in place).
CREATE VIEW IF NOT EXISTS stock_view AS
SELECT product_id, COALESCE(SUM(qty_delta), 0) AS qty
FROM stock_ledger
WHERE qty_delta IS NOT NULL
GROUP BY product_id;

CREATE TABLE IF NOT EXISTS sale (
  id TEXT PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  outlet_id TEXT NOT NULL,
  device_id TEXT,
  cashier_id TEXT,
  shift_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  subtotal_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  cogs_minor INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_created ON sale(created_at);

-- FR-321: per-sale-line COGS recorded at sale time
CREATE TABLE IF NOT EXISTS sale_line (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sale(id),
  product_id TEXT NOT NULL,
  lot_id TEXT,
  qty INTEGER NOT NULL,
  qty_g INTEGER,
  unit_price_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  line_total_minor INTEGER NOT NULL,
  unit_cost_minor INTEGER,
  cogs_minor INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_line_sale ON sale_line(sale_id);

CREATE TABLE IF NOT EXISTS payment (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sale(id),
  method TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  reference TEXT,
  created_at INTEGER NOT NULL
);

-- FR-110 / FR-111
CREATE TABLE IF NOT EXISTS refund (
  id TEXT PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL REFERENCES sale(id),
  reason_code TEXT NOT NULL,
  restock INTEGER NOT NULL DEFAULT 1,
  amount_minor INTEGER NOT NULL,
  pin_verified_by TEXT,
  created_at INTEGER NOT NULL
);

-- FR-200..FR-204
CREATE TABLE IF NOT EXISTS shift (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  device_id TEXT,
  cashier_id TEXT,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  float_minor INTEGER NOT NULL DEFAULT 0,
  counted_minor INTEGER,
  expected_minor INTEGER,
  variance_minor INTEGER,
  notes TEXT,
  z_report_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_shift_open ON shift(closed_at);

CREATE TABLE IF NOT EXISTS cash_move (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shift(id),
  type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- FR-306
CREATE TABLE IF NOT EXISTS purchase_order (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  terms TEXT NOT NULL DEFAULT 'net30',
  total_cost_minor INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  received_at INTEGER
);

CREATE TABLE IF NOT EXISTS po_line (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_order(id),
  product_id TEXT NOT NULL,
  qty_ordered INTEGER NOT NULL,
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER NOT NULL,
  lot_code TEXT,
  expiry_date TEXT
);

-- FR-304
CREATE TABLE IF NOT EXISTS stocktake (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  category_id TEXT,
  blind INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  applied_at INTEGER
);

CREATE TABLE IF NOT EXISTS stocktake_count (
  id TEXT PRIMARY KEY,
  stocktake_id TEXT NOT NULL REFERENCES stocktake(id),
  product_id TEXT NOT NULL,
  counted_qty INTEGER,
  expected_qty INTEGER
);

${APP_USER_TABLE_SQL}

-- FR-502 / FR-503: idempotent outbox (client UUIDs)
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  op_id TEXT NOT NULL UNIQUE,
  entity TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  uploaded_at INTEGER
);

CREATE TABLE IF NOT EXISTS delta_cursor (
  table_name TEXT PRIMARY KEY,
  last_updated_at INTEGER NOT NULL
);
${EXPENSE_TABLE_SQL}
${CART_TABLES_SQL}
`;

/** v1 → v2 (M2): add the cart-persistence tables. Idempotent. */
export const MIGRATE_V1_TO_V2_SQL = CART_TABLES_SQL;

/**
 * v2 → v3 (M3): record a human reason on stock movements (adjustments, waste,
 * expiry loss — FR-305/FR-313), for the M4 shrinkage/audit trail. `ALTER TABLE …
 * ADD COLUMN` is not idempotent, so the bootstrap guards its execution by
 * checking the column exists first (see database.ts).
 */
export const MIGRATE_V2_TO_V3_SQL = 'ALTER TABLE stock_ledger ADD COLUMN reason TEXT;';

/**
 * v3 → v4 (M4): add the operating-expense table AND the app_user table
 * (CREATE TABLE IF NOT EXISTS — idempotent). Both are new in M4; forgetting
 * app_user here makes `ensureDefaultUsers` throw "no such table" on every
 * existing install and breaks getDb() entirely.
 */
export const MIGRATE_V3_TO_V4_SQL = APP_USER_TABLE_SQL + EXPENSE_TABLE_SQL;

/**
 * M4 self-heal (run on every bootstrap after migrations, regardless of version):
 * installs that already reached v4 with an early M4 build can be missing the
 * app_user/expense tables or the default users. Idempotent DDL + the
 * count-guarded user seed make this safe and cheap to repeat.
 */
export const ENSURE_M4_SQL = APP_USER_TABLE_SQL + EXPENSE_TABLE_SQL;
