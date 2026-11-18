/**
 * useSecurity runtime — the timeout state machine (idle → lock → unlock as
 * A / B / Owner) with attribution. React is NOT rendered here: the module
 * exports the plain functions the hook wraps, so we drive them directly.
 * @jest-environment node
 */
import {
  shouldAutoLock,
  checkIdle,
  lockNow,
  reloadSecurity,
  attemptUnlock,
  __setLastActivityForTests,
  __getSecurityStateForTests,
  __resetSecurityForTests,
} from '../hooks/useSecurity';
import { createPinHash } from '../lib/pin';
import type { AppUser } from '../types';

// ── Mock the three repositories the hook talks to ────────────────────────────
const mockGetActiveUser = jest.fn();
const mockListActiveUsers = jest.fn();
const mockSetActiveUser = jest.fn();
const mockAppend = jest.fn();
const mockGetStorePinHash = jest.fn();
const mockHasStorePin = jest.fn();
const mockGetAutoLock = jest.fn();

jest.mock('../repositories/userRepository', () => ({
  getActiveUser: (...a: any[]) => mockGetActiveUser(...a),
  listActiveUsers: (...a: any[]) => mockListActiveUsers(...a),
  setActiveUser: (...a: any[]) => mockSetActiveUser(...a),
}));
jest.mock('../repositories/securityRepository', () => ({
  appendSecurityEvent: (...a: any[]) => mockAppend(...a),
  getStorePinHash: (...a: any[]) => mockGetStorePinHash(...a),
  hasStorePin: (...a: any[]) => mockHasStorePin(...a),
}));
jest.mock('../repositories/uiSettingsRepository', () => ({
  getAutoLockMinutes: (...a: any[]) => mockGetAutoLock(...a),
  AUTO_LOCK_DEFAULT: 5,
}));

const ANN: AppUser = { id: 'a', name: 'Ann', role: 'cashier', pinHash: createPinHash('1111'), active: true, createdAt: 1 };
const BOO: AppUser = { id: 'b', name: 'Boo', role: 'cashier', pinHash: createPinHash('2222'), active: true, createdAt: 1 };
const OWNER: AppUser = { id: 'o', name: 'Owner', role: 'owner', pinHash: createPinHash('9999'), active: true, createdAt: 1 };
/** A user with NO PIN (the soft-lock precondition). */
const JUN: AppUser = { id: 'j', name: 'Jun', role: 'cashier', pinHash: null, active: true, createdAt: 1 };
const STORE_HASH = createPinHash('7777');
const USERS: AppUser[] = [ANN, BOO, OWNER];

const NOW = 1_700_000_000_000;
const last = () => mockAppend.mock.calls[mockAppend.mock.calls.length - 1]?.[0];

beforeEach(() => {
  jest.clearAllMocks();
  __resetSecurityForTests();
  __setLastActivityForTests(NOW);
  mockGetActiveUser.mockResolvedValue(ANN);
  mockListActiveUsers.mockResolvedValue(USERS);
  mockSetActiveUser.mockResolvedValue(undefined);
  mockAppend.mockResolvedValue({});
  mockGetStorePinHash.mockResolvedValue(STORE_HASH);
  mockHasStorePin.mockResolvedValue(true);
  mockGetAutoLock.mockResolvedValue(5);
});

describe('shouldAutoLock (pure idle decision)', () => {
  it('Never (0) never locks regardless of idle span', () => {
    expect(shouldAutoLock(NOW + 10 * 3_600_000, NOW, 0)).toBe(false);
  });
  it('stays unlocked before the timeout', () => {
    expect(shouldAutoLock(NOW + (5 * 60_000 - 1), NOW, 5)).toBe(false);
  });
  it('locks at exactly the timeout', () => {
    expect(shouldAutoLock(NOW + 5 * 60_000, NOW, 5)).toBe(true);
  });
  it('locks after the timeout', () => {
    expect(shouldAutoLock(NOW + 6 * 60_000, NOW, 5)).toBe(true);
  });
});

