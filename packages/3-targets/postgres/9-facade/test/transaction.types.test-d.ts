import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { PostgresClient } from '../src/runtime/postgres';
import type { PostgresTransactionContext } from '../src/runtime/postgres-members';

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

test('the client and the transaction context do not expose startActivity or planContentHash', () => {
  expectTypeOf<PostgresClient<TestContract>>().not.toHaveProperty('startActivity');
  expectTypeOf<PostgresClient<TestContract>>().not.toHaveProperty('planContentHash');
  expectTypeOf<PostgresTransactionContext<TestContract>>().not.toHaveProperty('startActivity');
  expectTypeOf<PostgresTransactionContext<TestContract>>().not.toHaveProperty('planContentHash');
});

test('db.runtime(), its connections and their transactions do not expose startActivity or planContentHash', () => {
  type DbRuntime = ReturnType<PostgresClient<TestContract>['runtime']>;
  type DbConnection = Awaited<ReturnType<DbRuntime['connection']>>;
  type DbTransaction = Awaited<ReturnType<DbConnection['transaction']>>;
  expectTypeOf<DbRuntime>().not.toHaveProperty('startActivity');
  expectTypeOf<DbRuntime>().not.toHaveProperty('planContentHash');
  expectTypeOf<DbConnection>().not.toHaveProperty('startActivity');
  expectTypeOf<DbConnection>().not.toHaveProperty('planContentHash');
  expectTypeOf<DbTransaction>().not.toHaveProperty('startActivity');
  expectTypeOf<DbTransaction>().not.toHaveProperty('planContentHash');
});
