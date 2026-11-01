/**
 * First-run choice + factory reset (src/db/firstRun.ts).
 *
 * The db is a faithful in-memory double: it emulates exactly the statements
 * the seed/first-run code issues (settings key/value, COUNT guards, outlet id
 * lookup, the sqlite_master table list, DELETEs, FK pragmas) and tracks
 * state, so the FLAG CONTRACT is what's under test:
 *   - pending until a choice is recorded (seeded_v1)
 *   - 'empty' records the decision WITHOUT loading the fixture
 *   - 'sample' loads the fixture and sets the flag
 *   - resetAllData wipes everything, re-asserts infrastructure, re-arms the
 *     pending state, and notifies subscribers
 *
 * expo-sqlite is mocked — these tests run in plain Node (no native driver).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  completeFirstRun,
  isFirstRunPending,
  onFirstRunStateChange,
  resetAllData,
} from '../db/firstRun';
import { ensureOutlet } from '../db/seed';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

// A representative slice of the real schema (schema.ts) — enough to verify
// the wipe touches every table the code can see.
const TABLES = [
  'schema_meta',
  'outlet',
  'settings',
  'app_user',
  'category',
  'product',
  'lot',
  'stock_ledger',
  'cost_layer',
  'sale',
  'shift',
  'outbox',
];

interface FixtureInsert {
  table: 'category' | 'product' | 'lot' | 'stock_ledger' | 'cost_layer';
  sql: string;
  params: unknown[];
}

/** In-memory double for the statements first-run/seed code issues. */
function makeDb() {
  const settings = new Map<string, string>([['device_id', 'dev-1']]);
  const state = {
    outlets: 1, // bootstrap already ran ensureOutlet (choice pending)
    users: 2, // bootstrap already ran ensureDefaultUsers
    rows: Object.fromEntries(TABLES.map((t) => [t, 1])) as Record<string, number>,
    fixtureInserts: [] as FixtureInsert[],
    pragmas: [] as string[],
    outletInserts: 0,
    userInserts: 0,
  };

  const db = {
    state,
    settings,

    async getFirstAsync(sql: string) {
      const keyMatch = /^SELECT value FROM settings WHERE key = '(.+?)'/.exec(sql);
      if (keyMatch) {
        const v = settings.get(keyMatch[1] ?? '');
        return v === undefined ? null : { value: v };
      }
      if (sql === 'SELECT COUNT(*) AS n FROM outlet') return { n: state.outlets };
      if (sql === 'SELECT COUNT(*) AS n FROM app_user') return { n: state.users };
      if (sql === 'SELECT id FROM outlet LIMIT 1') return state.outlets > 0 ? { id: 'outlet-1' } : null;
      throw new Error(`fake db: unhandled getFirstAsync: ${sql}`);
    },

    async getAllAsync(sql: string) {
      if (sql.startsWith("SELECT name FROM sqlite_master")) {
        return TABLES.map((name) => ({ name }));
      }
      throw new Error(`fake db: unhandled getAllAsync: ${sql}`);
    },

    async runAsync(sql: string, params: unknown[] = []) {
      const trimmed = sql.trim();
      if (trimmed === 'PRAGMA foreign_keys = OFF;') {
        state.pragmas.push('OFF');
        return;
      }
      if (trimmed === 'PRAGMA foreign_keys = ON;') {
        state.pragmas.push('ON');
        return;
      }
      const del = /^DELETE FROM "([^"]+)";?$/.exec(trimmed);
      if (del) {
        const name = del[1] ?? '';
        state.rows[name] = 0;
        if (name === 'settings') settings.clear(); // the key/value store IS the settings table
        return;
      }
      if (/^INSERT INTO settings \(key, value\) VALUES/.test(trimmed) ||
          /^INSERT OR REPLACE INTO settings \(key, value\) VALUES/.test(trimmed)) {
        if (trimmed.includes("VALUES ('seeded_v1', '1')")) settings.set('seeded_v1', '1');
        else if (trimmed.includes("VALUES ('device_id', ?)")) settings.set('device_id', String(params[0]));
        else if (trimmed.includes("VALUES ('active_user_id', ?)")) settings.set('active_user_id', String(params[0]));
        else settings.set(String(params[0]), String(params[1]));
        return;
      }
      if (/^INSERT INTO outlet \(id, name/.test(trimmed)) {
        state.outletInserts++;
        state.outlets++;
        return;
      }
      if (/^INSERT INTO app_user \(id, name, role/.test(trimmed)) {
        state.userInserts++;
        state.users++;
        return;
      }
      // NOTE: product/stock_ledger inserts are multi-line SQL in seed.ts —
      // match on the word boundary, not a trailing space.
      if (/^INSERT INTO (category|product|lot|stock_ledger|cost_layer)\b/.test(trimmed)) {
        const table = trimmed.match(/^INSERT INTO (\w+)/)![1] as FixtureInsert['table'];
        state.fixtureInserts.push({ table, sql: trimmed, params });
        return;
      }
      throw new Error(`fake db: unhandled runAsync: ${trimmed}`);
    },

    async withTransactionAsync(fn: () => Promise<void>) {
      await fn();
    },
  };
  return db;
}

