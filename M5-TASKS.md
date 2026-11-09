# M5 Build Tracker — Cloud & Sync (BYO + CloudAdapter)

Design: `docs/SYNC-DESIGN.md` · ADR-010 · DEV-006. Sync OFF by default.

## Test backend (local Supabase, full fidelity)
- [x] Docker live; emulator = local (reaches host via 10.0.2.2)
- [x] supabase CLI installed → /home/mars/supabase-cli/
- [x] `supabase start` (Postgres+PostgREST+GoTrue+RLS at :54321; Studio :54323)
- [x] Deploy BYO SQL bundle via psql (simulates "user pastes into SQL Editor")
- [x] Second AVD `testavd` booted (port 5556) for two-device test
- [x] Keys saved to gitignored `supabase-local/keys.env`

## Code
- [x] `src/lib/sync.ts` (pure): FIFO queue, LWW merge, delta-apply, cursor advance, convergence check, retry policy
- [x] `src/__tests__/sync.test.ts` — no double-apply, LWW+audit, cursor, FIFO order
- [x] `src/lib/cloud/types.ts` — CloudConfig + CloudAdapter interface + op payload types
- [x] `src/lib/cloud/schemaSql.ts` — versioned idempotent BYO SQL bundle (tables, RLS, apply_sale/apply_ledger/apply_product RPCs, stock_view)
- [x] `src/lib/cloud/supabaseAdapter.ts` — @supabase/supabase-js impl + SQLite-backed storage shim (NO new native deps)
- [x] `src/lib/barcode.ts` (pure) — BarcodeParser engine (weighed EAN-13/scale formats, SG reference)
- [x] `src/__tests__/barcode.test.ts`
- [x] `src/lib/receipt.ts` (pure) — 58/80mm layout parameterized by TaxEngine output (FR-604)
- [x] `src/__tests__/receipt.test.ts`
- [x] `src/repositories/outboxRepository.ts` — enqueue (op_id=client UUID), pending FIFO, markUploaded, cursors, countByEntity, backfill
- [x] Enqueue-at-write: product edits (productRepository), stock moves (stockRepository standalone+PO receive path), sales (existing — keep)
- [x] `src/hooks/useSync.ts` — engine: drain FIFO → push → mark; pull deltas → apply (products LWW, sales/ledger union-by-UUID); status state
- [x] `app/cloud-setup.tsx` — BYO wizard (URL+anon+service keys → SQL-paste step w/ copy+verify → owner signUp → done)
- [x] Settings → Cloud sync section (connect state, ON/OFF toggle default OFF, last-synced, queue, disconnect)
- [x] FR-503 status surface on Sell tab ("N ops queued · Sync off" / "Syncing…" / "Synced" + manual Sync button)
- [x] PaymentMethods per-locale list + QR stub acquirer behind interface (FR-601, ADR-006) + PaymentSheet wiring
- [x] BarcodeParser wired to register scan entry (weighed → weight prompt → line at per-100g rate) (FR-103/104)
- [x] ReceiptView uses layoutReceipt engine (58/80mm choice in settings)
- [x] Remove 8.25 US tax preset (grep 8.25 → zero) + fix tests/settings text
- [x] Local schema v5: stock_view +qty_g, outbox partial index; upgrade path tested on device (data survives app update)
- [x] `@supabase/supabase-js` installed (pure JS; peer-deps checked)

## E2E (device, cs-test + testavd)
- [x] T1: BYO setup wizard on device A vs local supabase (verify SQL-paste step works) — CREATE path (A) + JOIN path (B, "already registered" → sign-in), 2026-10-31
- [x] T2: sync OFF by default — fresh profile shows pure-local; queue grows (B: "1 ops queued · sync off")
- [x] T3: offline sale on A + offline sale on B (supabase STOPPED) → start → both sync (B's sale made in a verified offline window: 0 containers, health refused)
- [x] T4: server ledger identical on both pulls; stock = recomputed; NO double-apply (psql: 5 sales / 11 products / 19 ledger / 22 audit; both devices identical croissant=10 sourdough=7; re-sync → counts unchanged). Bugs found+fixed during T4: product payload missing tenant remap (joined-device push rejected "not a member" → FIFO stall); pull child rows wrote sale_uuid into sale_id (FK fail → pull rolled back forever)
- [x] T5: product edit LWW on two devices + audit row present (psql proof) — A 350→400 (applied), B 400→450 later timestamp (applied, B wins); both devices pulled to 450/1793388766265; audit chain: created 350 → rejected(same-value) → applied 350→400 → applied 400→450
- [x] T6: tax grep zero; locale switch changes rate/display on device — `grep -rn "8.25" src/ app/` = 0 matches; preset MY (SST 10% incl, en-MY, MYR) → Sell shows "Tax (10%, incl.)" + MYR + methods Cash/Card/Touch 'n Go QR/Split; reverted to SG (GST 9%, en-SG, SGD)
- [x] T7: QR stub flow (show QR → reference recorded); weighed barcode path; receipt 58/80 render — Touch 'n Go QR (en-MY) → REFERENCE QR-FD5D88B0 → payment row (method=qr, reference recorded) + on receipt; weighed: EAN-13 2000000001250 → 1.25 kg × 8.90/kg = 11.13, ledger -1250g; receipts 48 cols (80mm) vs 32 cols + truncated names (58mm). Bugs found+fixed: Adjust dialog routed weighed qty to qtyDelta (invisible to grams stock) → now qtyGDelta; receipt width loaded once on mount (stale after Settings change) → useFocusEffect
- [x] T8: v4→v5 upgrade on device A with real data — no loss
- [x] T9: disconnect/reconnect — queue + cursors survive — sync OFF + sale → "1 ops queued · Sync off" → Disconnect (cloud config cleared; outbox + delta_cursor intact) → reconnect wizard (already-registered → sign in → "Your backend is linked") → sync ON → drained exactly once; server 10 sales incl. queued one; cursors advanced monotonically; 0 pending / 0 FK

## Docs + commit
- [x] FR-COVERAGE M5 section · MILESTONE-REPORTS M5 (matrix + bugs) · README status
- [x] tsc 0 + jest green + device matrix passed → single commit → tag m5 → push
- [x] memory/2026-10-31.md entry
