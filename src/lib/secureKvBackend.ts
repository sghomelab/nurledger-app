/**
 * expo-secure-store backend for createSecureKv. AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
 * readable by a background sync after the first unlock, and never included in
 * iCloud/iTunes backups or restored onto another device (the session is
 * device-bound by design). Android: Keystore-backed; allowBackup is off.
 */
import * as SecureStore from 'expo-secure-store';
import type { SecureBackend } from './secureKv';

const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } as const;

export const expoSecureBackend: SecureBackend = {
  get: (key) => SecureStore.getItemAsync(key, opts),
  set: (key, value) => SecureStore.setItemAsync(key, value, opts),
  del: (key) => SecureStore.deleteItemAsync(key, opts),
};
