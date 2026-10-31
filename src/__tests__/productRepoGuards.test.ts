/**
 * CR-12 / CR-13 — structural guards for the product repository.
 *
 * Jest runs in a node environment with no SQLite, so the transaction
 * boundaries are pinned at the source level (same guard style as
 * cloudSchema.test.ts for CR-02):
 *  - createProduct / updateProduct / deactivateProduct must perform their
 *    row write AND the outbox enqueue INSIDE one `db.withTransactionAsync`
 *    block — a crash between the two must be impossible (CR-12);
 *  - importProducts must no longer release the SKU claim on match
 *    (the `bySku.delete` that let a duplicate row in one CSV fall through
 *    to the insert branch and crash the whole import — CR-13).
 */

// The tsconfig pins "types": ["jest"] (no node types), but jest itself runs
// in a CJS node context — declare the tiny surface this source-level guard
// needs.
declare const __dirname: string;
declare const require: (id: string) => any;

const { readFileSync } = require('fs');
const { join } = require('path');

const src = readFileSync(join(__dirname, '..', 'repositories', 'productRepository.ts'), 'utf8');

/** The source of one exported function (up to the next top-level `export`). */
function functionSource(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const next = rest.indexOf('\nexport ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('CR-12 — product mutations are atomic (write + enqueue in one tx)', () => {
  const cases: Array<{ name: string; write: string }> = [
    { name: 'createProduct', write: 'INSERT INTO product' },
    { name: 'updateProduct', write: 'UPDATE product SET' },
    { name: 'deactivateProduct', write: 'UPDATE product SET active = 0' },
  ];

  for (const { name, write } of cases) {
    it(`${name}: write + enqueueOpInTx are both inside withTransactionAsync`, () => {
      const body = functionSource(name);
      const txStart = body.indexOf('db.withTransactionAsync');
      expect(txStart).toBeGreaterThan(-1);

      // The withTransactionAsync callback closes at 2-space indent.
      const txEnd = body.indexOf('\n  });', txStart);
      expect(txEnd).toBeGreaterThan(txStart);
      const inside = body.slice(txStart, txEnd);

      expect(inside).toContain(write);
      expect(inside).toContain('enqueueOpInTx');
      // Ordering inside the tx: the row write comes before the enqueue.
      expect(inside.indexOf(write)).toBeGreaterThan(-1);
      expect(inside.indexOf('enqueueOpInTx')).toBeGreaterThan(inside.indexOf(write));
    });
  }

  it('importProducts stays a single transaction (unchanged, regression guard)', () => {
    const body = functionSource('importProducts');
    expect(body).toContain('db.withTransactionAsync');
  });
});

describe('CR-13 — importProducts keeps the SKU claim across the batch', () => {
  it('no longer deletes the matched SKU from the lookup map', () => {
    const body = functionSource('importProducts');
    expect(body).not.toContain('bySku.delete');
  });

  it('delegates the upsert decision to the pure planProductImport planner', () => {
    const body = functionSource('importProducts');
    expect(body).toContain('planProductImport');
  });
});
