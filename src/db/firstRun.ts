/**
 * First-run choice + full data reset.
 *
 * A brand-new install (schema exists, no `seeded_v1` flag) must not silently
 * pick its own starting data — the owner chooses on a first-run screen:
 *   'sample' → load the 11-product prototype fixture (runSeed)
 *   'empty'  → start with zero products/stock/sales (flag recorded, so the
 *              seed never runs)
 *
 * Flag contract (settings table):
 *   `seeded_v1` = '1'              → first run completed (fixture loaded OR
 *                                    the owner explicitly chose empty — both
 *                                    mean "decision made, never prompt again")
 *   `seeded_v1` absent             → decision pending → first-run screen
 *
 * Existing installs (seeded by pre-choice builds) already carry the flag and
 * never see the screen.
 *
 * `resetAllData` is the factory reset behind Settings → Danger zone: it wipes
 * every row, re-asserts the required infrastructure (outlet, default users,
 * device id) and notifies the root layout to re-show the first-run choice.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { isSeeded, runSeed, ensureOutlet, ensureDefaultUsers } from './seed';
import { ensureDeviceId } from './database';

export type FirstRunMode = 'sample' | 'empty';

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to first-run state changes (fired by completeFirstRun and
 * resetAllData). The root layout uses this to re-evaluate its gate.
 * Returns an unsubscribe function.
 */
export function onFirstRunStateChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** True while the owner's first-run choice is still pending. */
export function isFirstRunPending(db: SQLiteDatabase): Promise<boolean> {
  return isSeeded(db).then((s) => !s);
}

/**
 * Record the owner's first-run choice. 'sample' loads the fixture (which sets
 * the flag internally); 'empty' just marks the decision. Idempotent — a
 * double-tap or a re-entry after the flag exists is a no-op.
 */
export async function completeFirstRun(db: SQLiteDatabase, mode: FirstRunMode): Promise<void> {
  if (await isSeeded(db)) return;
  if (mode === 'sample') {
    await runSeed(db);
  } else {
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_v1', '1')");
    // The 'empty' path never ran the seed, so assert the user seed here too
    // (idempotent — bootstrap already ran it; this keeps runSeed the ONLY
    // other place users get created).
    await ensureDefaultUsers(db);
  }
  notify();
}

/**
 * Factory reset: delete every row in every table, then re-assert the required
 * infrastructure (outlet + default users + device id) so the app is coherent
 * the moment the first-run choice is made again. The wiped `seeded_v1` flag
 * is what re-triggers the first-run screen (via the state-change notify).
 */
export async function resetAllData(db: SQLiteDatabase): Promise<void> {
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  // PRAGMA foreign_keys is a no-op mid-transaction → toggle it outside.
  await db.runAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      for (const t of tables) {
        // Double-quoted identifier: table names come from sqlite_master, none
        // contain quotes; this is the standard SQLite wipe shape.
        await db.runAsync(`DELETE FROM "${t.name}";`);
      }
    });
  } finally {
    await db.runAsync('PRAGMA foreign_keys = ON;');
  }

  await ensureOutlet(db);
  await ensureDefaultUsers(db);
  await ensureDeviceId(db);

  notify();
}
