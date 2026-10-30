/**
 * Data hooks — thin async wrappers over the repositories with reload triggers.
 * All app reads go through local SQLite (offline-first rule 1).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createProduct,
  createCategory,
  deactivateProduct,
  getOutlet,
  listCategories,
  listProducts,
  lowStockCount,
  updateProduct,
  type ProductInput,
} from '../repositories/productRepository';
import { appendLedgerRow, addCostLayer } from '../repositories/stockRepository';
import type { Category, Outlet, ProductWithStock } from '../types';

export function useOutlet() {
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const load = useCallback(async () => {
    setOutlet(await getOutlet());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { outlet, reload: load };
}

export function useProducts() {
  const [products, setProducts] = useState<ProductWithStock[] | null>(null);
  const [lowStock, setLowStock] = useState(0);
  const [search, setSearch] = useState('');

  const reload = useCallback(async (q = search) => {
    const [list, low] = await Promise.all([listProducts(q), lowStockCount()]);
    setProducts(list);
    setLowStock(low);
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

/**
 * Stock-in (receiving) — appends an immutable ledger row + FIFO cost layer.
 * Used by PO receive (M3) and manual stock adjustments.
 */
export async function receiveStock(
  productId: string,
  qty: number,
  unitCostMinor: number,
  refType: string,
  refId: string,
): Promise<void> {
  const row = await appendLedgerRow({
    productId,
    type: 'receive_po',
    qtyDelta: qty,
    unitCostMinor,
    refType,
    refId,
  });
  await addCostLayer(productId, unitCostMinor, qty, refType, refId);
  void row;
}
