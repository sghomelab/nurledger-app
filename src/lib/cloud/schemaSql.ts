/**
 * BYO schema bundle (ADR-010, FR-506). This SQL is what a store runs ONCE in
 * its OWN Supabase project (SQL Editor → paste → run), guided by the in-app
 * setup wizard. It is:
 *
 *  - **idempotent** — safe to paste again (IF NOT EXISTS / OR REPLACE /
 *    DROP POLICY IF EXISTS);
 *  - **versioned** — `cloud_schema_meta.version` lets the app detect whether a
 *    newer app needs the owner to run an update script;
 *  - **tenant-safe** — RLS (FR-506) on every table: rows are only visible to
 *    org members via `is_member(outlet_id)`;
 *  - **append-only + LWW enforced in the DB** — sales/ledger have NO direct
 *    UPDATE/DELETE policies; products change ONLY via `apply_product` (LWW +
 *    audit row); all writes go through idempotent RPCs keyed by client UUIDs
 *    (FR-502).
 *
 * Stock on hand = `stock_view` = SUM(qty_delta) over the UNION of all devices'
 * ledger rows (ADR-002 — server-recomputed projection, never client-merged).
 *
 * Timestamps in RPC payloads are EPOCH MILLISECONDS (JSON numbers/strings),
 * converted with `to_timestamp(x/1000.0)`.
 */

export const CLOUD_SCHEMA_VERSION = 1;

