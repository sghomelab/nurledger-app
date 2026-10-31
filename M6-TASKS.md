# M6 Build Tracker — Release hardening

BUILD-PROMPT M6: refunds (line-level, restock, PIN), stocktake, pack/case-break UoM
(✅ M2/M3), dual barcodes (✅ M2/M3), label printing, i18n, Play/App Store packaging.
Plus the M-priority gaps the M5 audit surfaced: FR-306 print/share, FR-313 supplier
master, FR-314 CSV import/export, FR-320 margin-compression UI.
(FR-315 transfers = S1 — schema-ready already, no v1 UI.)

**Exit:** all FRs marked M pass their acceptance tests (ACCEPTANCE-TESTS.md).
**Packaging = prepare only** — NO EAS queue without Mas's explicit GO.

## Schema v6 (self-healing, data survives)
- [x] `supplier` (id, name, lead_time_days, notes) + per-supplier SKU link
      (`product.supplier_id` nullable — guarded ALTER in `ensureM6()`)
- [x] `refund` (existed M1) + `refund_line` (id, refund_id, sale_line_id,
      product_id, qty, qty_g, amount_minor, restock)
- [x] ENSURE_M6 self-healing bootstrap (every launch)
- [x] v5→v6 upgrade verified on a live populated DB (device E2E — schema_meta=6,
      all M6 tables, product.supplier_id, M1–M5 data intact)
- (stocktake/stocktake_count tables already exist from M1 — M6 adds UI + apply)

## Refunds (FR-110/FR-111, offline)
- [x] `src/lib/refund.ts` (pure): line amount = prorate line_total (incl. tax) by
      unit; reason codes; full vs per-line; restock per line. + test
