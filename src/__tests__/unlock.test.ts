/**
 * Lock-screen unlock resolution (issue #26 design §5) — the "unlock as A / B /
 * Owner" state machine, PURE.
 * @jest-environment node
 */
import { resolveUnlock } from '../lib/unlock';
import { createPinHash } from '../lib/pin';
import type { AppUser } from '../types';

const u = (over: Partial<AppUser> & { id: string; name: string; role: AppUser['role'] }): AppUser => ({
  pinHash: null,
  active: true,
  createdAt: 1,
  ...over,
});

const A = u({ id: 'a', name: 'Ann', role: 'cashier', pinHash: createPinHash('1111') });
const B = u({ id: 'b', name: 'Boo', role: 'cashier', pinHash: createPinHash('2222') });
const OWNER = u({ id: 'o', name: 'Owner', role: 'owner', pinHash: createPinHash('9999') });
const STORE_HASH = createPinHash('7777'); // the Store PIN (not a user PIN)
const [ann, boo, owner] = [A, B, OWNER];
const ALL = [ann, boo, owner];

describe('resolveUnlock', () => {
  it('the locked user\'s own PIN resumes (no switch)', () => {
    const r = resolveUnlock('1111', ann, ALL, STORE_HASH);
    expect(r).toMatchObject({ kind: 'resume', user: expect.objectContaining({ id: 'a' }), method: 'pin' });
  });

  it('another user\'s PIN transfers the register (from/to logged)', () => {
    const r = resolveUnlock('2222', ann, ALL, STORE_HASH);
    expect(r).toMatchObject({ kind: 'switch', from: expect.objectContaining({ id: 'a' }), to: expect.objectContaining({ id: 'b' }), method: 'pin' });
  });

  it('the Store PIN always resolves to the Owner, even when a different cashier was locked', () => {
    const r = resolveUnlock('7777', boo, ALL, STORE_HASH);
    expect(r).toMatchObject({ kind: 'store_pin', user: expect.objectContaining({ id: 'o', role: 'owner' }), method: 'store_pin' });
  });

  it('a PIN with no match returns null (stay locked)', () => {
    expect(resolveUnlock('0000', ann, ALL, STORE_HASH)).toBeNull();
  });

  it('a user with no PIN set cannot unlock (nothing to match)', () => {
    const open = u({ id: 'c', name: 'Cass', role: 'cashier', pinHash: null });
    expect(resolveUnlock('3333', open, [open, owner], STORE_HASH)).toBeNull();
  });

  it('user PINs win over the Store PIN (a Store PIN that collides with a cashier PIN is that cashier)', () => {
    // Give the owner a user PIN identical to the Store PIN value.
    const ownerSame = u({ id: 'o', name: 'Owner', role: 'owner', pinHash: createPinHash('7777') });
    const r = resolveUnlock('7777', ann, [ann, ownerSame], createPinHash('7777'));
    expect(r).toMatchObject({ kind: 'switch', to: expect.objectContaining({ id: 'o' }) });
  });

  it('no active user (edge) + a user PIN → resume as that user', () => {
    const r = resolveUnlock('1111', null, ALL, STORE_HASH);
    expect(r).toMatchObject({ kind: 'resume', user: expect.objectContaining({ id: 'a' }) });
  });

  it('Store PIN with NO owner row cannot resolve', () => {
    expect(resolveUnlock('7777', ann, [ann, boo], STORE_HASH)).toBeNull();
  });
});
