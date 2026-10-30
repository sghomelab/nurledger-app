/**
 * Data hooks — thin async wrappers over the repositories with reload triggers.
 * All app reads go through local SQLite (offline-first rule 1).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  createProduct,
  createCategory,
  deactivateProduct,
  listCategories,
  listProducts,
  lowStockCount,
  reorderCandidates,
  updateProduct,
  type ProductInput,
} from '../repositories/productRepository';
import { getOutlet } from '../repositories/outletRepository';
import { listPOs, type POSummary } from '../repositories/poRepository';
import type { Category, Outlet, ProductWithStock, ReorderCandidate } from '../types';

export function useOutlet() {
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const load = useCallback(async () => {
    setOutlet(await getOutlet());
  }, []);
  // Refetch on every screen focus so a store-settings save (currency/tax
  // locale) is picked up by every tab without a manual refresh (FR-602).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return { outlet, reload: load };
}

/**
 * Module-level low-stock count shared across every useProducts instance.
 * The tab-bar badge lives in TabLayout, whose own hook instance never
 * reloads; sharing the count means any instance's reload (a sale on Sell,
 * the focus-refresh on Inventory) updates the badge immediately.
 * (M3 — found on-device: in-screen counter showed 2, tab badge still 1.)
 */
let sharedLowStock = 0;
const lowStockListeners = new Set<() => void>();
function commitLowStock(n: number) {
  sharedLowStock = n;
  lowStockListeners.forEach((l) => l());
}
function subscribeLowStock(l: () => void) {
  lowStockListeners.add(l);
  return () => {
    lowStockListeners.delete(l);
  };
}

export function useProducts() {
  const [products, setProducts] = useState<ProductWithStock[] | null>(null);
  const [search, setSearch] = useState('');
  const lowStock = useSyncExternalStore(subscribeLowStock, () => sharedLowStock);

  const reload = useCallback(async (q = search) => {
    const [list, low] = await Promise.all([listProducts(q), lowStockCount()]);
    setProducts(list);
    commitLowStock(low);
  }, [search]);

  useEffect(() => {
    void reload(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const add = useCallback(async (input: ProductInput) => {
    const created = await createProduct(input);
    await reload();
    return created;
  }, [reload]);

  const edit = useCallback(async (id: string, input: ProductInput) => {
    const updated = await updateProduct(id, input);
    await reload();
    return updated;
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await deactivateProduct(id);
    await reload();
  }, [reload]);

  return { products, lowStock, search, setSearch, reload, add, edit, remove };
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const reload = useCallback(async () => {
    setCategories(await listCategories());
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const addCategory = useCallback(async (name: string) => {
    const created = await createCategory(name);
    await reload();
    return created;
  }, [reload]);
  return { categories, reload, addCategory };
}

/** FR-308: low-stock products with Min/Max suggested reorder qty (Restock flow). */
export function useReorder() {
  const [candidates, setCandidates] = useState<ReorderCandidate[] | null>(null);
  const reload = useCallback(async () => {
    setCandidates(await reorderCandidates());
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { candidates, reload };
}

/** FR-306: the outlet's purchase orders (newest first). */
export function usePurchaseOrders() {
  const [orders, setOrders] = useState<POSummary[] | null>(null);
  const reload = useCallback(async () => {
    setOrders(await listPOs());
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { orders, reload };
}