- [x] `refundRepository`: atomic (refund + lines [+ restock ledger row + cost-layer
      restore] + outbox 'refund'), per-line caps (can't refund more than sold)
- [x] FR-501 gate `refund` (cashiers PIN; owner bypass) — device-verified
      (owner bypasses; cashier Jun → PIN prompt, wrong PIN rejected, owner PIN
      unlocks). `stocktake_apply` gate — device-verified in S1 (cashier Jun → PIN prompt, wrong 8-digit PIN
      rejected "try again", owner PIN 1234 unlocks, apply proceeds).
- [x] UI: sales-history row → Refund screen (per-line qty ≤ sold, reason code
      required, restock toggle per line, default on) → PIN → done — device-
      verified (weighed 1250g + unit 1-loaf; full-refund invariant exact)
- [x] Z-report `refundsMinor` wired (was reserved = 0 in M4) — device-verified
      (Z-Report shows "Refunds −SGD 11.13", shift closed Exact)
- [x] Sync: server `refund`/`refund_line` tables + RLS + pull (uuid dedupe);
      BYO bundle v6 (→ v2 bundle: `apply_refund` RPC + RLS + upgrade hint)

## Stocktake (FR-304)
- [x] `src/lib/stocktake.ts` (pure): variance = counted − book, totals. + test (10)
- [x] repo: create (all / by category, blind option), save counts (save-on-blur),
      apply (per-product 'adjustment' ledger rows, reason "Stocktake <local date>",
      PIN-gated) — one atomic tx: ledger row + 'ledger' outbox op per non-zero
      variance, then header applied
- [x] UI: Inventory → Stocktake (list + new sheet), count screen (blind hides book),
      live variance review vs LIVE book, apply CTA, applied read-only state

## Label printing (FR-317)
- [x] `src/lib/label.ts` (pure): 58×40mm label (name + price + barcode SVG +
      code), roll58 (one/page, @page 58mm) + sheetA4 (3-col grid) layouts,
      per-product count, HTML-escaped. Symbology: 12-digit → UPC-A (all-L left
      half — bit-for-bit = ZXing/Zint geometry), else Code 39 (43-char data
      set). 22 unit tests incl. ZXing-verified bit vectors.
- [x] Scan round-trip: scanners report leading-0 UPC-A as EAN-13 "0"+code →
      `parseBarcodeSg` normalizes 13-digit leading-0 → 12-digit (+test);
      `findByBarcode` also matches `sku` (case-insensitive) + '0'-prefixed form
      so no-barcode items print scannable Code 39 SKUs (FR-317 spec);
      `addByBarcode` now looks up on the parser's normalized code
- [x] UI: `app/labels/index.tsx` — scope (All / category rows / single product
      via ?product=<id>), copies stepper (default 5), paper toggle, summary
      (N × M = T, skipped count), Generate & Share → exports/*.html +
      expo-sharing (public.html). Entry points: product-detail "Label" action
      + Inventory tab "Label printing" row

## Supplier master (FR-313)
- [x] supplier CRUD (name, lead time, notes), SKU links. Device-verified:
      create "Sheng Siong Wholesale" (DB), edit lead 5→4 (DB), delete (DB=0),
      product link BEV-OAT-03 (DB join), product detail row "Supplier: Sheng
      Siong Wholesale / 4d lead", list sublabel "4d lead · 1 product"
- [x] PO form: supplier picker (autofills name) + free-text fallback.
      Device-verified: New PO → "Pick from supplier master" → "Pick vendor"
      sheet ("Sheng Siong Wholesale · 4d lead · 1 linked") → Vendor field
      autofilled; free-text field remains for vendors not in the master
- [x] delete-with-links: warning '"X" is linked to 1 product. Deleting unlinks
      them (products keep their data). Continue?' → DELETE unlinks (DB:
      supplier_id NULL, product retained) — then supplier recreated + re-linked
      (final demo state)

## CSV import/export (FR-314)
- [x] `src/lib/productCsv.ts` (pure): serialize/parse, validation. + 26 unit
      tests. RFC-4180 `splitCsv`; column mapping BY HEADER NAME (order free);
      strict per-row line-numbered validation; money in major units
- [x] UI: Inventory → "Product data (CSV)" hub → Export card (share sheet) /
      Import card (picker → /import-csv preview + report → apply)
- [x] Export device-verified: share sheet; pulled 12-line file — comma in
      description quoted (RFC-4180), major-unit money, category names resolved
- [x] Import device-verified (full E2E): search-based pick in DocumentsUI →
      preview "13 importable · 1 errors", bad row (price -5) reported as
      "line 15 · price: must be a non-negative number" → "Import 13 products"
      → "1 created · 12 updated · New categories: Imported · 1 row(s) skipped".
      DB: BEV-OAT-03 price_minor 550 / min_qty 20; CSV-TEST-01 created linked
      to auto-created category "Imported"; CSV-BAD-01 absent; outbox 7→20
      pending (1 create op with op_id=product.id + 12 `{productId}`-hint update
      ops — all refs resolve, 0 dangling)
- [x] SAF URI-grant root cause fixed + device-verified: picker URI carried via
      expo-router query string got percent-decoded (`document%3A…` →
      `document:…`); AMS grant lookup is an EXACT Uri match against the encoded
      string (proven via `dumpsys activity permissions`) → SecurityException on
      read. Fix: `src/lib/pickedFile.ts` module-state handoff (setPickedFile →
      router.push('/import-csv') with no params → getPickedFile). NOTE: NOT a
      Downloads/`raw:` provider issue — earlier conclusion was wrong. Also:
      file must be MediaStore-indexed (`MEDIA_SCANNER_SCAN_FILE`) for the
      picker's search to find it; picker contract + `takePersistableUriPermission`
      in expo-file-system v57 are correct. `File.name` for content URIs returns
      the docid (cosmetic; import header falls back to it)
- [x] Import screen has a Retry button on read failure (retriable SAF grant
      lag); readAndParse is a useCallback shared by mount effect + button

## PO print/share (FR-306)
- [x] PO document (text) generation + share (expo-sharing). `buildPoText` in
      `src/lib/po.ts` (pure, 4 unit tests; product names via `productRef`
      callback, fallback to raw product id) → exports/ dir → system share sheet
      (WhatsApp/email/print). Device-verified: PO detail → Share → share sheet
      with `po_test_wholesale_sg_*.txt`; pulled file: store/supplier/terms/
      created/received/status header, line "12 @ SGD 2.35 = SGD 28.20", lot +
      exp + received 12/12 annotation, "Total: SGD 28.20 (1 line, 12 units)"

## Margin compression (FR-320)
- [x] `analyzeMargin` in `src/lib/stock.ts` (pure) + 5 unit tests. Baseline =
      OLDEST cost layer (the cost the price was set against — spec §4.3.1),
      current = NEWEST layer. `compressed = current.cost > baseline.cost`.
      Suggested price = ceil(currentCost × 100 / (100 − baselineMarginPct))
      using the app's integer margin; null when baseline margin ≤0 or ≥100
- [x] product detail: amber warning card (margin %→% , latest cost vs baseline,
      suggested price) + "Use" action. price_override gate: owner/manager apply
      directly; cashier → PinPrompt (same wiring as stock_adjust/refund gates).
      Price is NEVER auto-changed — apply only on explicit confirmation (ADR-003)
- [x] Device-verified 2026-10-31: BEV-OAT-03 (price 5.50, layers 2.10→2.35) →
      card "Margin compressed 62% → 57% / Latest cost SGD 2.35 vs SGD 2.10 /
      SGD 6.19 holds 62% margin" (all figures hand-checked) → "Use" (owner, no
      PIN) → price now SGD 6.19, margin chip 66%, card recomputes to "66% → 62%
      … SGD 6.92 holds 66%". Single-layer product (PAN-PASTA-02) shows NO card.
      DB: price_minor 619, updated_at bumped, 1 new pending outbox op
      `{productId}` → BEV-OAT-03 (20→21 pending)

## i18n (FR-115) — EN + launch-locale (Malay), i18n files not code
- [x] `src/i18n/` (en + ms dictionaries, `t()`, `useT`), locale from outlet
      (en.ts `as const` → MsgKey; ms.ts typed `Record<keyof EnDict,string>` so
      the compiler enforces key parity; pure `resolveLang`/`t`/`bindT` in
      index.ts; device-local `ui.language` on the `settings` table via
      uiSettingsRepository — NEVER the outlet's business locale)
- [x] sweep user-facing strings (tabs, sell, inventory, settings, dialogs)
      (14 files + root-layout settings header title; 11 i18n tests incl.
      en↔ms parity, interpolation, EN fallback, no-Malay-plural. Documents/
      labels/PO bodies + payment-method names + tax-preset labels stay
      English by design — business data)

## Packaging (prepare only — NO EAS queue without GO)
- [x] eas.json profiles (development/preview/production), icon/splash present
      (profiles already in place: development = dev-client, preview =
      internal, production = autoIncrement; icon 1024 + Android adaptive
      fg/bg/mono + splash on #4F46E5 present in assets/)
- [x] store listing + privacy notes (docs/PACKAGING.md)
      (identity table, profile table, no-special-permissions rationale,
      Play/ASC runbook incl. shared service account + working ASC key,
      privacy posture: offline-first, BYO cloud ADR-010, no analytics/PII)

## E2E (device)
- [x] R1: offline refund (per-line, restock on) → stock + cost layer restored,
      reason + PIN enforced for cashier (owner bypasses; wrong PIN rejected).
      DB-verified: exact full-refund invariant, append-only ledger, net stock 0
- [x] R2: refund syncs to server + pulls on second device (Z-report refunds
      verified in R1; needs v2 bundle re-paste to local Supabase + device B)
      (DONE 2026-10-31, two emulators + local Supabase. PUSH: A's auto-retry
      drained all 21 pending ops after the v2 bundle re-paste — server has
      2 refunds (1113 customer_return / 650 order_mistake, restock=t),
      2 refund_lines (weighed qty_g=1250; count qty=1), 2 restock
      stock_ledger rows (+1250g; +1 @ 240). REAL BUG FOUND + FIXED: device
      B's pull failed forever with FOREIGN KEY constraint failed — the C1
      CSV test created category 'Imported' (b1d258d8) on A only; categories
      were NOT in the cloud schema, so B's product upsert for 'Import Test
      Product' violated product.category_id→category(id) and stalled the
      WHOLE pull batch on stale cursors. Fix = sync categories: cloud
      schema v3 (category table + RLS + idempotent apply_category LWW RPC,
      deliberately NO UNIQUE(outlet_id,name) — same-name/different-id
      duplicates are remapped on pull, never stall the FIFO), SyncEntity +
      'category', enqueue-at-write (createCategory + CSV auto-create),
      buildCategoryPayload, backfillCategoriesOnce (cloud.backfill_v3
      flag — seed/CSV categories predate the entity), local category
      created_at/updated_at (ensureM6 self-heal: guarded ALTER + NULL
      backfill), pull categories FIRST in applyPullLocally with the pure
      resolveCategoryDelta (LWW by id + same-name-remap, 9 new unit tests),
      products re-keyed through the remap. Re-pasted v3 → A auto-pushed 7
      categories → B pull completed: 7 categories incl. 'Imported', 2
      refunds + lines + restock ledger rows in B's DB, all 5 cursors
      advanced, cloud.last_error cleared, banner 'Synced'. B UI: refunded
      sale (SGD 11.13 Russet Apples) shows 'This sale has no refundable
      lines left.' Repro harness /tmp/opencode/sim_pull2.py: ALL STEPS OK.)
- [x] S1: blind stocktake (all products) → variance → PIN apply (cashier) →
      ledger rows. DB-verified: header applied, 3 counted rows (cheddar 22/20,
      sourdough 2/4, russet 4800/5000g) + 9 NULL, 3 'adjustment' rows
      ref_type='stocktake' with matching outbox op_ids, stock_view updated,
      cheddar +2 FIFO cost layer at product.cost_minor. (Bug found+fixed:
      reason date was UTC — a 5 AM stocktake stamped yesterday; now local date.)
- [x] L1: label batch → file generated + share sheet. Device-verified:
      Inventory → Label printing (scope chips All=12 + 6 categories with
      counts); Beverages × 4 copies, 58mm roll → share sheet with
      labels_cat_roll58_*.html; pulled file from device: 16 labels, 16 SVGs,
      correct names/prices/codes; ALL 4 unique barcodes ZBar-decoded from the
      device file (EAN-13 "0"+code form → parseBarcodeSg normalizes back).
      Product-detail "Label" → single-product scope (name in header, 1 × 5).
- [x] C1: CSV export → reimport → no dupes, updates applied (device-verified
      2026-10-31: export 12 products → share → import fixed 14-col test file
      (12 seeded SKUs @ new values + 1 new SKU + 1 bad-price row) → "1 created
      · 12 updated", no duplicate rows, bad row skipped + reported; DB verified
      incl. outbox ops. See FR-314 section above for the URI-grant root cause)
- [x] P1: PO share → document correct (device-verified 2026-10-31 — see FR-306
      section: share sheet + pulled file content verified line-by-line)
- [x] I1: locale switch EN → MS (UI strings change), MS → EN back
      (device-verified 2026-10-31: Settings → Language card (Segmented
      English | Bahasa Melayu, between Store and Currency) → tap Bahasa
      Melayu → ENTIRE Settings screen flips live incl. header
      "Store settings" → "Tetapan kedai", "Kedai", "Nama kedai *",
      "Mata Wang · FR-602", "Jual dalam", note text Malay; back → tab bar
      Jual/Inventori(3)/Tarikh Luput/Analitik/Syif + Sell screen Pesanan
      Semasa, CAJ, "Cukai (9%, termasuk)", JUMLAH, sync banner "21 operasi
      menunggu — menyegerak secara autom…"; relaunch app → still Malay
      (persisted); DB: settings ui.language='ms'. Tap English → full revert
      live incl. header, DB ui.language='en'. Note: useT uses
      useSyncExternalStore so the root-layout header title updates on the
      same tap (a plain per-instance state read left the header stale until
      the next navigation — fixed + re-verified on device).)

## Docs + gate
- [x] FR-COVERAGE M6 section + stale rows (2026-10-31: full M6 section +
      FR-100/FR-109/FR-604/FR-306/FR-202/FR-501 rows updated; DEV-004/005
      resolutions in SPEC-DEVIATION)
- [x] MILESTONE-REPORTS M6 (matrix + bugs + live outputs) (2026-10-31)
- [x] README M6 row (2026-10-31)
- [ ] tsc 0 + jest green + device-verified → single commit → tag m6 → push