describe('idle watchdog → lock (design #6/#7)', () => {
  it('checkIdle locks once the idle span reaches the configured timeout', async () => {
    await reloadSecurity();
    expect(__getSecurityStateForTests().autoLockMinutes).toBe(5);
    __setLastActivityForTests(NOW);
    expect(__getSecurityStateForTests().locked).toBe(false);
    // Simulate 6 minutes of idle (config is 5).
    __setLastActivityForTests(NOW - 0);
    // We can't move Date.now, so backdate the clock past the timeout.
    __setLastActivityForTests(NOW - 6 * 60_000);
    checkIdle();
    await Promise.resolve(); // let the async lockNow settle
    expect(__getSecurityStateForTests().locked).toBe(true);
    expect(__getSecurityStateForTests().lockReason).toBe('idle');
    // Logged as an auto_lock event attributed to the active user.
    expect(last()).toMatchObject({ user_id: 'a', event_type: 'auto_lock', method: 'system', detail: 'idle' });
  });

  it('touch() resets the clock so a recent interaction does NOT lock', async () => {
    await reloadSecurity();
    __setLastActivityForTests(NOW - 6 * 60_000); // would be past timeout
    // A fresh interaction right before the tick:
    __setLastActivityForTests(Date.now());
    checkIdle();
    await Promise.resolve();
    expect(__getSecurityStateForTests().locked).toBe(false);
  });

  it('Never (0 min) never auto-locks even after a long idle', async () => {
    mockGetAutoLock.mockResolvedValue(0);
    await reloadSecurity();
    __setLastActivityForTests(NOW - 10 * 3_600_000); // 10h idle
    checkIdle();
    await Promise.resolve();
    expect(__getSecurityStateForTests().locked).toBe(false);
  });

  it('a manual lock is logged with detail "manual"', async () => {
    await lockNow('manual');
    await Promise.resolve();
    expect(__getSecurityStateForTests().locked).toBe(true);
    expect(__getSecurityStateForTests().lockReason).toBe('manual');
    expect(last()).toMatchObject({ event_type: 'auto_lock', detail: 'manual' });
  });

  it('locking twice does not double-log', async () => {
    await lockNow('manual');
    await lockNow('manual');
    await Promise.resolve();
    const lockEvents = mockAppend.mock.calls.filter((c: any[]) => c[0].event_type === 'auto_lock');
    expect(lockEvents).toHaveLength(1);
  });
});

describe('unlock flow — proof of identity (design §5)', () => {
  it('the locked user\'s own PIN resumes: no user switch, one unlock event', async () => {
    await lockNow('idle');
    mockGetActiveUser.mockResolvedValue(ANN); // register was running as Ann
    const res = await attemptUnlock('1111');
    expect(res).toMatchObject({ kind: 'resume', user: expect.objectContaining({ id: 'a' }) });
    expect(mockSetActiveUser).not.toHaveBeenCalled(); // no identity change
    expect(__getSecurityStateForTests().locked).toBe(false);
    const unlockEvents = mockAppend.mock.calls.filter((c: any[]) => c[0].event_type === 'unlock');
    expect(unlockEvents).toHaveLength(1);
    expect(unlockEvents[0]![0]).toMatchObject({ user_id: 'a', method: 'pin', from_user_id: null });
  });

  it('another user\'s PIN transfers the register: setActiveUser + unlock AND user_switch', async () => {
    await lockNow('idle');
    mockGetActiveUser.mockResolvedValue(ANN); // locked as Ann
    const res = await attemptUnlock('2222'); // Boo's PIN
    expect(res).toMatchObject({ kind: 'switch' });
    expect(mockSetActiveUser).toHaveBeenCalledWith('b');
    const types = mockAppend.mock.calls.map((c: any[]) => c[0].event_type);
    expect(types).toContain('unlock');
    expect(types).toContain('user_switch');
    const sw = mockAppend.mock.calls.find((c: any[]) => c[0].event_type === 'user_switch')![0];
    expect(sw).toMatchObject({ user_id: 'b', from_user_id: 'a', to_user_id: 'b', method: 'pin' });
  });

  it('the Store PIN runs the register as the OWNER (attribution rule)', async () => {
    await lockNow('idle');
    mockGetActiveUser.mockResolvedValue(BOO); // locked as Boo
    const res = await attemptUnlock('7777'); // Store PIN
    expect(res).toMatchObject({ kind: 'store_pin', user: expect.objectContaining({ id: 'o' }) });
    expect(mockSetActiveUser).toHaveBeenCalledWith('o');
    const unlock = mockAppend.mock.calls.find((c: any[]) => c[0].event_type === 'unlock')![0];
    expect(unlock).toMatchObject({ user_id: 'o', method: 'store_pin', from_user_id: 'b', to_user_id: 'o' });
  });

  it('a wrong PIN keeps the lock up and logs nothing', async () => {
    await lockNow('idle');
    const before = mockAppend.mock.calls.length;
    const res = await attemptUnlock('0000');
    expect(res).toBeNull();
    expect(__getSecurityStateForTests().locked).toBe(true);
    expect(mockAppend.mock.calls.length).toBe(before);
  });
});

