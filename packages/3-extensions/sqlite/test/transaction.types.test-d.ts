import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { SqliteClient, SqliteTransactionContext } from '../src/runtime/sqlite';

type TestContract = Contract<SqlStorage>;

test('transaction context does not expose a transaction method', () => {
  type HasTransaction = 'transaction' extends keyof SqliteTransactionContext<TestContract>
    ? true
    : false;
  expectTypeOf<HasTransaction>().toEqualTypeOf<false>();
});

test('db.transaction infers the callback return type correctly', () => {
  const db = {} as SqliteClient<TestContract>;

  const numResult = db.transaction(async (_tx) => 42);
  expectTypeOf(numResult).toEqualTypeOf<Promise<number>>();

  const objResult = db.transaction(async (_tx) => ({ name: 'test' as const, count: 3 }));
  expectTypeOf(objResult).toEqualTypeOf<Promise<{ name: 'test'; count: number }>>();
});

test('tx.sql has the same type as db.sql', () => {
  type DbSql = SqliteClient<TestContract>['sql'];
  type TxSql = SqliteTransactionContext<TestContract>['sql'];
  expectTypeOf<TxSql>().toEqualTypeOf<DbSql>();
});

test('tx.orm has the same type as db.orm', () => {
  type DbOrm = SqliteClient<TestContract>['orm'];
  type TxOrm = SqliteTransactionContext<TestContract>['orm'];
  expectTypeOf<TxOrm>().toEqualTypeOf<DbOrm>();
});

test('db.transaction takes no isolation level', () => {
  const db = {} as SqliteClient<TestContract>;

  // @ts-expect-error SQLite has no per-transaction isolation level to request
  db.transaction(async (_tx) => 42, { isolationLevel: 'serializable' });
});
