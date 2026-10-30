/**
 * useCart — the register's state (M2).
 *
 * - Loads the persisted active cart on mount (NFR-3: survives a kill mid-sale).
 * - Recomputes per-line FIFO COGS after every mutation so the live gross margin
 *   in the cart is always the margin the completed sale will record (FR-321).
 * - Persists every mutation to SQLite immediately.
 * - `charge()` completes the sale atomically and returns the receipt data.
 *
 * All money is integer minor units (ADR-004); all reads/writes hit local SQLite
 * (offline-first rule 1) — the network never blocks the register.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uuidv4 } from '../lib/ids';
import { parserForLocale } from '../lib/barcode';
import { cogsForWeight, linePriceForWeight } from '../lib/weighed';
import { allocateCogs, computeTotals } from '../lib/sale';
import { taxEngineFor } from '../lib/tax';
import { loadActiveOrder, saveActiveOrder } from '../repositories/orderRepository';
import { findByBarcode, findByWeighedKey } from '../repositories/productRepository';
import { completeSale, outboxCount, type SaleReceipt } from '../repositories/saleRepository';
import { costLayersOf, lotsFefo } from '../repositories/stockRepository';
import type { CartLine, PaymentAllocation, ProductWithStock } from '../types';
import { useOutlet } from './useAppData';

const REFERENCE_TAX_ENGINE = 'flat:sg-gst-9-inclusive';

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderDiscountMinor, setOrderDiscountMinor] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  // Refs mirror state so async mutation helpers never read a stale snapshot.
  const linesRef = useRef(lines);
  const discountRef = useRef(orderDiscountMinor);
  linesRef.current = lines;
  discountRef.current = orderDiscountMinor;

  const { outlet } = useOutlet();
  const taxEngine = useMemo(
    () => taxEngineFor(outlet?.taxEngine ?? REFERENCE_TAX_ENGINE),
    [outlet?.taxEngine],
  );
  const currency = outlet?.currency ?? 'SGD';

  const totals = useMemo(
    () => computeTotals(lines, orderDiscountMinor, taxEngine),
    [lines, orderDiscountMinor, taxEngine],
  );

  /** Refill a line's projected COGS from the current FIFO layers (live margin).
   *  WEIGHED lines (qtyG != null) keep their per-kg FACT COGS — they bypass
   *  fractional FIFO layer consumption by design (FR-103, SYNC-DESIGN). */
  const refreshCogs = useCallback(async (nextLines: CartLine[]): Promise<CartLine[]> => {
    if (nextLines.length === 0) return nextLines;
    const byProduct = new Map<string, CartLine[]>();
    for (const l of nextLines) {
      if (l.qtyG != null) continue; // weighed — COGS fact, no FIFO projection
      const arr = byProduct.get(l.productId) ?? [];
      arr.push(l);
      byProduct.set(l.productId, arr);
    }
    const updated: CartLine[] = [...nextLines];
    for (const [pid, group] of byProduct) {
      const [layers, lots] = await Promise.all([costLayersOf(pid), lotsFefo(pid)]);
      const lotId = lots[0]?.id ?? null;
      const alloc = allocateCogs(layers, group, lotId);
      group.forEach((line, i) => {
        const a = alloc[i];
        if (!a) return;
        const idx = updated.findIndex((x) => x.key === line.key);
        if (idx >= 0) {
          const cur = updated[idx];
          if (cur) updated[idx] = { ...cur, cogsMinor: a.cogsMinor, unitCostMinor: a.unitCostMinor, lotId: a.lotId };
        }
      });
    }
    return updated;
  }, []);

  const refreshPending = useCallback(async () => {
    setPending(await outboxCount());
  }, []);

  const persist = useCallback(async (nextLines: CartLine[], nextDiscount: number) => {
    setLines(nextLines);
    linesRef.current = nextLines;
    setOrderDiscountMinor(nextDiscount);
    discountRef.current = nextDiscount;
    await saveActiveOrder(nextDiscount, nextLines);
  }, []);

  // Load the active cart once on mount.
  useEffect(() => {
    (async () => {
      try {
        const active = await loadActiveOrder();
        if (active) {
          const withCogs = await refreshCogs(active.lines);
          setLines(withCogs);
          linesRef.current = withCogs;
          setOrderDiscountMinor(active.orderDiscountMinor);
          discountRef.current = active.orderDiscountMinor;
        }
      } finally {
        setLoaded(true);
        void refreshPending();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Apply a transformation to the lines, refresh COGS, update state, persist. */
  const mutate = useCallback(
    async (fn: (lines: CartLine[]) => CartLine[]) => {
      setBusy(true);
      try {
        const next = await refreshCogs(fn(linesRef.current));
        await persist(next, discountRef.current);
        void refreshPending();
      } finally {
        setBusy(false);
      }
    },
    [refreshCogs, persist, refreshPending],
  );

  const addProduct = useCallback(
    async (p: ProductWithStock, qty = 1) => {
      if (qty < 1) throw new Error('Quantity must be at least 1');
      if (p.stockQty <= 0) throw new Error(`${p.name} is out of stock`);
      await mutate((cur) => {
        const existing = cur.find((l) => l.productId === p.id);
        if (existing) {
          if (existing.qty + qty > p.stockQty) throw new Error(`Only ${p.stockQty} × ${p.name} in stock`);
          return cur.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + qty } : l));
        }
        const line: CartLine = {
          key: uuidv4(),
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unitPriceMinor: p.priceMinor,
          qty,
          qtyG: null,
          taxCategory: p.taxCategory,
          discountMinor: 0,
          cogsMinor: 0,
          unitCostMinor: null,
          lotId: null,
          stockQty: p.stockQty,
        };
        return [...cur, line];
      });
    },
    [mutate],
  );

  /**
   * M5 (FR-103): add a weighed line for `weightG` grams. The product's
   * priceMinor/costMinor are PER-KG rates; the line carries qty = 1 with the
   * per-line price = round(per-kg × grams / 1000) (FR-103) and a per-kg COGS
   * fact (bypasses fractional FIFO — documented).
   * `p.stockQty` is in grams for weighed products (STOCK_QTY_SQL).
   */
  const addWeighed = useCallback(
    async (p: ProductWithStock, weightG: number) => {
      if (weightG <= 0) throw new Error('Weight must be greater than zero');
      if (weightG > p.stockQty) throw new Error(`Only ${p.stockQty} g of ${p.name} in stock`);
      await mutate((cur) => {
        const line: CartLine = {
          key: uuidv4(),
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unitPriceMinor: linePriceForWeight(p.priceMinor, weightG),
          qty: 1,
          qtyG: weightG,
          taxCategory: p.taxCategory,
          discountMinor: 0,
          cogsMinor: cogsForWeight(p.costMinor, weightG),
          unitCostMinor: p.costMinor,
          lotId: null,
          stockQty: p.stockQty,
        };
        return [...cur, line];
      });
    },
    [mutate],
  );

  /**
   * Scan a barcode (FR-101/102/104). Routes through the outlet locale's
   * BarcodeParser (pluggable, spec §4.4):
   *  - plain GTIN → exact product match (unit or carton barcode, FR-322);
   *  - weighed in-store EAN-13 → the scale's item key; returns
   *    `{ needsWeight: { product, weightG } }` — `weightG` comes from the
   *    barcode tail so the register prompt can PRE-FILL it (the cashier
   *    confirms, or re-keys a manual weight).
   */
  const addByBarcode = useCallback(
    async (barcode: string): Promise<{ needsWeight?: { product: ProductWithStock; weightG: number } }> => {
      const code = barcode.trim();
      const parsed = parserForLocale(outlet?.locale).parse(code);
      if (parsed.kind === 'unknown') throw new Error(`Unrecognized barcode "${code}"`);
      if (parsed.kind === 'weighed') {
        const product = await findByWeighedKey(parsed.itemKey);
        if (!product) throw new Error(`No weighed product for scale key "${parsed.itemKey}"`);
        return { needsWeight: { product, weightG: parsed.weightG } };
      }
      const product = await findByBarcode(code);
      if (!product) throw new Error(`No product for barcode "${code}"`);
      // FR-318/FR-322: scanning the CARTON barcode sells a whole carton (cartonSize
      // base units); scanning the unit barcode sells 1 base unit.
      const qty = product.cartonBarcode === code ? product.cartonSize : 1;
      await addProduct(product, qty);
      return {};
    },
    [addProduct, outlet?.locale],
  );

  const setQty = useCallback(
    async (key: string, qty: number) => {
      await mutate((cur) =>
        cur.map((l) => {
          if (l.key !== key) return l;
          if (qty < 1) throw new Error('Quantity must be at least 1');
          if (qty > l.stockQty) throw new Error(`Only ${l.stockQty} × ${l.name} in stock`);
          return { ...l, qty };
        }),
      );
    },
    [mutate],
  );

  const removeLine = useCallback(
    async (key: string) => {
      await mutate((cur) => cur.filter((l) => l.key !== key));
    },
    [mutate],
  );

  const setLineDiscount = useCallback(
    async (key: string, discountMinor: number) => {
      await mutate((cur) =>
        cur.map((l) => (l.key === key ? { ...l, discountMinor: Math.max(0, discountMinor) } : l)),
      );
    },
    [mutate],
  );

  /** Per-line price override (BUILD-PROMPT "price adjust"). PIN-gating deferred
   *  until the roles/PIN system lands (SPEC-DEVIATION DEV-003). */
  const setLinePrice = useCallback(
    async (key: string, unitPriceMinor: number) => {
      await mutate((cur) =>
        cur.map((l) =>
          l.key === key ? { ...l, unitPriceMinor: Math.max(0, Math.round(unitPriceMinor)) } : l,
        ),
      );
    },
    [mutate],
  );

  const setOrderDiscount = useCallback(
    async (discountMinor: number) => {
      const d = Math.max(0, discountMinor);
      setOrderDiscountMinor(d);
      discountRef.current = d;
      await saveActiveOrder(d, linesRef.current);
    },
    [],
  );

  const clear = useCallback(async () => {
    await persist([], 0);
  }, [persist]);

  /**
   * Attribution for the completed sale (M4): who was at the register and
   * under which open shift. Both are recorded on the sale (sale.cashier_id /
   * sale.shift_id) so reports and the drawer math tie back to the person + shift.
   */
  const charge = useCallback(
    async (
      payments: PaymentAllocation[],
      attribution?: { cashierId?: string | null; shiftId?: string | null },
    ): Promise<SaleReceipt> => {
      if (linesRef.current.length === 0) throw new Error('Cart is empty');
      setBusy(true);
      try {
        const receipt = await completeSale({
          lines: linesRef.current,
          payments,
          orderDiscountMinor: discountRef.current,
          taxEngineId: outlet?.taxEngine ?? REFERENCE_TAX_ENGINE,
          cashierId: attribution?.cashierId ?? null,
          shiftId: attribution?.shiftId ?? null,
        });
        // completeSale already cleared the DB cart; sync local state.
        await persist([], 0);
        void refreshPending();
        return receipt;
      } finally {
        setBusy(false);
      }
    },
    [outlet?.taxEngine, persist, refreshPending],
  );

  return {
    lines,
    orderDiscountMinor,
    totals,
    currency,
    outlet,
    loaded,
    busy,
    pending,
    addProduct,
    addWeighed,
    addByBarcode,
    setQty,
    removeLine,
    setLineDiscount,
    setLinePrice,
    setOrderDiscount,
    clear,
    charge,
    refreshPending,
  };
}

export type CartApi = ReturnType<typeof useCart>;
