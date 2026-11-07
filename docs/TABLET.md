# Tablet / large-screen support

`ios.supportsTablet` stays `true` on purpose: Nurledger shows a lot of data
(register, inventory, expiry, insights, shift) and must use the space well.
Because the stores require iPad screenshots when iPad is supported, every
release is checked on tablet-sized windows.

## Rules (all implemented in `src/lib/layout.ts`, unit-tested)

| Concept | Rule |
|---|---|
| Tablet class | **shortest side ≥ 600 dp** (a phone in landscape stays on the phone layout) |
| Two-pane register | tablet class AND usable width ≥ 720: catalogue (scan, search, product grid) left, order (cart, discount, totals, CHARGE) right; cart pane = 38% of width, clamped 340–480 dp |
| List columns | 1 on phones, 2 at ≥ 720, 3 at ≥ 1000 (Inventory, Expiry, Purchase orders) |
| Forms / detail screens | centered column, max 720 dp (`centeredColumn`) — Settings, product edit/detail, PO, refund, stocktake, CSV, labels, suppliers, cloud setup |
| Dashboards | centered column, max 1000 dp (`wideColumn`) — Insights, Shift |
| Whole app | capped at 1280 dp (`AppFrame`) on very large screens |
| Full-screen modals | payment / receipt / weigh are a centered 560 dp column (`ModalFrame`); bottom sheets capped at 640 dp |

Rotation, iPad Split View and Android multi-window re-evaluate the layout live
(`useLayout` uses `useWindowDimensions`); narrowing the window below the rules
falls back to the phone layout.

## Test checklist (real iPad + an Android tablet, release build)

1. Register portrait (820×1180) and landscape (1180×820): two panes, no clipped CHARGE button, cart scrolls independently, product grid scrolls independently, scanner input keeps focus.
2. Add 20+ lines to the cart: only the cart scrolls; totals and CHARGE stay visible.
3. Pay (cash / split / QR), receipt, weighed-item prompt: centered column, nothing stretched edge to edge.
4. Inventory / Expiry / PO list: 2 columns portrait, 3 landscape; a single or odd last item keeps its column width; pull-to-refresh works.
5. Product detail / edit, Settings, Cloud setup, Refund: centered, readable; keyboard does not cover the focused field.
6. Insights + Shift: KPI cards wrap sensibly; expense / cash-move sheets are not full-width.
7. Rotate with a half-filled cart and with a modal open: state kept, layout switches.
8. iPad Split View / Android split-screen at ~⅓ width: falls back to the phone layout without errors.
9. 200% font size, Bahasa Melayu: no truncated buttons in the cart pane (340 dp is the tightest case).
10. Screenshots for the stores (see the shot-list): iPad 13" and 11" portrait + landscape, Android 10" tablet.

## Screenshot shot-list (use the sample-data path; no real data)

Register with a filled cart (two-pane) · Inventory (3 columns, landscape) · Expiry radar · Insights · Shift/Z-report · Settings → Cloud sync (with the "Delete cloud account…" link visible only if useful for review).
