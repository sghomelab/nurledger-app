/**
 * Insights hook (FR-400/FR-401/FR-403) — period-scoped KPIs, P&L, Velocity/ABC,
 * stockout forecast, expenses, and sales history. Focus-refetch + period-change
 * refetch (same pattern as useAppData).
 */

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  computeKpis,
  computeStockout,
  computeVelocityAbc,
  lifetimeDays,
  periodDays,
  periodStartMs,
  type Kpis,
  type PeriodId,
  type StockoutRow,
  type VelocityAbcRow,
} from '../lib/kpi';
import {
  addExpense as repoAddExpense,
  listExpenses,
  type Expense,
  type ExpenseType,
} from '../repositories/expenseRepository';
import {
  getActiveProductStock,
  getExpiredInventoryValueMinor,
  getFirstSaleAt,
  getInventoryValuation,
  getOpexTotals,
  getPeriodSalesByMethod,
  getPeriodTotals,
  getProductSalesInPeriod,
  getPoFillUnits,
  getReceivedUnitsInPeriod,
  getSalesHistory,
  getShrinkageValueMinor,
  type SalesHistoryEntry,
} from '../repositories/insightsRepository';
import { getOutlet } from '../repositories/outletRepository';
import type { SalesByMethod } from '../lib/shift';

export interface InsightsData {
  period: PeriodId;
  fromMs: number;
  days: number;
  kpis: Kpis;
  /** FR-400: Σ payment.amount_minor by method for the period (zero keys omitted). */
  salesByMethod: SalesByMethod;
  abcRows: VelocityAbcRow[];
  stockoutRows: StockoutRow[];
}

export interface UseInsights {
  data: InsightsData | null;
  expenses: Expense[];
  salesHistory: SalesHistoryEntry[];
  search: string;
  setSearch: (s: string) => void;
  setPeriod: (p: PeriodId) => void;
  addExpense: (type: ExpenseType, amountMinor: number, description?: string | null) => Promise<void>;
  reload: () => Promise<void>;
  reloadHistory: () => Promise<void>;
}

export function useInsights(initialPeriod: PeriodId = 'today'): UseInsights {
  const [period, setPeriod] = useState<PeriodId>(initialPeriod);
  const [data, setData] = useState<InsightsData | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [salesHistory, setSalesHistory] = useState<SalesHistoryEntry[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(
    async (p: PeriodId, q: string) => {
      const fromMs = periodStartMs(p);
      const [totals, opex, inventory, prodSales, stock, firstSaleAt, receiptsUnits, adjustmentLossMinor, expiredValueMinor, poFill, salesByMethod] =
        await Promise.all([
          getPeriodTotals(fromMs),
          getOpexTotals(fromMs),
          getInventoryValuation(),
          getProductSalesInPeriod(fromMs),
          getActiveProductStock(),
          getFirstSaleAt(),
          getReceivedUnitsInPeriod(fromMs),
          getShrinkageValueMinor(fromMs),
          getExpiredInventoryValueMinor(new Date().toLocaleDateString('en-CA')),
          getPoFillUnits(fromMs),
          getPeriodSalesByMethod(fromMs),
        ]);

      const kpis = computeKpis({
        ...totals,
        fromMs,
        opex,
        inventory,
        extras: {
          receiptsUnits,
          adjustmentLossMinor,
          expiredValueMinor,
          activeSkuCount: stock.length,
          zeroStockSkuCount: stock.filter((s) => s.stockQty <= 0).length,
          poOrderedUnits: poFill.ordered,
          poReceivedUnits: poFill.received,
        },
      });

      // Velocity denominator: today = 1, month = days elapsed, all = days since
      // the first sale (so "all time" velocity stays a per-day rate).
      const days = p === 'all' ? lifetimeDays(firstSaleAt) : periodDays(p);

      const salesByProduct = new Map(prodSales.map((r) => [r.productId, r]));
      const abcInputs = stock.map((s) => {
        const sold = salesByProduct.get(s.productId);
        return {
          productId: s.productId,
          name: s.name,
          sku: s.sku,
          category: s.category,
          unitsSold: sold?.unitsSold ?? 0,
          revenueMinor: sold?.revenueMinor ?? 0,
          cogsMinor: sold?.cogsMinor ?? 0,
          currentStock: s.stockQty,
        };
      });
      const abcRows = computeVelocityAbc(abcInputs, days);
      const stockoutRows = computeStockout(abcInputs, days);

      setData({ period: p, fromMs, days, kpis, salesByMethod, abcRows, stockoutRows });
      setExpenses(await listExpenses(fromMs));
      setSalesHistory(await getSalesHistory(fromMs, q));
    },
    [],
  );

  const reload = useCallback(async () => {
    await load(period, search);
  }, [load, period, search]);

  const reloadHistory = useCallback(async () => {
    const fromMs = periodStartMs(period);
    setSalesHistory(await getSalesHistory(fromMs, search));
  }, [period, search]);

  // Period or search changes re-run the load immediately (focus-effect alone
  // only fires on tab refocus).
  useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const addExpense = useCallback(
    async (type: ExpenseType, amountMinor: number, description?: string | null) => {
      const outlet = await getOutlet();
      if (!outlet) throw new Error('No outlet — DB not seeded');
      await repoAddExpense({ outletId: outlet.id, type, amountMinor, description });
      await reload();
    },
    [reload],
  );

  return {
    data,
    expenses,
    salesHistory,
    search,
    setSearch,
    setPeriod,
    addExpense,
    reload,
    reloadHistory,
  };
}