describe('reloadSecurity loads config', () => {
  it('reads store-PIN presence and the auto-lock timeout', async () => {
    mockHasStorePin.mockResolvedValue(true);
    mockGetAutoLock.mockResolvedValue(15);
    await reloadSecurity();
    const s = __getSecurityStateForTests();
    expect(s.storePinSet).toBe(true);
    expect(s.autoLockMinutes).toBe(15);
    expect(s.loaded).toBe(true);
  });
});

describe('soft-lock guard (design §2: "No PIN set = open access")', () => {
  /** A register where NO PIN could open a lock: no user PIN, no Store PIN. */
  function noPinsAnywhere() {
    mockListActiveUsers.mockResolvedValue([JUN]);
    mockHasStorePin.mockResolvedValue(false);
  }

  it('checkIdle NEVER locks when no unlockable PIN exists', async () => {
    noPinsAnywhere();
    await reloadSecurity();
    expect(__getSecurityStateForTests().anyUnlockable).toBe(false);
    __setLastActivityForTests(NOW - 6 * 60_000); // past the 5-min timeout
    checkIdle();
    await Promise.resolve();
    expect(__getSecurityStateForTests().locked).toBe(false);
    expect(mockAppend).not.toHaveBeenCalled(); // no auto_lock event either
  });

  it('a manual lock is refused when no unlockable PIN exists', async () => {
    noPinsAnywhere();
    await reloadSecurity();
    await lockNow('manual');
    expect(__getSecurityStateForTests().locked).toBe(false);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('a user PIN alone is enough to arm the watchdog', async () => {
    mockHasStorePin.mockResolvedValue(false); // no Store PIN
    await reloadSecurity(); // USERS includes ANN with a PIN
    expect(__getSecurityStateForTests().anyUnlockable).toBe(true);
    __setLastActivityForTests(NOW - 6 * 60_000);
    checkIdle();
    await Promise.resolve();
    expect(__getSecurityStateForTests().locked).toBe(true);
  });

  it('setting a Store PIN re-arms auto-lock (anyUnlockable flips)', async () => {
    noPinsAnywhere();
    await reloadSecurity();
    expect(__getSecurityStateForTests().anyUnlockable).toBe(false);
    // The owner sets the Store PIN → SecuritySettings calls reloadSecurity().
    mockHasStorePin.mockResolvedValue(true);
    await reloadSecurity();
    expect(__getSecurityStateForTests().anyUnlockable).toBe(true);
    __setLastActivityForTests(NOW - 6 * 60_000);
    checkIdle();
    await Promise.resolve();
    expect(__getSecurityStateForTests().locked).toBe(true);
  });
});
