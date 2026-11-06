/** In-memory expo-secure-store for jest (native module is unavailable in node). */
const store = new Map<string, string>();
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';
export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? store.get(key)! : null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
/** test helper */
export function __reset(): void {
  store.clear();
}
export function __dump(): Record<string, string> {
  return Object.fromEntries(store);
}
