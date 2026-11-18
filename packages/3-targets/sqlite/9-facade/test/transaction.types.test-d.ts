import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { SqliteTransactionOptions } from '../src/exports/runtime';
import type { SqliteClient, SqliteTransactionContext } from '../src/runtime/sqlite';

type TestContract = Contract<SqlStorage>;

test('SQLite accepts only Serializable and retains callback inference', () => {
  expectTypeOf<SqliteTransactionOptions>().not.toBeAny();
  expectTypeOf<SqliteTransactionOptions['isolationLevel']>().toEqualTypeOf<
    'Serializable' | undefined
  >();
  expectTypeOf<'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | null>().not.toExtend<
    SqliteTransactionOptions['isolationLevel']
  >();
  expectTypeOf<SqliteTransactionOptions['timeout']>().toEqualTypeOf<number | null | undefined>();
  // @ts-expect-error
  expectTypeOf({ timeout: '1000' } satisfies SqliteTransactionOptions);
  const db = {} as SqliteClient<TestContract>;
  expectTypeOf(
    db.transaction(async () => 42, { isolationLevel: 'Serializable', timeout: null }),
  ).toEqualTypeOf<Promise<number>>();
  expectTypeOf(db.transaction).parameter(1).toEqualTypeOf<SqliteTransactionOptions | undefined>();
});

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

test('the client and the transaction context do not expose startActivity or planContentHash', () => {
  expectTypeOf<SqliteClient<TestContract>>().not.toHaveProperty('startActivity');
  expectTypeOf<SqliteClient<TestContract>>().not.toHaveProperty('planContentHash');
  expectTypeOf<SqliteTransactionContext<TestContract>>().not.toHaveProperty('startActivity');
  expectTypeOf<SqliteTransactionContext<TestContract>>().not.toHaveProperty('planContentHash');
});
