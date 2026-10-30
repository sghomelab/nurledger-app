/**
 * SQLite schema — spec §4 data model, ADR-002 (immutable ledger), ADR-007 (outlet_id everywhere).
 * Bump SCHEMA_VERSION and add a migration step in database.ts when changing existing tables.
 */

export const SCHEMA_VERSION = 1;

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

-- FR-500 / FR-501
CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

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
`;
