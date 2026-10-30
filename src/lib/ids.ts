/**
 * Client-side ID generation. UUIDs are the sync idempotency keys (FR-502),
 * so they must be generated on-device without any network/dependency.
 */

/** UUID v4 from Math.random (statistically fine for client op keys). */
export function uuidv4(): string {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Short readable receipt/PO number, e.g. 'SL-1041'. */
export function displayNumber(prefix: string, seq: number): string {
  return `${prefix}-${seq}`;
}