const asDb = (db: ReturnType<typeof makeDb>) => db as unknown as SQLiteDatabase;

describe('isFirstRunPending', () => {
  it('is pending on a fresh bootstrap (no seeded_v1 flag)', async () => {
    const db = makeDb();
    expect(await isFirstRunPending(asDb(db))).toBe(true);
  });

  it('is not pending once the flag exists', async () => {
    const db = makeDb();
    db.settings.set('seeded_v1', '1');
    expect(await isFirstRunPending(asDb(db))).toBe(false);
  });
});

describe('completeFirstRun — "start empty"', () => {
  it('records the decision WITHOUT loading any fixture data', async () => {
    const db = makeDb();
    await completeFirstRun(asDb(db), 'empty');

    expect(db.settings.get('seeded_v1')).toBe('1');
    expect(await isFirstRunPending(asDb(db))).toBe(false);
    expect(db.state.fixtureInserts).toHaveLength(0); // no categories/products/ledger rows
    expect(db.state.outletInserts).toBe(0); // no duplicate outlet
  });

  it('is idempotent — a second call changes nothing', async () => {
    const db = makeDb();
    await completeFirstRun(asDb(db), 'empty');
    const before = db.state;
    await completeFirstRun(asDb(db), 'sample'); // re-entry / double-tap
    expect(db.state.fixtureInserts).toHaveLength(0); // still no fixture
    expect(db.state.outletInserts).toBe(before.outletInserts);
    expect(db.state.userInserts).toBe(before.userInserts);
  });
});

describe('completeFirstRun — "load sample data"', () => {
  it('loads the full fixture (6 categories + 11 products + lots + ledger + layers)', async () => {
    const db = makeDb();
    await completeFirstRun(asDb(db), 'sample');

    expect(db.settings.get('seeded_v1')).toBe('1');
    expect(await isFirstRunPending(asDb(db))).toBe(false);
    const count = (table: FixtureInsert['table']) =>
      db.state.fixtureInserts.filter((i) => i.table === table).length;
    expect(count('category')).toBe(6);
    expect(count('product')).toBe(11);
    expect(count('lot')).toBe(11);
    expect(count('stock_ledger')).toBe(11);
    expect(count('cost_layer')).toBe(11);
    // product/lot/ledger/layer rows reference the EXISTING outlet
    // (ensureOutlet's), not a new one. (category has no outlet column.)
    for (const ins of db.state.fixtureInserts.filter((i) => i.table !== 'category')) {
      expect(ins.params).toContain('outlet-1');
    }
    expect(db.state.outletInserts).toBe(0);
  });

  it('refuses to load without an outlet row (FK safety)', async () => {
    const db = makeDb();
    db.state.outlets = 0; // simulate a missing outlet
    await completeFirstRun(asDb(db), 'sample');
    expect(db.state.fixtureInserts).toHaveLength(0);
    // The flag stays unset so the owner gets another chance (not a silent skip).
    expect(db.settings.get('seeded_v1')).toBeUndefined();
  });
});

describe('onFirstRunStateChange', () => {
  it('notifies subscribers when a choice completes', async () => {
    const db = makeDb();
    let calls = 0;
    const unsub = onFirstRunStateChange(() => {
      calls++;
    });
    await completeFirstRun(asDb(db), 'empty');
    expect(calls).toBe(1);
    unsub();
    await resetAllData(asDb(db));
    expect(calls).toBe(1); // unsubscribed — no further calls
  });
});

describe('resetAllData (factory reset)', () => {
  it('wipes every table, re-asserts infrastructure, and re-arms the pending state', async () => {
    const db = makeDb();
    // Start from a completed 'sample' install with real data in it.
    await completeFirstRun(asDb(db), 'sample');
    expect(await isFirstRunPending(asDb(db))).toBe(false);

    const notified = { n: 0 };
    const unsub = onFirstRunStateChange(() => {
      notified.n++;
    });
    await resetAllData(asDb(db));
    unsub();

    // 1. Every row in every table is gone.
    for (const t of TABLES) {
      expect(db.state.rows[t]).toBe(0);
    }
    // 2. The seed flag is wiped → the first-run choice is pending again.
    expect(db.settings.get('seeded_v1')).toBeUndefined();
    expect(await isFirstRunPending(asDb(db))).toBe(true);
    // 3. Required infrastructure is re-asserted (coherent the moment the
    //    owner re-chooses): outlet + default users + device id.
    expect(db.state.outlets).toBe(1);
    expect(db.state.users).toBe(2);
    expect(db.settings.has('device_id')).toBe(true);
    // 4. FKs were suspended around the wipe and restored.
    expect(db.state.pragmas).toEqual(['OFF', 'ON']);
    // 5. The root layout subscription fired (it re-shows the choice screen).
    expect(notified.n).toBe(1);
  });
});

describe('ensureOutlet', () => {
  it('creates the outlet when missing and is a no-op when present', async () => {
    const db = makeDb();
    expect(db.state.outlets).toBe(1);
    await ensureOutlet(asDb(db));
    expect(db.state.outlets).toBe(1); // already there — no duplicate

    const empty = makeDb();
    empty.state.outlets = 0;
    await ensureOutlet(asDb(empty));
    expect(empty.state.outlets).toBe(1);
  });
});
