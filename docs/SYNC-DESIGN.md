# Cloud & Sync — Design (BYO + `CloudAdapter`)

> Status: **design locked 2026-10-31** (owner direction). M5 architecture spec,
> **revised 2026-10-31 for M6** (category sync, refunds in the sync surface,
> schema bundle v3, version-aware setup wizard). Decisions: **ADR-010** (BYO
> cloud + provider seam, sync off by default), **ADR-011** (category identity:
> client-side name invariant), **DEV-006** (user-provisioned backend instead of
> creator-provisioned multi-tenant).

## 1. The two big decisions

### 1.1 BYO — the store provisions its own backend
The app **does not** run a backend of its own and does not host customer data.
Each store creates its own backend project (reference: a **free Supabase**
project) and connects it from the app. The app is a **pure client**: it deploys
a versioned, idempotent SQL schema bundle into the store's project on first-run
setup, then syncs against it. The bundle is **versioned**
(`cloud_schema_meta`, one row per applied version; current = **v3** since M6 —
see §10) and the setup wizard is **version-aware**: it detects a project that
runs an older bundle and walks the owner through the upgrade (re-paste the
current bundle — idempotent, never touches data).

Why (owner requirement, 2026-10-31):
- **Data independence / liability separation.** The app creator is **not** a
  data custodian. The data relationship is strictly *store ↔ its own backend*;
  the creator has zero access to any customer's data.
- **Portability.** The backend is plain **Postgres**, so a store's data is
  always exportable (`pg_dump`) and is never trapped in a proprietary format.
- **Creator-side scaling is out of our problem.** Free-tier limits, pricing
  changes, or a provider shutdown affect *the store's* account, not ours.

### 1.2 `CloudAdapter` — the provider is a swappable seam
All cloud behavior sits behind one interface so the provider can be changed or
added **without touching the sync engine or the ledger logic**:

```
CloudAdapter (src/lib/cloud/types.ts)
├── setup(cfg)          → validate creds, deploy the SQL schema bundle, create the outlet row
├── auth()              → signUp / signIn / signOut / getSession / onAuthChange
├── push(outboxOps)     → apply queued ops idempotently (client-UUID keyed)
└── pull(cursors)       → return per-table deltas since each cursor
```

- `SupabaseAdapter` is the **M5 reference implementation**.
- A **self-hosted Postgres** adapter is nearly free later: the data layer is
  plain Postgres + SQL, so the same schema bundle and same queries apply to a
  different URL (plus an auth story). Adding it is *additive*, not a rewrite.
- The **hard parts are provider-agnostic** and never change between providers:
  the outbox, client-UUID idempotency, LWW merge, and the immutable ledger
  (ADR-002/003). Only the three seams above are provider-specific.

## 2. Sync is OFF by default (per-device runtime toggle)

- A fresh install is a **pure local app**. Nothing syncs until the owner
  explicitly connects a backend **and** turns the toggle on.
- The toggle lives in **Settings → Cloud sync** and is **per-device**.
- **Off** = the sync engine simply does not run. The register keeps working
  100% offline and **every op is still queued in the local outbox** — nothing is
  ever dropped. The status surface reads "N ops queued · Sync off".
- **On** = engine starts: drains the outbox FIFO, pulls deltas, resumes from the
  stored cursors (turning off then on loses nothing).
- **Disconnect** removes the connection; all local data and the queue remain.

This makes "local only" a clean rollback at three levels, all lossless:

| Level | Action | Result |
|---|---|---|
| Runtime | toggle Off (or never connect) | pure local, queue keeps growing |
| Device | Disconnect | connection removed, data stays local |
| Codebase | don't ship / `git revert` the `m5` tag | `m4` *is* the pure-local app |

## 3. Sync correctness rules (the heart of M5)

### 3.1 Client-UUID idempotency (no double-apply)
Every client-generated op carries a **stable client UUID** (generated on-device,
`src/lib/ids.ts`). The server applies ops **idempotently** — re-sending the same
UUID is a no-op:

