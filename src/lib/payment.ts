/**
 * Payment methods + tender math (FR-107, ADR-006). Pure, integer minor units.
 *
 * The method registry is the per-locale PaymentMethods plugin surface. In the MVP
 * card is "tendered via external terminal" and QR is the acquirer flow — both are
 * STUBS here (no real terminal/acquirer is wired; BUILD-PROMPT non-negotiable).
 */

import type { PaymentAllocation, PaymentMethodId } from '../types';

export interface PaymentMethodMeta {
  id: PaymentMethodId;
  label: string;
  kind: 'cash' | 'card' | 'qr' | 'other';
}

export const PAYMENT_METHODS: PaymentMethodMeta[] = [
  { id: 'cash', label: 'Cash', kind: 'cash' },
  { id: 'card', label: 'Card', kind: 'card' },
  { id: 'mobile', label: 'Mobile Pay', kind: 'other' },
  { id: 'qr', label: 'QR Pay', kind: 'qr' },
];

/** Change due when tender ≥ total; 0 otherwise. */
export function changeDue(tenderedMinor: number, totalMinor: number): number {
  return Math.max(0, tenderedMinor - totalMinor);
}

/** True when the allocations cover the total. */
export function isCovered(allocations: PaymentAllocation[], totalMinor: number): boolean {
  if (totalMinor < 0) return false;
  const sum = allocations.reduce((s, a) => s + a.amountMinor, 0);
  return sum >= totalMinor;
}

/**
 * Split the grand total across `methods` (FR-107). Integer-safe: each method gets
 * the floor share, then the remainder is distributed one minor unit at a time so
 * the allocations ALWAYS sum exactly to `totalMinor`.
 */
export function evenSplit(totalMinor: number, methods: PaymentMethodId[]): PaymentAllocation[] {
  if (methods.length === 0) return [];
  const base = Math.floor(totalMinor / methods.length);
  const allocs: PaymentAllocation[] = methods.map((method) => ({ method, amountMinor: base }));
  let remainder = totalMinor - base * methods.length;
  let i = 0;
  while (remainder > 0) {
    const slot = allocs[i];
    if (!slot) break; // i is always in [0, methods.length); safety only
    slot.amountMinor += 1;
    remainder -= 1;
    i = (i + 1) % methods.length;
  }
  return allocs;
}
