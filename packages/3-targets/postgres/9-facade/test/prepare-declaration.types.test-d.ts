/**
 * Type-test: a prepared declaration completes and checks its codec ids.
 *
 * The declaration is where a caller writes a codec id by hand, so `keyof CT`
 * has to stay a literal union: intersecting the contract's codec map with the
 * open base collapses it to `string` through that type's index signature,
 * which costs the completions and lets an unregistered id typecheck.
 */

import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { PostgresClient } from '../src/runtime/postgres';
import type { Contract } from './fixtures/generated/contract';

declare const db: PostgresClient<Contract>;

test('the fixture codec map is not any', () => {
  expectTypeOf<ExtractCodecTypes<Contract>>().not.toBeAny();
});

test('a declaration binds each declared id to its codec input type', async () => {
  const prepared = await db.prepare({ id: 'pg/int4@1', email: 'pg/text@1' }, (params) => {
    expectTypeOf(params.id.returnType.codecId).toEqualTypeOf<'pg/int4@1'>();
    expectTypeOf(params.email.returnType.codecId).toEqualTypeOf<'pg/text@1'>();
    return db.sql.public.users.select('id').build();
  });

  type Params = Parameters<typeof prepared.query>[1];
  expectTypeOf<Params['id']>().toEqualTypeOf<number>();
  expectTypeOf<Params['email']>().toEqualTypeOf<string>();
});

test('a declaration naming an id the contract does not carry is rejected', async () => {
  await db.prepare(
    // @ts-expect-error — the declaration names a codec the contract's map has no row for
    { id: 'pg/nonexistent@1' },
    () => null as never,
  );
});
