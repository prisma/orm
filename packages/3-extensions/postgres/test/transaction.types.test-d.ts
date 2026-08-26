import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE } from '@prisma-next/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import type {
  PostgresClient,
  PostgresConnectionContext,
  PostgresTransactionContext,
  TempTableAppendInput,
  TempTableColumnDef,
} from '../src/runtime/postgres';

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

test('transaction context exposes tempTable()', () => {
  type HasTempTable = 'tempTable' extends keyof PostgresTransactionContext<TestContract>
    ? true
    : false;
  expectTypeOf<HasTempTable>().toEqualTypeOf<true>();
});

test('transaction tempTable() accepts no arguments', () => {
  type Params = Parameters<PostgresTransactionContext<TestContract>['tempTable']>;
  expectTypeOf<Params>().toEqualTypeOf<[]>();
});

test('tempTable().as returns a metadata-rich handle', () => {
  type Builder = ReturnType<PostgresTransactionContext<TestContract>['tempTable']>;
  type HandlePromise = ReturnType<Builder['as']>;
  expectTypeOf<Awaited<HandlePromise>>().toMatchTypeOf<{
    name: string;
    fields: Record<string, { codecId: string; nullable: boolean }>;
    drop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  }>();
});

test('tempTable().as accepts internally-convertible ORM-like inputs', () => {
  type Builder = ReturnType<PostgresTransactionContext<TestContract>['tempTable']>;
  type AsInput = Parameters<Builder['as']>[0];
  type Convertible = {
    [INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE](): {
      buildAst(): never;
      getRowFields(): Record<string, { codecId: string; nullable: boolean }>;
    };
  };

  type AcceptsConvertible = Convertible extends AsInput ? true : false;
  expectTypeOf<AcceptsConvertible>().toEqualTypeOf<true>();
});

test('TempTableColumnDef has name and type fields', () => {
  expectTypeOf<TempTableColumnDef>().toMatchTypeOf<{ name: string; type: string }>();
});

test('tempTable().from() accepts only column defs', () => {
  type Builder = ReturnType<PostgresTransactionContext<TestContract>['tempTable']>;
  type FromParams = Parameters<Builder['from']>;

  expectTypeOf<FromParams[0]>().toMatchTypeOf<readonly TempTableColumnDef[]>();
  expectTypeOf<FromParams>().toEqualTypeOf<[columns: readonly TempTableColumnDef[]]>();
});

test('tempTable().from() returns a TempTableHandle promise', () => {
  type Builder = ReturnType<PostgresTransactionContext<TestContract>['tempTable']>;
  type HandlePromise = ReturnType<Builder['from']>;
  expectTypeOf<Awaited<HandlePromise>>().toMatchTypeOf<{
    name: string;
    drop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  }>();
});

test('TempTableHandle.append() accepts a typed subquery that matches Row', () => {
  type Builder = ReturnType<PostgresTransactionContext<TestContract>['tempTable']>;
  type Handle = Awaited<ReturnType<Builder['as']>>;
  type AppendParam = Parameters<Handle['append']>[0];

  expectTypeOf<AppendParam>().toMatchTypeOf<TempTableAppendInput>();
});

test('TempTableAppendInput accepts raw rows', () => {
  type RawRows = readonly (readonly (string | number | boolean | null)[])[];
  type IsAccepted = RawRows extends TempTableAppendInput ? true : false;
  expectTypeOf<IsAccepted>().toEqualTypeOf<true>();
});

test('TempTableHandle.append() returns Promise<void>', () => {
  type Builder = ReturnType<PostgresTransactionContext<TestContract>['tempTable']>;
  type Handle = Awaited<ReturnType<Builder['from']>>;
  type AppendReturn = ReturnType<Handle['append']>;
  expectTypeOf<AppendReturn>().toEqualTypeOf<Promise<void>>();
});

test('db.connection infers the callback return type correctly', () => {
  const db = {} as PostgresClient<TestContract>;

  const numResult = db.connection(async (_conn) => 42);
  expectTypeOf(numResult).toEqualTypeOf<Promise<number>>();
});

test('connection context exposes tempTable()', () => {
  type HasTempTable = 'tempTable' extends keyof PostgresConnectionContext<TestContract>
    ? true
    : false;
  expectTypeOf<HasTempTable>().toEqualTypeOf<true>();
});

test('connection tempTable() accepts no arguments', () => {
  type Params = Parameters<PostgresConnectionContext<TestContract>['tempTable']>;
  expectTypeOf<Params>().toEqualTypeOf<[]>();
});

test('connection context exposes sql with same type as db.sql', () => {
  type DbSql = PostgresClient<TestContract>['sql'];
  type ConnSql = PostgresConnectionContext<TestContract>['sql'];
  expectTypeOf<ConnSql>().toEqualTypeOf<DbSql>();
});

test('connection context does not expose release or destroy', () => {
  type HasRelease = 'release' extends keyof PostgresConnectionContext<TestContract> ? true : false;
  type HasDestroy = 'destroy' extends keyof PostgresConnectionContext<TestContract> ? true : false;
  expectTypeOf<HasRelease>().toEqualTypeOf<false>();
  expectTypeOf<HasDestroy>().toEqualTypeOf<false>();
});

test('connection context exposes registerReleaseHook', () => {
  type HasHook = 'registerReleaseHook' extends keyof PostgresConnectionContext<TestContract>
    ? true
    : false;
  expectTypeOf<HasHook>().toEqualTypeOf<true>();
});
