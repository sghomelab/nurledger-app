/**
 * Payment methods + tender math (FR-107, ADR-006). Pure, integer minor units.
 *
 * Per-locale PaymentMethods plugin (FR-601): `paymentMethodsFor(locale)`
 * returns the method list for the outlet's locale (cash/card/QR — labels and
 * the QR acquirer differ by locale). QR is a STUB acquirer behind the
 * `QRAcquirer` interface (spec: "show QR image" + record reference — the real
 * acquirer integration is v2; ADR-006).
 */

import { uuidv4 } from './ids';
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

// ---------------------------------------------------------------------------
// Per-locale PaymentMethods plugin (FR-601)
// ---------------------------------------------------------------------------

/** A method as presented for a locale (label/icon/acquirer are locale data). */
export interface LocaleMethod {
  id: PaymentMethodId;
  label: string;
  /** Ionicons name. */
  icon: string;
  kind: 'cash' | 'card' | 'qr' | 'other';
  /** Present when this method shows the acquirer's QR (FR-601). */
  qrAcquirer?: string;
}

const SG_METHODS: LocaleMethod[] = [
  { id: 'cash', label: 'Cash', icon: 'cash-outline', kind: 'cash' },
  { id: 'card', label: 'Card', icon: 'card-outline', kind: 'card' },
  { id: 'qr', label: 'PayNow QR', icon: 'qr-code-outline', kind: 'qr', qrAcquirer: 'paynow' },
];

const MY_METHODS: LocaleMethod[] = [
  { id: 'cash', label: 'Cash', icon: 'cash-outline', kind: 'cash' },
  { id: 'card', label: 'Card', icon: 'card-outline', kind: 'card' },
  { id: 'qr', label: 'Touch \'n Go QR', icon: 'qr-code-outline', kind: 'qr', qrAcquirer: 'tng' },
];

const DEFAULT_METHODS: LocaleMethod[] = [
  { id: 'cash', label: 'Cash', icon: 'cash-outline', kind: 'cash' },
  { id: 'card', label: 'Card', icon: 'card-outline', kind: 'card' },
  { id: 'mobile', label: 'Mobile Pay', icon: 'phone-portrait-outline', kind: 'other' },
  { id: 'qr', label: 'QR Pay', icon: 'qr-code-outline', kind: 'qr', qrAcquirer: 'generic' },
];

/** The method list for an outlet locale (FR-601; 'split' is added by the UI). */
export function paymentMethodsFor(locale: string | null | undefined): LocaleMethod[] {
  const key = (locale ?? '').toLowerCase().replace('-', '_');
  if (key === 'en_sg') return SG_METHODS;
  if (key === 'en_my') return MY_METHODS;
  return DEFAULT_METHODS;
}

// ---------------------------------------------------------------------------
// QR acquirer (FR-601) — the stub behind the interface (ADR-006)
// ---------------------------------------------------------------------------

/**
 * The acquirer seam. A real implementation would return the acquirer's QR
 * image (data URL) for the customer to scan; the STUB returns a reference
 * code + a note so the flow (show → customer pays → record reference) is
 * complete and auditable without any live payment API.
 */
export interface QRPrep {
  /** Stored on the payment row (payment.reference). */
  reference: string;
  /** The QR image to show (null on the stub — UI shows the reference code). */
  imageUrl: string | null;
  note: string;
}

export interface QRAcquirer {
  id: string;
  label: string;
  prepare(amountMinor: number, currency: string): QRPrep;
}

const stubNote =
  'Stub acquirer (ADR-006) — no live acquirer is wired. Show this reference to the customer, collect the payment at the counter, then record it as paid.';

/** The M5 stub: deterministic-shaped reference, no image (real acquirers = v2). */
export const STUB_QR_ACQUIRER: QRAcquirer = {
  id: 'stub',
  label: 'QR (stub)',
  prepare(amountMinor, currency) {
    return {
      reference: `QR-${uuidv4().slice(0, 8).toUpperCase()}`,
      imageUrl: null,
      note: stubNote,
    };
  },
};

const QR_ACQUIRERS: Record<string, QRAcquirer> = {
  paynow: STUB_QR_ACQUIRER,
  tng: STUB_QR_ACQUIRER,
  generic: STUB_QR_ACQUIRER,
};

export function acquirerFor(acquirerId: string | undefined): QRAcquirer | null {
  if (!acquirerId) return null;
  return QR_ACQUIRERS[acquirerId] ?? null;
}

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
