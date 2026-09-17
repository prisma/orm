import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlIsolationLevel } from '@internal/sql-relational-core/ast';
import { expectTypeOf, test } from 'vitest';
import type { PostgresClient, PostgresTransactionContext } from '../src/runtime/postgres';

type TestContract = Contract<SqlStorage>;

test('transaction context does not expose a transaction method', () => {
  type HasTransaction = 'transaction' extends keyof PostgresTransactionContext<TestContract>
    ? true
    : false;
  expectTypeOf<HasTransaction>().toEqualTypeOf<false>();
});

test('db.transaction infers the callback return type correctly', () => {
  const db = {} as PostgresClient<TestContract>;

  const numResult = db.transaction(async (_tx) => 42);
  expectTypeOf(numResult).toEqualTypeOf<Promise<number>>();

  const objResult = db.transaction(async (_tx) => ({ name: 'test' as const, count: 3 }));
  expectTypeOf(objResult).toEqualTypeOf<Promise<{ name: 'test'; count: number }>>();
});

test('tx.sql has the same type as db.sql', () => {
  type DbSql = PostgresClient<TestContract>['sql'];
  type TxSql = PostgresTransactionContext<TestContract>['sql'];
  expectTypeOf<TxSql>().toEqualTypeOf<DbSql>();
});

test('tx.orm has the same type as db.orm', () => {
  type DbOrm = PostgresClient<TestContract>['orm'];
  type TxOrm = PostgresTransactionContext<TestContract>['orm'];
  expectTypeOf<TxOrm>().toEqualTypeOf<DbOrm>();
});

test('db.transaction accepts an optional isolation level', () => {
  const db = {} as PostgresClient<TestContract>;

  expectTypeOf(db.transaction)
    .parameter(1)
    .toEqualTypeOf<{ readonly isolationLevel?: SqlIsolationLevel } | undefined>();
  expectTypeOf(db.transaction(async (_tx) => 42, { isolationLevel: 'serializable' })).toEqualTypeOf<
    Promise<number>
  >();
  // @ts-expect-error snapshot is not a PostgreSQL isolation level
  db.transaction(async (_tx) => 42, { isolationLevel: 'snapshot' });
});