export const CLOUD_SCHEMA_SQL = `
-- =============================================================
-- NURLEDGER BYO SCHEMA v${CLOUD_SCHEMA_VERSION}  (paste all, run once)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.cloud_schema_meta (
  version int PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cloud_schema_meta (version) VALUES (${CLOUD_SCHEMA_VERSION}) ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------
-- Tenant: outlet + membership (single outlet per BYO project, ADR-007)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outlet (
  id text PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL,
  locale text NOT NULL,
  tax_engine text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_member (
  org_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  PRIMARY KEY (org_id, user_id)
);

-- Membership helper (DEFINER: bypasses RLS on org_member → no recursion).
-- Param is named p_org_id to avoid colliding with the org_member.org_id column.
CREATE OR REPLACE FUNCTION public.is_member(p_org_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_member
    WHERE org_id = p_org_id AND user_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------------
-- Products (LWW via apply_product; NO direct UPDATE/DELETE)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product (
  id text PRIMARY KEY,
  outlet_id text NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  category_id text,
  unit_type text NOT NULL DEFAULT 'each',
  is_weighed boolean NOT NULL DEFAULT false,
  barcode text,
  carton_barcode text,
  carton_size int NOT NULL DEFAULT 1,
  cost_minor bigint NOT NULL DEFAULT 0,
  price_minor bigint NOT NULL DEFAULT 0,
  tax_category text NOT NULL DEFAULT 'standard',
  min_qty int NOT NULL DEFAULT 0,
  max_qty int NOT NULL DEFAULT 0,
  velocity_class text,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by_device text,
  UNIQUE (outlet_id, sku)
);

CREATE TABLE IF NOT EXISTS public.product_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outlet_id text NOT NULL,
  product_id text NOT NULL,
  result text NOT NULL,          -- 'created' | 'applied' | 'rejected'
  before_json jsonb,             -- state that lost / was overwritten
  after_json jsonb,              -- the write that arrived
  changed_by_device text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_audit_product ON public.product_audit (product_id, changed_at DESC);

-- ------------------------------------------------------------------
-- Sales (append-only, uuid = client UUID = idempotency key, FR-502)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale (
  uuid text PRIMARY KEY,
  id text NOT NULL,
  outlet_id text NOT NULL,
  device_id text,
  cashier_id text,
  shift_id text,
  status text NOT NULL DEFAULT 'completed',
  subtotal_minor bigint NOT NULL,
  discount_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  cogs_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sale_outlet_updated ON public.sale (outlet_id, updated_at);

CREATE TABLE IF NOT EXISTS public.sale_line (
  id text PRIMARY KEY,
  outlet_id text NOT NULL,
  sale_uuid text NOT NULL REFERENCES public.sale(uuid) ON DELETE CASCADE,
  product_id text NOT NULL,
  lot_id text,
  qty int NOT NULL,
  qty_g int,
  unit_price_minor bigint NOT NULL,
  discount_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  line_total_minor bigint NOT NULL,
  unit_cost_minor bigint,
  cogs_minor bigint,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_line_sale ON public.sale_line (sale_uuid);

CREATE TABLE IF NOT EXISTS public.payment (
  id text PRIMARY KEY,
  outlet_id text NOT NULL,
  sale_uuid text NOT NULL REFERENCES public.sale(uuid) ON DELETE CASCADE,
  method text NOT NULL,
  amount_minor bigint NOT NULL,
  reference text,
  created_at timestamptz NOT NULL
);

-- ------------------------------------------------------------------
-- Stock ledger (append-only, sync_op_id = client UUID = idempotency key)
-- Stock on hand = projection of the UNION of all devices' rows (ADR-002).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_ledger (
  sync_op_id text PRIMARY KEY,
  id text NOT NULL,
  outlet_id text NOT NULL,
  product_id text NOT NULL,
  lot_id text,
  type text NOT NULL,
  qty_delta int,
  qty_g_delta int,
  unit_cost_minor bigint,
  cogs_minor bigint,
  ref_type text,
  ref_id text,
  reason text,
  device_id text,
  created_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_outlet_product ON public.stock_ledger (outlet_id, product_id, created_at);

-- Server-recomputed stock projection (never stored in place).
CREATE OR REPLACE VIEW public.stock_view AS
SELECT product_id,
       COALESCE(SUM(CASE WHEN qty_delta IS NOT NULL THEN qty_delta ELSE 0 END), 0)  AS qty,
       COALESCE(SUM(CASE WHEN qty_g_delta IS NOT NULL THEN qty_g_delta ELSE 0 END), 0) AS qty_g
FROM public.stock_ledger
GROUP BY product_id;

-- =============================================================
-- RPCs (idempotent, member-checked, write paths)
-- =============================================================

-- Apply a SALE (header + lines + payments + ledger rows). Keyed by uuid.
CREATE OR REPLACE FUNCTION public.apply_sale(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  sale_uuid text := p->>'uuid';
  outlet_id text := p->>'outlet_id';
  created_t   timestamptz := to_timestamp((p->>'created_at')::numeric / 1000.0);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_member(outlet_id) THEN RAISE EXCEPTION 'not a member of this outlet'; END IF;

  INSERT INTO public.sale (uuid, id, outlet_id, device_id, cashier_id, shift_id, status,
    subtotal_minor, discount_minor, tax_minor, total_minor, cogs_minor, created_at, updated_at)
  VALUES (sale_uuid, p->>'id', outlet_id, p->>'device_id', p->>'cashier_id', p->>'shift_id',
    coalesce(p->>'status', 'completed'),
    (p->>'subtotal_minor')::bigint, (p->>'discount_minor')::bigint, (p->>'tax_minor')::bigint,
    (p->>'total_minor')::bigint, (p->>'cogs_minor')::bigint, created_t, created_t)
  ON CONFLICT (uuid) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;   -- idempotency: already applied

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) LOOP
    INSERT INTO public.sale_line (id, outlet_id, sale_uuid, product_id, lot_id, qty, qty_g,
      unit_price_minor, discount_minor, tax_minor, line_total_minor, unit_cost_minor, cogs_minor, created_at)
    VALUES (r.value->>'id', outlet_id, sale_uuid, r.value->>'product_id', r.value->>'lot_id',
      (r.value->>'qty')::int, (r.value->>'qty_g')::int,
      (r.value->>'unit_price_minor')::bigint, (r.value->>'discount_minor')::bigint,
      (r.value->>'tax_minor')::bigint, (r.value->>'line_total_minor')::bigint,
      (r.value->>'unit_cost_minor')::bigint, (r.value->>'cogs_minor')::bigint,
      to_timestamp((r.value->>'created_at')::numeric / 1000.0))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) LOOP
    INSERT INTO public.payment (id, outlet_id, sale_uuid, method, amount_minor, reference, created_at)
    VALUES (r.value->>'id', outlet_id, sale_uuid, r.value->>'method',
      (r.value->>'amount_minor')::bigint, r.value->>'reference',
      to_timestamp((r.value->>'created_at')::numeric / 1000.0))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'ledger_rows', '[]'::jsonb)) LOOP
    INSERT INTO public.stock_ledger (sync_op_id, id, outlet_id, product_id, lot_id, type, qty_delta,
      qty_g_delta, unit_cost_minor, cogs_minor, ref_type, ref_id, reason, device_id, created_by, created_at, updated_at)
    VALUES (r.value->>'op_id', r.value->>'id', outlet_id, r.value->>'product_id', r.value->>'lot_id',
      r.value->>'type', (r.value->>'qty_delta')::int, (r.value->>'qty_g_delta')::int,
      (r.value->>'unit_cost_minor')::bigint, (r.value->>'cogs_minor')::bigint,
      r.value->>'ref_type', r.value->>'ref_id', r.value->>'reason', r.value->>'device_id',
      r.value->>'created_by', to_timestamp((r.value->>'created_at')::numeric / 1000.0),
      to_timestamp((r.value->>'created_at')::numeric / 1000.0))
    ON CONFLICT (sync_op_id) DO NOTHING;
  END LOOP;

  RETURN 'applied';
END; $$;

-- Apply a STANDALONE ledger row (adjustment / waste / expiry / PO receive).
CREATE OR REPLACE FUNCTION public.apply_ledger(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  outlet_id text := p->>'outlet_id';
  created_t timestamptz := to_timestamp((p->>'created_at')::numeric / 1000.0);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_member(outlet_id) THEN RAISE EXCEPTION 'not a member of this outlet'; END IF;

  INSERT INTO public.stock_ledger (sync_op_id, id, outlet_id, product_id, lot_id, type, qty_delta,
    qty_g_delta, unit_cost_minor, cogs_minor, ref_type, ref_id, reason, device_id, created_by, created_at, updated_at)
  VALUES (p->>'op_id', p->>'id', outlet_id, p->>'product_id', p->>'lot_id', p->>'type',
    (p->>'qty_delta')::int, (p->>'qty_g_delta')::int, (p->>'unit_cost_minor')::bigint,
    (p->>'cogs_minor')::bigint, p->>'ref_type', p->>'ref_id', p->>'reason', p->>'device_id',
    p->>'created_by', created_t, created_t)
  ON CONFLICT (sync_op_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;
  RETURN 'applied';
END; $$;

-- Apply a PRODUCT edit: LWW by updated_at (device-id tie-break) + audit row.
CREATE OR REPLACE FUNCTION public.apply_product(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  outlet_id text := p->>'outlet_id';
  prod_id   text := p->>'id';
  in_updated timestamptz := to_timestamp((p->>'updated_at')::numeric / 1000.0);
  in_device  text := coalesce(p->>'updated_by_device', '');
  e record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_member(outlet_id) THEN RAISE EXCEPTION 'not a member of this outlet'; END IF;

  SELECT * INTO e FROM public.product WHERE id = prod_id;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.product (id, outlet_id, sku, name, category_id, unit_type, is_weighed,
        barcode, carton_barcode, carton_size, cost_minor, price_minor, tax_category,
        min_qty, max_qty, velocity_class, description, active, created_at, updated_at, updated_by_device)
      VALUES (prod_id, outlet_id, p->>'sku', p->>'name', p->>'category_id',
        coalesce(p->>'unit_type','each'), coalesce((p->>'is_weighed')::boolean, false),
        p->>'barcode', p->>'carton_barcode', coalesce((p->>'carton_size')::int, 1),
        coalesce((p->>'cost_minor')::bigint, 0), coalesce((p->>'price_minor')::bigint, 0),
        coalesce(p->>'tax_category','standard'), coalesce((p->>'min_qty')::int, 0),
        coalesce((p->>'max_qty')::int, 0), p->>'velocity_class', p->>'description',
        coalesce((p->>'active')::boolean, true),
        to_timestamp((p->>'created_at')::numeric / 1000.0), in_updated, in_device);
      INSERT INTO public.product_audit (outlet_id, product_id, result, before_json, after_json, changed_by_device, changed_at)
      VALUES (outlet_id, prod_id, 'created', NULL, p, in_device, in_updated);
      RETURN 'created';
    EXCEPTION WHEN unique_violation THEN
      -- A DIFFERENT product UUID already owns this (outlet_id, sku) — e.g. two
      -- devices each created the same SKU offline before their first sync.
      -- Resolve as LWW on (outlet_id, sku) and KEEP the existing row's id
      -- (server identity is canonical), instead of raising: an unhandled
      -- exception would stall the client's FIFO drain on this op forever.
      -- (The losing device's local row is superseded; full cross-device
      -- identity reconciliation of such rows is deferred to M6.)
      SELECT * INTO e FROM public.product WHERE outlet_id = outlet_id AND sku = p->>'sku';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'product insert for % violated (outlet_id, sku) but no row was found', p->>'sku';
      END IF;
      IF e.updated_at = in_updated AND coalesce(e.updated_by_device, '') = in_device THEN
        RETURN 'kept';
      END IF;
      IF e.updated_at < in_updated
         OR (e.updated_at = in_updated AND coalesce(e.updated_by_device, '') < in_device) THEN
        INSERT INTO public.product_audit (outlet_id, product_id, result, before_json, after_json, changed_by_device, changed_at)
        VALUES (outlet_id, e.id, 'applied', to_jsonb(e), p, in_device, in_updated);
        UPDATE public.product SET
          name = p->>'name', category_id = p->>'category_id',
          unit_type = coalesce(p->>'unit_type','each'),
          is_weighed = coalesce((p->>'is_weighed')::boolean, false),
          barcode = p->>'barcode', carton_barcode = p->>'carton_barcode',
          carton_size = coalesce((p->>'carton_size')::int, 1),
          cost_minor = coalesce((p->>'cost_minor')::bigint, 0),
          price_minor = coalesce((p->>'price_minor')::bigint, 0),
          tax_category = coalesce(p->>'tax_category','standard'),
          min_qty = coalesce((p->>'min_qty')::int, 0), max_qty = coalesce((p->>'max_qty')::int, 0),
          velocity_class = p->>'velocity_class', description = p->>'description',
          active = coalesce((p->>'active')::boolean, true),
          updated_at = in_updated, updated_by_device = in_device
        WHERE id = e.id;
        RETURN 'updated';
      END IF;
      INSERT INTO public.product_audit (outlet_id, product_id, result, before_json, after_json, changed_by_device, changed_at)
      VALUES (outlet_id, e.id, 'rejected', to_jsonb(e), p, in_device, in_updated);
      RETURN 'kept';
    END;
  END IF;

  -- Exact replay: same timestamp AND same device as the stored row = a retry
  -- of an op the server already applied. No-op, NO audit row (an audit row per
  -- retry would be noise; idempotent retries are expected).
  IF e.updated_at = in_updated AND coalesce(e.updated_by_device, '') = in_device THEN
    RETURN 'kept';
  END IF;

  IF e.updated_at < in_updated
     OR (e.updated_at = in_updated AND coalesce(e.updated_by_device, '') < in_device) THEN
    -- incoming WINS: audit the overwritten (losing) state, then update.
    INSERT INTO public.product_audit (outlet_id, product_id, result, before_json, after_json, changed_by_device, changed_at)
    VALUES (outlet_id, prod_id, 'applied', to_jsonb(e), p, in_device, in_updated);
    UPDATE public.product SET
      sku = p->>'sku', name = p->>'name', category_id = p->>'category_id',
      unit_type = coalesce(p->>'unit_type','each'),
      is_weighed = coalesce((p->>'is_weighed')::boolean, false),
      barcode = p->>'barcode', carton_barcode = p->>'carton_barcode',
      carton_size = coalesce((p->>'carton_size')::int, 1),
      cost_minor = coalesce((p->>'cost_minor')::bigint, 0),
      price_minor = coalesce((p->>'price_minor')::bigint, 0),
      tax_category = coalesce(p->>'tax_category','standard'),
      min_qty = coalesce((p->>'min_qty')::int, 0), max_qty = coalesce((p->>'max_qty')::int, 0),
      velocity_class = p->>'velocity_class', description = p->>'description',
      active = coalesce((p->>'active')::boolean, true),
      updated_at = in_updated, updated_by_device = in_device
    WHERE id = prod_id;
    RETURN 'updated';
  ELSE
    -- existing WINS: audit the rejected write, keep current state.
    INSERT INTO public.product_audit (outlet_id, product_id, result, before_json, after_json, changed_by_device, changed_at)
    VALUES (outlet_id, prod_id, 'rejected', to_jsonb(e), p, in_device, in_updated);
    RETURN 'kept';
  END IF;
END; $$;

-- =============================================================
-- RLS (FR-506): members see their outlet's rows; writes ONLY via RPCs
-- =============================================================
ALTER TABLE public.outlet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outlet_select_members" ON public.outlet;
CREATE POLICY "outlet_select_members" ON public.outlet FOR SELECT
  USING (id IN (SELECT org_id FROM public.org_member WHERE user_id = auth.uid()));
-- One outlet per BYO project: first authenticated user creates it.
DROP POLICY IF EXISTS "outlet_insert_first" ON public.outlet;
CREATE POLICY "outlet_insert_first" ON public.outlet FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.outlet));

DROP POLICY IF EXISTS "member_select_self" ON public.org_member;
CREATE POLICY "member_select_self" ON public.org_member FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "member_insert_self" ON public.org_member;
CREATE POLICY "member_insert_self" ON public.org_member FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "member_delete_self" ON public.org_member;
CREATE POLICY "member_delete_self" ON public.org_member FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "product_select_members" ON public.product;
CREATE POLICY "product_select_members" ON public.product FOR SELECT USING (public.is_member(outlet_id));
-- (no INSERT/UPDATE/DELETE policies — products change only via apply_product)

DROP POLICY IF EXISTS "audit_select_members" ON public.product_audit;
CREATE POLICY "audit_select_members" ON public.product_audit FOR SELECT USING (public.is_member(outlet_id));

DROP POLICY IF EXISTS "sale_select_members" ON public.sale;
CREATE POLICY "sale_select_members" ON public.sale FOR SELECT USING (public.is_member(outlet_id));

DROP POLICY IF EXISTS "sale_line_select_members" ON public.sale_line;
CREATE POLICY "sale_line_select_members" ON public.sale_line FOR SELECT USING (public.is_member(outlet_id));

DROP POLICY IF EXISTS "payment_select_members" ON public.payment;
CREATE POLICY "payment_select_members" ON public.payment FOR SELECT USING (public.is_member(outlet_id));

DROP POLICY IF EXISTS "ledger_select_members" ON public.stock_ledger;
CREATE POLICY "ledger_select_members" ON public.stock_ledger FOR SELECT USING (public.is_member(outlet_id));

-- PostgREST access (no-ops on stock Supabase, required for local/self-hosted).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
`;
