# M5 Cloud & Sync — Design (BYO + `CloudAdapter`)

> Status: **design locked 2026-10-31** (owner direction). This document is the
> architecture spec for the M5 build. Decisions: **ADR-010** (BYO cloud +
> provider seam, sync off by default) and **DEV-006** (user-provisioned backend
> instead of creator-provisioned multi-tenant).

## 1. The two big decisions

### 1.1 BYO — the store provisions its own backend
The app **does not** run a backend of its own and does not host customer data.
Each store creates its own backend project (reference: a **free Supabase**
project) and connects it from the app. The app is a **pure client**: it deploys
a versioned, idempotent SQL schema bundle into the store's project on first-run
setup, then syncs against it.

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
| Stock ledger row | `stock_ledger.sync_op_id` | **append-only**; `ON CONFLICT (sync_op_id) DO NOTHING`. |
| Payment | `payment.sale_uuid` + method + amount (composite) | inserted with its sale. |
| Product | `product.id` | **LWW** — see 3.2. |

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
  cost-layer consumption is a reporting concern, deferred to M6 — stock, the
  value that actually conflicts, needs no replay.)

### 3.4 Delta pull (cursors)
- Each synced table carries a monotonic `updated_at` (server-assigned on
  insert/update, ≥ `created_at`).
- The client stores a per-table cursor in the local `delta_cursor` table.
  `pull` returns rows where `updated_at > cursor` for the outlet, then the
  client advances the cursor to the max `updated_at` seen.
- Append-only tables (sale, ledger, payment) are pulled the same way; dedup is
  by the client UUIDs (3.1), so a row is applied locally at most once.

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

## 9. Open items (to resolve during M5 build)
- Confirm the exact Supabase auth flow for BYO setup (owner `signUp` may require
  email confirmation; the wizard must handle "check your email" or
  auto-confirm-in-test for the exit test).
- Second-device simulation for the exit test: second AVD vs same app with a
  different `device_id` (decide at implementation).
- Cost-layer server-side FIFO replay for reporting → **M6** (see §3.3).
