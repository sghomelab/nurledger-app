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
  | 'store_settings' // outlet currency/tax locale changes
  | 'refund' // FR-110 — refund create (manager PIN, spec FR-501)
  | 'stocktake_apply' // FR-304 — apply a counted stocktake (manager PIN, spec FR-501)
  | 'switch_user' // switching UP to a higher-privileged user (owner/manager)
  | 'add_user' // creating a user with a higher role than the active user
  | 'change_pin'; // set/reset a user's PIN (always re-authenticated)

export const GATE_ACTION_LABELS: Record<GateAction, string> = {
  discount: 'Discount',
  price_override: 'Price override',
  stock_adjust: 'Stock adjustment',
  close_shift: 'Close shift',
  store_settings: 'Store settings',
  refund: 'Refund',
  stocktake_apply: 'Apply stocktake',
  switch_user: 'Switch user',
  add_user: 'Add user',
  change_pin: 'Change PIN',
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

/**
 * Minimum unlocker rank needed to switch the register to `target`.
 * 0 = no PIN needed (switching sideways or down). Switching UP to a
 * higher-privileged user needs a PIN of at least that rank — otherwise any
 * cashier could become the owner and bypass every PIN gate.
 */
export function switchRankNeeded(active: AppUser | null, target: AppUser): number {
  const have = active ? roleRank(active.role) : 0;
  const want = roleRank(target.role);
  return want > have ? want : 0;
}

/** Same rule for creating a user: you cannot mint a role above your own without a PIN of that rank. */
export function addUserRankNeeded(active: AppUser | null, newRole: UserRole): number {
  const have = active ? roleRank(active.role) : 0;
  const want = roleRank(newRole);
  return want > have ? want : 0;
}

/**
 * Changing a PIN always re-authenticates: an unlocker (owner/manager PIN) of at
 * least the target's rank (cashier targets: manager or owner).
 */
export function changePinRankNeeded(target: AppUser): number {
  return Math.max(1, roleRank(target.role));
}