| Op | Idempotency key (server PK / unique) | Rule |
|---|---|---|
| Sale | `sale.uuid` | **append-only**; `ON CONFLICT (uuid) DO NOTHING`. A sale is a fact; it is inserted exactly once. |
| Stock ledger row | `stock_ledger.sync_op_id` | **append-only**; `ON CONFLICT (sync_op_id) DO NOTHING`. A refund's **restock** rides this table (one ledger row per restocked line) — no special refund path on the server. |
| Payment | `payment.sale_uuid` + method + amount (composite) | inserted with its sale. |
| Refund (M6) | `refund.uuid` + `refund_line` per line | **append-only** (`apply_refund`); a refund is a fact and can never be edited or deleted — the "exact full refund" invariant is enforced **client-side** before the op is enqueued (a line can never be refunded more than was sold). |
| Product | `product.id` | **LWW** — see 3.2. |
| Category (M6) | `category.id` | **LWW** via `apply_category` — same `updated_at` + device tie-break as products; see 3.5 (and ADR-011 for the name-identity model). |

A dropped network reply after the server already applied the op is safe: the
client retries the same UUID, the server sees it exists, no-ops. **This is what
the exit test proves** ("no double-apply, client-UUID idempotency proven").

### 3.2 Products — LWW with an audit row; stock is NEVER client-merged
- Product edits (name, price, cost, tax category, barcodes, …) merge by
  **last-write-wins on `updated_at`**. The client payload carries an
  `updated_at` + `updated_by_device`; the server keeps the row with the greater
  `updated_at`.
- **Tie-break** (equal `updated_at`): deterministic by `device_id`
  (lexicographic) so the outcome is reproducible across devices.
- **Audit row:** whenever a write is *overwritten* by a later write, the losing
  value + the winning value are recorded in `product_audit`
  (`before_json`, `after_json`, `changed_by_device`, `changed_at`). This is the
  acceptance item "product edits LWW with audit row".
- **Stock is never carried in a product sync payload.** A product op contains
  *no* stock quantity. Stock reaches the server **only** via `stock_ledger`
  rows (3.1). Two devices can edit the same product offline; on sync the
  product field-merge is LWW and stock is untouched by it. (Acceptance item:
  "stock never client-merged".)

### 3.3 Stock = server-recomputed projection (ADR-002)
- Server stock on hand per product = `SUM(qty_delta)` over the **union** of all
  devices' `stock_ledger` rows, exposed as a **view** (`stock_view`) so it can
  never be stale.
- Ledger rows are purely **additive and signed** (in > 0, out < 0), so the union
  across devices has no lost-update conflict at all — this is the root-cause
  fix for multi-device stock (ADR-002).
- **COGS is a recorded fact, not recomputed.** Per FR-321, each sale line records
  its realized COGS **at sale time** (client FIFO). The server stores those
  values as-is; server COGS = `SUM(cogs_minor)`. (Server-side FIFO *replay* of
  cost-layer consumption is a reporting concern, deferred to **v2** — stock,
  the value that actually conflicts, needs no replay; see §9.)

### 3.4 Delta pull (cursors)
- Each synced table carries a monotonic `updated_at` (server-assigned on
  insert/update, ≥ `created_at`).
- The client stores a per-table cursor in the local `delta_cursor` table.
  `pull` returns rows where `updated_at > cursor` for the outlet, then the
  client advances the cursor to the max `updated_at` seen.
- **Sync surface (M6):** `categories`, `products`, `sales` (+`sale_line`,
  `payment`), `stock_ledger`, `refunds` (+`refund_line`) — fetched in one
  parallel round-trip, then applied in **FK-safe order** in one local
  transaction: **categories → products → sales → lines/payments → refunds**
  (refunds last because they reference the sale by uuid, which may have just
  landed in the same batch).
- Append-only tables (sale, ledger, payment, refund) are pulled the same way;
  dedup is by the client UUIDs (3.1), so a row is applied locally at most once.
- Pulled rows are written locally under **this device's** local outlet id
  (tenant remap at the boundary, §4); child rows that reference a parent by
  cloud uuid are re-keyed to the local parent id (sale uuid → local sale id;
  refund → sale; product → remapped category id, §3.5).

