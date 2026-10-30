/**
 * ID generation tests.
 *
 * `uuidv4` — random client op keys (FR-502 idempotency keys).
 * `deterministicId` — the M5 multi-device seed identity: the SAME fixture
 * name must yield the SAME UUID on every device, or two devices' seeded
 * catalogs can never converge (server `product` is UNIQUE (outlet_id, sku)
 * keyed by id, and the seed ledger rows double-count opening stock).
 */

import { deterministicId, uuidv4 } from '../lib/ids';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidv4 (client op keys)', () => {
  it('is a well-formed v4 / variant-10 UUID', () => {
    const id = uuidv4();
    expect(id).toMatch(UUID_RE);
    expect(id.charAt(14)).toBe('4'); // version nibble
    expect('89ab').toContain(id.charAt(19)); // variant nibble
  });

  it('is unique across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(uuidv4());
    expect(seen.size).toBe(200);
  });
});

describe('deterministicId (M5 multi-device seed identity)', () => {
  const name = 'nurledger:seed:v1:product:BAK-CROIS-02';

  it('is stable — the same name yields the same id on every call/device', () => {
    expect(deterministicId(name)).toBe(deterministicId(name));
  });

  it('is a well-formed version-5 / variant-10 UUID', () => {
    const id = deterministicId(name);
    expect(id).toMatch(UUID_RE);
    expect(id.charAt(14)).toBe('5'); // version nibble (name-based)
    expect('89ab').toContain(id.charAt(19)); // variant nibble
  });

  it('pins the cross-device contract (regression vector — verified TS == Python, 66/66)', () => {
    // The BAK-CROIS-02 product id a SECOND device derives from the same
    // fixture. If the derivation ever changes, seeded catalogs stop
    // converging across devices — this test is the canary.
    expect(deterministicId(name)).toBe('c4327804-4f0c-5bcc-8aaa-f841eaefc267');
  });

  it('never collides within the seed id space (products/lots/ledgers/cats)', () => {
    const names = [
      'category:Fresh & Bakery',
      'product:BAK-CROIS-02',
      'product:BAK-SOUR-01',
      'lot:BAK-CROIS-02:BT-2611O',
      'ledger:BAK-CROIS-02',
      'ledger-op:BAK-CROIS-02',
      'cost-layer:BAK-CROIS-02',
    ];
    const ids = names.map((n) => deterministicId(`nurledger:seed:v1:${n}`));
    expect(new Set(ids).size).toBe(names.length);
  });
});
