/**
 * Role gate matrix (FR-500): who can act directly, who can unlock with a PIN.
 */

import { canUnlock, GATE_ACTION_LABELS, roleCanAct, roleRank, type GateAction } from '../lib/roles';
import type { AppUser } from '../types';

function user(role: AppUser['role'], pinHash: string | null = null): AppUser {
  return { id: 'u-' + role, name: role, role, pinHash, active: true, createdAt: 0 };
}

const ALL_ACTIONS: GateAction[] = ['discount', 'price_override', 'stock_adjust', 'close_shift', 'store_settings'];

describe('roleCanAct', () => {
  it('owner and manager pass every M4 gate directly', () => {
    for (const action of ALL_ACTIONS) {
      expect(roleCanAct('owner', action)).toBe(true);
      expect(roleCanAct('manager', action)).toBe(true);
    }
  });

  it('cashier passes nothing (sell + own shift are not gated actions)', () => {
    for (const action of ALL_ACTIONS) {
      expect(roleCanAct('cashier', action)).toBe(false);
    }
  });
});

describe('roleRank', () => {
  it('orders owner > manager > cashier', () => {
    expect(roleRank('owner')).toBeGreaterThan(roleRank('manager'));
    expect(roleRank('manager')).toBeGreaterThan(roleRank('cashier'));
  });
});

describe('canUnlock', () => {
  it('owner/manager WITH a pin can unlock gates', () => {
    expect(canUnlock(user('owner', 's:0123456789abcdef:abcdef'))).toBe(true);
    expect(canUnlock(user('manager', 's:0123456789abcdef:abcdef'))).toBe(true);
  });

  it('owner/manager WITHOUT a pin cannot unlock (no PIN set)', () => {
    expect(canUnlock(user('owner', null))).toBe(false);
    expect(canUnlock(user('manager', null))).toBe(false);
  });

  it('cashier can never unlock', () => {
    expect(canUnlock(user('cashier', 's:0123456789abcdef:abcdef'))).toBe(false);
  });
});

describe('GATE_ACTION_LABELS', () => {
  it('covers every gated action with a human label', () => {
    for (const action of ALL_ACTIONS) {
      expect(GATE_ACTION_LABELS[action]).toBeTruthy();
    }
  });
});

describe('PIN hardening: switching up / adding / changing PIN', () => {
  const owner = user('owner', 's:0123456789abcdef:abcdef');
  const manager = user('manager', 's:0123456789abcdef:abcdef');
  const cashier = user('cashier');
  const { switchRankNeeded, addUserRankNeeded, changePinRankNeeded } = require('../lib/roles');

  it('cashier cannot switch to manager/owner without a PIN of that rank', () => {
    expect(switchRankNeeded(cashier, manager)).toBe(1);
    expect(switchRankNeeded(cashier, owner)).toBe(2);
  });
  it('manager needs the owner PIN to become owner, but not to go to manager/cashier', () => {
    expect(switchRankNeeded(manager, owner)).toBe(2);
    expect(switchRankNeeded(manager, manager)).toBe(0);
    expect(switchRankNeeded(manager, cashier)).toBe(0);
  });
  it('owner switches freely; no active user is treated as cashier', () => {
    expect(switchRankNeeded(owner, manager)).toBe(0);
    expect(switchRankNeeded(owner, cashier)).toBe(0);
    expect(switchRankNeeded(null, owner)).toBe(2);
  });
  it('cannot mint a role above your own without a PIN of that rank', () => {
    expect(addUserRankNeeded(cashier, 'cashier')).toBe(0);
    expect(addUserRankNeeded(cashier, 'manager')).toBe(1);
    expect(addUserRankNeeded(cashier, 'owner')).toBe(2);
    expect(addUserRankNeeded(manager, 'owner')).toBe(2);
    expect(addUserRankNeeded(owner, 'owner')).toBe(0);
  });
  it('changing a PIN always needs an unlocker; owner PIN only for the owner', () => {
    expect(changePinRankNeeded(cashier)).toBe(1);
    expect(changePinRankNeeded(manager)).toBe(1);
    expect(changePinRankNeeded(owner)).toBe(2);
  });
});
