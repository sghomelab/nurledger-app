/**
 * Expense repository (M4 — prototype Analytics "Operating Costs": Staff
 * Payroll / Maintenance / Other Operational). Immutable rows: no UPDATE or
 * DELETE path exists — an expense is a fact, like a ledger row. Entries flow
 * straight into the P&L operating costs (insightsRepository.getOpexTotals).
 */

import { getDb } from '../db/database';
import { uuidv4 } from '../lib/ids';

export type ExpenseType = 'payroll' | 'maintenance' | 'other';

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  payroll: 'Staff Payroll',
  maintenance: 'Maintenance',
  other: 'Other Operational',
};

export interface Expense {
  id: string;
  type: ExpenseType;
  amountMinor: number;
  description: string | null;
  createdAt: number;
}

export async function addExpense(input: {
  outletId: string;
  type: ExpenseType;
  amountMinor: number;
  description?: string | null;
}): Promise<Expense> {
  if (input.amountMinor <= 0) throw new Error('Expense amount must be positive');

  const db = await getDb();
  const id = uuidv4();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO expense (id, uuid, outlet_id, type, amount_minor, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, uuidv4(), input.outletId, input.type, Math.round(input.amountMinor),
     input.description?.trim() || null, now],
  );
  return { id, type: input.type, amountMinor: Math.round(input.amountMinor),
    description: input.description?.trim() || null, createdAt: now };
}

/** Expenses in a period (fromMs = 0 → all time), most recent first. */
export async function listExpenses(fromMs = 0, limit = 100): Promise<Expense[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string; type: string; amount_minor: number; description: string | null; created_at: number;
  }>(
    'SELECT id, type, amount_minor, description, created_at FROM expense WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?',
    [fromMs, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type as ExpenseType,
    amountMinor: r.amount_minor,
    description: r.description,
    createdAt: r.created_at,
  }));
}
