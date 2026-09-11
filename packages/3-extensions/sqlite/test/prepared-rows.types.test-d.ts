import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { ContractWithTypeMaps, TypeMapsPhantomKey } from '@internal/sql-contract/types';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { PreparedExecution, PreparedStatement } from '@internal/sql-runtime';
import type { CodecTypes } from '@internal/target-sqlite/codec-types';
import { expectTypeOf, test } from 'vitest';
import type { SqliteClient } from '../src/runtime/sqlite';
import type { Contract as FixtureContract } from './fixtures/namespaced-contract';

type Contract = ContractWithTypeMaps<
  Omit<FixtureContract, TypeMapsPhantomKey>,
  { codecTypes: CodecTypes }
>;
declare const db: SqliteClient<Contract>;
declare const statsPlan: SqlQueryPlan<AffectedCount>;
declare const shapedRows: SqlQueryPlan<{ affectedRows: number }>;

test('ORM preparation preserves complete all and first results', async () => {
  const all = await db.prepare({}, () => db.orm.User.select('id').prepared.all());
  const first = await db.prepare({}, () => db.orm.User.select('id').prepared.first());
  expectTypeOf(all.query(db.runtime(), {})).toEqualTypeOf<AsyncIterableResult<{ id: number }>>();
  expectTypeOf(first.query(db.runtime(), {})).toEqualTypeOf<Promise<{ id: number } | null>>();
  // @ts-expect-error ordinary executing terminals are not preparation descriptions
  await db.prepare({}, () => db.orm.User.select('id').all());
  // @ts-expect-error the callback receives only params, never an injected SQL builder
  await db.prepare({}, (_sql, _params) => shapedRows);
});

test('SQL plans retain branded statistics and stats-shaped rows', async () => {
  expectTypeOf(await db.prepare({}, () => statsPlan)).toEqualTypeOf<
    PreparedExecution<Record<never, never>>
  >();
  expectTypeOf(await db.prepare({}, () => shapedRows)).toEqualTypeOf<
    PreparedStatement<Record<never, never>, { affectedRows: number }>
  >();
});

test('params-only callbacks preserve codec input inference', async () => {
  const prepared = await db.prepare({ id: 'sqlite/integer@1' }, (params) => {
    expectTypeOf(params.id.returnType.codecId).toEqualTypeOf<'sqlite/integer@1'>();
    return db.sql.users
      .select('id')
      .where((user, fns) => fns.eq(user.id, params.id))
      .build();
  });
  expectTypeOf<Parameters<typeof prepared.query>[1]['id']>().toEqualTypeOf<number>();
  expectTypeOf(prepared.query(db.runtime(), { id: 1 })).toEqualTypeOf<
    AsyncIterableResult<{ id: number }>
  >();
  // @ts-expect-error codec input remains numeric
  prepared.query(db.runtime(), { id: '1' });
  // @ts-expect-error codec ids are checked on the ORM overload too
  await db.prepare({ id: 'sqlite/nonexistent@1' }, () => db.orm.User.select('id').prepared.all());
});
