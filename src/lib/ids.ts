/**
 * Client-side ID generation. UUIDs are the sync idempotency keys (FR-502),
 * so they must be generated on-device without any network/dependency.
 */

import { sha256Hex } from './sha256';

/** UUID v4 from Math.random (statistically fine for client op keys). */
export function uuidv4(): string {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Deterministic 128-bit ID derived from a stable name (SHA-256 of the name,
 * first 16 bytes, with UUID version-5 / variant-10 bits set).
 *
 * WHY (M5 multi-device catalog convergence): product / lot / ledger UUIDs are
 * the sync idempotency keys (FR-502), so the same fixture entry must produce
 * the SAME id on every device. The first-run seed is shared fixture data —
 * if each install derived random ids, two devices' catalogs for the same
 * SKUs would never converge: the server `product` table is UNIQUE per
 * (outlet_id, sku), so the second device's inserts would raise and the FIFO
 * drain would stall on that op forever. A name-derived id makes both
 * devices' seeded catalogs (and their ledger rows) line up 1:1, so products
 * merge LWW-by-id, ledger rows union by id/op-id, and `stock_view`
 * converges identically on every device.
 *
 * The namespace prefix is part of the name: bump it (`seed:v2:`) to re-derive
 * a whole new id space if the fixture ever changes shape.
 */
export function deterministicId(name: string): string {
  const hex = sha256Hex(name).slice(0, 32);
  const b: number[] = [];
  for (let i = 0; i < 32; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5 (name-based)
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Short readable receipt/PO number, e.g. 'SL-1041'. */
export function displayNumber(prefix: string, seq: number): string {
  return `${prefix}-${seq}`;
}
