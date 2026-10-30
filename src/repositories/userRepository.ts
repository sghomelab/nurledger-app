/**
 * User repository (FR-500 — roles & PIN gates). The active user is the one
 * "at the register": sales record their id (sale.cashier_id) and gated actions
 * check their role. The active user id lives in `settings` (like device_id).
 */

import { getDb } from '../db/database';
import { uuidv4 } from '../lib/ids';
import { createPinHash, isValidPin } from '../lib/pin';
import type { AppUser, UserRole } from '../types';

const ACTIVE_USER_KEY = 'active_user_id';

interface RawUser {
  id: string;
  name: string;
  role: string;
  pin_hash: string | null;
  active: number;
  created_at: number;
}

function toUser(row: RawUser): AppUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role as UserRole,
    pinHash: row.pin_hash,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

/** All active users (owner/manager/cashier), most recently created last. */
export async function listActiveUsers(): Promise<AppUser[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawUser>(
    'SELECT id, name, role, pin_hash, active, created_at FROM app_user WHERE active = 1 ORDER BY created_at ASC',
  );
  return rows.map(toUser);
}

export async function getUser(id: string): Promise<AppUser | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawUser>(
    'SELECT id, name, role, pin_hash, active, created_at FROM app_user WHERE id = ?',
    [id],
  );
  return row ? toUser(row) : null;
}

/**
 * The active user (the one at the register). Falls back to the first active
 * user if the stored id is stale/missing (e.g. user deactivated).
 */
export async function getActiveUser(): Promise<AppUser | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = '${ACTIVE_USER_KEY}'`,
  );
  if (row) {
    const user = await getUser(row.value);
    if (user && user.active) return user;
  }
  const all = await listActiveUsers();
  return all[0] ?? null;
}

export async function setActiveUser(id: string): Promise<void> {
  const db = await getDb();
  const user = await getUser(id);
  if (!user || !user.active) throw new Error('Unknown or inactive user');
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [ACTIVE_USER_KEY, id]);
}

export interface CreateUserInput {
  name: string;
  role: UserRole;
  /** Optional; set for owner/manager (the PIN-gate unlockers). */
  pin?: string | null;
}

/** Create a user. `pin` is hashed (salted SHA-256, src/lib/pin.ts) — never stored raw. */
export async function createUser(input: CreateUserInput): Promise<AppUser> {
  const name = input.name.trim();
  if (!name) throw new Error('User name is required');
  if (input.pin && !isValidPin(input.pin)) throw new Error('PIN must be 4–8 digits');

  const db = await getDb();
  const id = uuidv4();
  await db.runAsync(
    'INSERT INTO app_user (id, name, role, pin_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    [id, name, input.role, input.pin ? createPinHash(input.pin) : null, Date.now()],
  );
  const user = await getUser(id);
  if (!user) throw new Error('User vanished after insert (should be impossible)');
  return user;
}
