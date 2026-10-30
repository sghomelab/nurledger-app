/**
 * Role gate matrix (FR-500, DEV-003/DEV-005 — the PIN gate "bolted on" in M4).
 *
 * FR-500: Owner (all) · Manager (no price/cost edit above threshold — threshold
 * logic out of M4 scope, treated as Owner for these gates) · Cashier (sell +
 * open/close shift). Spec persona: "Jun — cashier … owner's PIN protects the
 * rest."
 *
 * Model: a gated action is allowed directly when the ACTIVE user's role
 * permits it; otherwise the action may still be performed by entering an
 * UNLOCK PIN belonging to a higher-privileged active user (Owner/Manager).
 * The unlock is single-action and session-scoped (never persisted).
 */

import type { AppUser, UserRole } from '../types';

/** Actions that are gated by role + owner/manager PIN. */
export type GateAction =
  | 'discount' // FR-105 order/line discount (DEV-003)
  | 'price_override' // FR-105 per-line price adjust (DEV-003)
  | 'stock_adjust' // FR-305/DEV-005 adjustment apply
  | 'close_shift' // FR-202 — "manager PIN on close" (prototype)
  | 'store_settings'; // outlet currency/tax locale changes

export const GATE_ACTION_LABELS: Record<GateAction, string> = {
  discount: 'Discount',
  price_override: 'Price override',
  stock_adjust: 'Stock adjustment',
  close_shift: 'Close shift',
  store_settings: 'Store settings',
};

/** Owner and Manager pass every M4 gate directly (see header note). */
export function roleCanAct(role: UserRole, _action: GateAction): boolean {
  return role === 'owner' || role === 'manager';
}

/** Numeric rank for "higher-privileged" unlock checks. */
export function roleRank(role: UserRole): number {
  if (role === 'owner') return 2;
  if (role === 'manager') return 1;
  return 0;
}

/**
 * True when the given user may enter an unlock PIN for a gate
 * (Owner/Manager with a PIN set). Cashiers cannot unlock.
 */
export function canUnlock(user: AppUser): boolean {
  return roleCanAct(user.role, 'discount') && user.pinHash !== null;
}
