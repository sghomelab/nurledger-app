/**
 * Shift & users hooks (M4) — thin async wrappers over the shift/user
 * repositories with focus-refetch (same pattern as useAppData).
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  getActiveUser,
  getUser,
  listActiveUsers,
  setActiveUser,
  createUser,
} from '../repositories/userRepository';
import {
  addCashMove as repoAddCashMove,
  closeShift as repoCloseShift,
  getShiftDrawerSnapshot,
  listClosedShifts,
  openShift as repoOpenShift,
  getOpenShift,
  type DrawerSnapshot,
  type OpenShiftInput,
  type Shift,
} from '../repositories/shiftRepository';
import type { CashMoveType, XReport } from '../lib/shift';
import { buildXReport } from '../lib/shift';
import type { AppUser, UserRole } from '../types';

// ---- shared active user (module-level, like useAppData's low-stock count) ---
// The active user is app-wide state (the person "at the register"); sharing one
// store instance means switching on the Shift tab immediately re-gates the
// register, Insights, etc. without each tab round-tripping the DB.
let sharedActive: AppUser | null = null;
const activeListeners = new Set<() => void>();
function commitActive(user: AppUser | null) {
  sharedActive = user;
  activeListeners.forEach((l) => l());
}
function subscribeActive(l: () => void) {
  activeListeners.add(l);
  return () => {
    activeListeners.delete(l);
  };
}

/** The app-wide active user (reactive). Loaded once on first subscriber. */
export function useActiveUser() {
  const active = useSyncExternalStore(subscribeActive, () => sharedActive);
  const reload = useCallback(async () => {
    commitActive(await getActiveUser());
  }, []);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  return { active, reload };
}

export interface UseUsers {
  users: AppUser[] | null;
  active: AppUser | null;
  reload: () => Promise<void>;
  switchUser: (id: string) => Promise<void>;
  addUser: (name: string, role: UserRole, pin?: string | null) => Promise<AppUser>;
}

export function useUsers(): UseUsers {
  const { active } = useActiveUser();
  const [users, setUsers] = useState<AppUser[] | null>(null);

  const reload = useCallback(async () => {
    const list = await listActiveUsers();
    setUsers(list);
    commitActive(await getActiveUser());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const switchUser = useCallback(
    async (id: string) => {
      await setActiveUser(id);
      await reload();
    },
    [reload],
  );

  const addUser = useCallback(
    async (name: string, role: UserRole, pin?: string | null) => {
      const created = await createUser({ name, role, pin });
      await reload();
      return created;
    },
    [reload],
  );

  return { users, active, reload, switchUser, addUser };
}

export interface UseShift {
  open: Shift | null;
  snapshot: DrawerSnapshot | null;
  history: Shift[] | null;
  loaded: boolean;
  reload: () => Promise<void>;
  openShift: (input: OpenShiftInput) => Promise<Shift>;
  addCashMove: (shiftId: string, type: CashMoveType, amountMinor: number, reason: string) => Promise<void>;
  closeShift: (shiftId: string, countedMinor: number, notes: string | null) => Promise<Shift>;
  /** FR-203: interim X-report for the open shift. */
  xReport: () => Promise<XReport | null>;
}

export function useShift(): UseShift {
  const [open, setOpen] = useState<Shift | null>(null);
  const [snapshot, setSnapshot] = useState<DrawerSnapshot | null>(null);
  const [history, setHistory] = useState<Shift[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const current = await getOpenShift();
    setOpen(current);
    setSnapshot(current ? await getShiftDrawerSnapshot(current.id) : null);
    setHistory(await listClosedShifts());
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openShift = useCallback(
    async (input: OpenShiftInput) => {
      const shift = await repoOpenShift(input);
      await reload();
      return shift;
    },
    [reload],
  );

  const addCashMove = useCallback(
    async (shiftId: string, type: CashMoveType, amountMinor: number, reason: string) => {
      await repoAddCashMove(shiftId, type, amountMinor, reason);
      await reload();
    },
    [reload],
  );

  const closeShift = useCallback(
    async (shiftId: string, countedMinor: number, notes: string | null) => {
      const closed = await repoCloseShift({ shiftId, countedMinor, notes });
      await reload();
      return closed;
    },
    [reload],
  );

  const xReport = useCallback(async () => {
    const current = await getOpenShift();
    if (!current) return null;
    const snap = await getShiftDrawerSnapshot(current.id);
    if (!snap) return null;
    return buildXReport(current.id, current.cashierName, current.openedAt, snap.salesByMethod, snap.totals, Date.now());
  }, []);

  return { open, snapshot, history, loaded, reload, openShift, addCashMove, closeShift, xReport };
}

/** One-off lookup (e.g. resolving a cashier name for a report). */
export async function resolveUserName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const u = await getUser(id);
  return u?.name ?? null;
}
