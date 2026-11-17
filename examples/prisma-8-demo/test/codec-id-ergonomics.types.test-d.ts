/**
 * Type-test: codec ids are completed and checked where they are authored.
 *
 * These run against the demo's emitted contract, whose codec map resolves for
 * real, so they pin what a user meets: an id the contract carries keeps its
 * literal, and one it does not carry is refused at the call site.
 */

import { expectTypeOf, test } from 'vitest';
import { db } from '../src/prisma/db';

test('a contract-bound fragment keeps its codec id literal', () => {
  const expr = db.raw.sql`now()`.returns('pg/timestamptz-temporal@1');
  expectTypeOf(expr.returnType.codecId).toEqualTypeOf<'pg/timestamptz-temporal@1'>();
});

test('a contract-bound fragment rejects an id the contract does not carry', () => {
  // @ts-expect-error — unknown codec id
  db.raw.sql`now()`.returns('pg/nope@1');
});

test('a prepared declaration rejects an id the contract does not carry', async () => {
  // @ts-expect-error — unknown codec id in the declaration
  await db.prepare({ id: 'pg/nope@1' }, () => null as never);
});