### 3.5 Categories (M6, schema v3) — identity, merge, remap
**Why categories had to become a synced entity.** `product.category_id` is a
foreign key, and CSV import (FR-314) creates categories **by name** on the
fly. In M5 categories were local-only — so a store whose device A imported a
CSV with a new category left device B's product pull permanently failing on
an FK violation: one device's master data stalled the *entire* other device's
pull batch. (R2, the M6 incident this section closes.)

**Identity model (ADR-011).** A category's identity is its **client UUID**;
its name is a *display attribute*, not an identity. Consequences:
- **Local:** `category.name` is UNIQUE per store (the UX invariant — a shop
  doesn't want two "Dairy" rows).
- **Cloud: deliberately NO `UNIQUE(outlet_id, name)`.** Two devices can both
  create "Dairy" offline (ids are per-device UUIDs); a server uniqueness
  constraint would make *one* of those writes fail. With LWW + remap, neither
  is lost — the store converges on one local row.
- There is **no rename path** today, so a category's name only changes via a
  re-import/CSV update (which bumps `updated_at` and LWW-merges).

**Merge.** Categories merge exactly like products: LWW on `updated_at` with
the `device_id` tie-break, applied by the idempotent `apply_category` RPC
(client UUID keyed). The client-side resolver is pure and unit-tested
(`resolveCategoryDelta` in `src/lib/sync.ts`):
- **New** remote id → written locally.
- **Same id** → LWW.
- **Same name, different id** (the offline collision above) → the **local row
  keeps its identity**; the remote id is mapped onto it (a `remoteId → localId`
  remap), and the remote row is *not* written as a duplicate.
- The comparison is against the **full local category table** (small — shop
  master data), not just the ids in the batch, so a name clash with a local
  row that isn't in this pull round is still caught.

**Remap at pull.** Pulled products whose `category_id` names a remapped remote
id are **re-keyed to the local row's id** before the upsert — which is what
keeps both the local `UNIQUE(name)` invariant and the FK intact (a hard INSERT
of the colliding remote row is exactly the bug this removes).

**Write path + upgrade.** Category ops are enqueued to the outbox **at write
time** (product create/edit that touches a category, CSV import). Stores whose
local categories predate M6 (seeded or CSV-imported before v3) get a one-shot
`backfillCategoriesOnce` on their first sync after the app upgrade (settings
flag `cloud.backfill_v3`, idempotent per `category.id`) — existing categories
push up without the owner doing anything.

**Deactivation, not deletion.** Categories are switched off (`active = 0`),
never deleted; the flag LWW-merges like any other field. No tombstones are
needed in v1 of this entity.

## 4. Multi-device convergence (exit test)

**Joining the tenant (multi-device, ADR-007).** Each device's LOCAL outlet
keeps its own id (all local rows are keyed by it). The cloud outlet row is
the TENANT id. `provisionStore` is create-or-join: the first device creates
the cloud row (tenant id = its local id); a later device that signs in finds
the existing row and JOINS it — the row is left untouched and the owner is
registered as its member. The wizard persists the tenant id
(`cloud.outlet_id`); sync then re-maps at the boundary in both directions:
- **push** — payload `outlet_id` is rewritten local → tenant (payloads are
  reconstructed at drain time, so the remap is one field);
- **pull** — pulled rows are written locally with the device's local outlet
  id, so every single-tenant local query sees them.

**Scenario:** two devices, same tenant, both offline.
1. Device A sells croissant (client UUID `X`) → local sale + ledger rows, outbox queued.
2. Device B sells croissant (client UUID `Y`) → local sale + ledger rows, outbox queued.
3. Both connect + sync.
4. Server now has sale `X` and sale `Y` (distinct UUIDs → **both** applied), and
   `stock_view` = opening stock − A.qty − B.qty.
5. A **retry** of either upload is a no-op (same UUID already present) → **no
   double-apply**.
6. Both devices then **pull** the same server state → their local projections
   converge and agree.

**Acceptance mapping:** "Two devices, same outlet: offline sale on each → sync
→ identical server ledger, stock = server-recomputed projection, no double-apply
(client-UUID idempotency proven)." ✓

## 5. Auth (FR-505) in the BYO model
- **Owner** is the only human with a backend account: signs up with
  email + password **in the store's own project** (Supabase Auth) during setup.
- The **device** holds the owner's session (secure storage). Sync runs under it.
- **Cashiers have no backend account.** They sign in to a shared device with a
  **local PIN** (M4 roles/PIN). The PIN selects the user for role-gating + sale
  attribution (`sale.cashier_id`); the backend never sees a PIN.
- RLS (FR-506) is deployed to every project as defense-in-depth even though each
  project is single-tenant (DEV-006).

## 6. Provider-agnostic guarantees + rollback
- Data is always **local-first** (SQLite is the source of truth on-device); the
  backend is a **redundant copy**, never the sole home of data. Going local-only
  loses nothing.
- Because the backend is Postgres, worst-case portability is a standard
  `pg_dump` — independent of the app.
- See §2 for the three lossless rollback levels.

## 7. Locale engines (M5, provider- and network-independent)
These are **pure local logic** (no cloud) and ship regardless of sync state:
- **TaxEngine** (`src/lib/tax.ts`) — already implemented; reference locale
  SG / SGD / GST 9% inclusive. Switching the outlet's engine id changes rate +
  display with **no hardcoded rate in the register** (ADR-004). The prototype's
  **8.25% demo fixture is removed** in M5 so `grep 8.25` returns zero
  (acceptance item).
- **PaymentMethods** (`src/lib/payment.ts`) — per-locale method list
  (cash / card / QR / mobile). **QR = stub acquirer behind an interface**
  (show-QR + record-reference; no real acquirer wired — BUILD-PROMPT
  non-negotiable, ADR-006).
- **BarcodeParser** (new, M5) — per-locale weighed-barcode parsing
  (embedded-weight EAN-13 / scale formats), pure + unit-tested.
- **Receipt template** (new, M5) — 58/80mm parameterized by TaxEngine output
  (FR-604).

## 8. Module map (M5 additions)
- `src/lib/sync.ts` — **pure** merge/idempotency/cursor/LWW rules (unit-tested,
  no DB/RN imports).
- `src/lib/cloud/types.ts` — `CloudAdapter` interface + op/cursor types.
- `src/lib/cloud/supabaseAdapter.ts` — reference implementation.
- `src/lib/cloud/schema.sql.ts` — the versioned, idempotent BYO SQL bundle.
- `src/lib/barcode.ts` — BarcodeParser engine (pure).
- `src/lib/receipt.ts` — receipt layout engine (pure).
- `src/repositories/outboxRepository.ts` — outbox + delta_cursor SQL.
- `src/hooks/useSync.ts` — the sync engine hook (drain/pull, status).
- `app/cloud-setup.tsx` — the BYO setup wizard.
- Settings → **Cloud sync** section (toggle + connect/disconnect + last-synced).

### 8.1 M6 additions
- `src/lib/sync.ts` — `resolveCategoryDelta` (pure: LWW + same-name remap; 9
  unit tests).
- `src/lib/cloud/schemaSql.ts` — **bundle v3**: `category` table + RLS +
  idempotent `apply_category` RPC (see §10).
- `src/lib/cloud/types.ts` — `schemaVersion(cfg)` (replaces the boolean
  `schemaDeployed`; null = not deployed, number = max applied version).
- `app/cloud-setup.tsx` — **version-aware** wizard (deploy / upgrade /
  straight-to-account — §10).
- `src/repositories/outboxRepository.ts` — `backfillCategoriesOnce`
  (one-shot category backfill for pre-v3 stores).
- `src/hooks/useSync.ts` — 5-entity pull, FK-safe apply order (categories
  first), refund apply (uuid → local sale id resolution).

## 9. Open items
**Resolved during build:**
- ~~Supabase auth flow for BYO setup~~ — confirmed: owner `signUp` may require
  email confirmation; the wizard handles the "check your email" state (primary
  action flips to sign-in) and existing-account fallback.
- ~~Second-device simulation for the exit test~~ — two AVDs (A/B), both real
  dev builds, real local Supabase; exit test passed on both.
- ~~M5 "re-run the setup SQL" dead end~~ (found while writing M6 docs) — a
  store on an older bundle got a sync error telling it to re-run the SQL, but
  the wizard only offered the SQL step when *no* schema was detected. Fixed in
  the version-aware wizard (post-m6 commit, §10); device-verified both paths.

**Deferred to v2 (explicit non-goals for M1–M6):**
- **Server-side FIFO cost-layer replay** for reporting (§3.3) — server COGS is
  the sum of recorded client FIFO facts, which is correct for the value that
  conflicts (stock); a replay report is a nicety, not a correctness gap.
- **Document-level sync of shifts, POs, stocktakes, suppliers.** These are
  local-only entities in M1–M6 (`SyncEntity` = sale | ledger | product |
  refund | category). Stock *converges* anyway because every stock movement
  (PO receive, stocktake adjustment) flows through `stock_ledger`; the PO /
  stocktake / shift *documents* stay on the device that created them.
- **Category rename path + tombstones** — deactivation covers the current UX;
  renames would need the name-invariant re-checked (ADR-011).

## 10. Schema bundle versions + the upgrade path (M6)
The BYO bundle (`src/lib/cloud/schemaSql.ts`, `CLOUD_SCHEMA_VERSION = 3`) is:
- **cumulative** — each version's bundle contains everything earlier versions
  had, so the *current* bundle is always the one to paste;
- **idempotent** — `IF NOT EXISTS` / `OR REPLACE` / `DROP POLICY IF EXISTS`;
  the meta row inserts with `ON CONFLICT DO NOTHING`. **Re-pasting the current
  bundle over an older deployment is safe and never touches existing data**
  (proven live: the demo project ran v1 → v2 → v3 with data intact).

| Version | Milestone | Added |
|---|---|---|
| v1 | M5 | `outlet`, `org_member` + `is_member`, `product`, `product_audit`, `sale`, `sale_line`, `payment`, `stock_ledger` (+`stock_view`), `apply_sale`/`apply_ledger`/`apply_product`, RLS |
| v2 | M5→M6 | `refund`, `refund_line`, `apply_refund` (refund sync surface, §3.1) |
| v3 | M6 | `category` + RLS + `apply_category` (§3.5) |

**Version detection.** `cloud_schema_meta` is `version int PRIMARY KEY` — one
row per applied version. `schemaVersion()` returns the **max** version row
(null when the table doesn't exist / can't be found, i.e. not deployed).

**Version-aware wizard** (`app/cloud-setup.tsx`). The connection check
compares the deployed version with `CLOUD_SCHEMA_VERSION`:
| Deployed | Wizard behavior |
|---|---|
| `null` (not deployed) | "deploy" SQL step — the original first-run flow. |
| `v < current` | **"upgrade" SQL step** — title "Run the updated setup SQL (schema vN — upgrade)" + the safety note ("re-running it is safe and it NEVER touches your existing data"), with the current bundle shown + Copy. |
| `v ≥ current` | SQL step **skipped** — straight to the owner-account step ("Backend reachable and the Nurledger schema is deployed."). |

Why this matters: without it, a store that connected on an older app version
would upgrade the app and hit sync errors ("re-run the setup SQL") with **no
in-app path to the script** — the wizard's old check only detected *absence*,
not staleness. The owner's path for an upgrade: Settings → Cloud sync →
**Disconnect** (device data is untouched) → **Connect your store** → the wizard
detects the old bundle and shows the updated script.

**Verified on device (2026-10-31, local Supabase + dev build):**
1. Store on **v3**: disconnect → reconnect → SQL step skipped → sign-in
   fallback (existing account) → link store → Connected → sync resumed.
2. Store forced to **v1** (`DELETE FROM cloud_schema_meta WHERE version IN
   (2,3)`): reconnect → wizard showed the **upgrade** step ("it runs schema
   v1, but this app needs v3") → re-ran the v3 bundle → check passed →
   sign-in → link → Connected → sync resumed, data intact, meta rows restored.
