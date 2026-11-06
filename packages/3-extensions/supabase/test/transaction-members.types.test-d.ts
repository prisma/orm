import type { PostgresClient, PostgresTransactionContext } from '@internal/postgres/runtime';
import type { Collection } from '@internal/sql-orm-client';
import type { Pool } from 'pg';
import { expectTypeOf, test } from 'vitest';
import type {
  RoleBoundDb,
  SupabaseOptions,
  SupabaseTransactionContext,
} from '../src/exports/runtime';
import type { Contract } from './fixtures/example-app/contract';

declare class ProfileCollection extends Collection<Contract, 'Profile'> {
  named(username: string): this;
}
type Classes = { Profile: typeof ProfileCollection };
type Client = RoleBoundDb<Contract, Classes>;
type Tx = SupabaseTransactionContext<Contract, Classes>;

test('a role-bound transaction receives the transaction context', () => {
  expectTypeOf<Parameters<Parameters<Client['transaction']>[0]>[0]>().toEqualTypeOf<Tx>();
});

test('each query member of a transaction has the type it has on the role-bound client', () => {
  expectTypeOf<Tx['sql']>().toEqualTypeOf<Client['sql']>();
  expectTypeOf<Tx['orm']>().toEqualTypeOf<Client['orm']>();
  expectTypeOf<Tx['raw']>().toEqualTypeOf<Client['raw']>();
  expectTypeOf<Tx['prepare']>().toEqualTypeOf<Client['prepare']>();
  expectTypeOf<Tx['query']>().toEqualTypeOf<Client['query']>();
  expectTypeOf<Tx['execute']>().toEqualTypeOf<Client['execute']>();
  expectTypeOf<Tx['toSql']>().toEqualTypeOf<Client['toSql']>();
  expectTypeOf<Tx['orm']['public']['Profile']['named']>().toBeFunction();
});

test('query, execute and toSql have the types a postgres client has', () => {
  type Postgres = PostgresClient<Contract, Classes>;
  expectTypeOf<Client['query']>().toEqualTypeOf<Postgres['query']>();
  expectTypeOf<Client['execute']>().toEqualTypeOf<Postgres['execute']>();
  expectTypeOf<Client['toSql']>().toEqualTypeOf<Postgres['toSql']>();
});

test('a transaction has no lifecycle members, transaction or runtime', () => {
  expectTypeOf<
    Extract<keyof Tx, 'close' | 'transaction' | 'runtime' | typeof Symbol.asyncDispose>
  >().toBeNever();
});

test('a role-bound client and its transaction have the enums and nativeEnums a postgres client has', () => {
  type Postgres = PostgresClient<Contract, Classes>;
  expectTypeOf<Client['enums']>().toEqualTypeOf<Postgres['enums']>();
  expectTypeOf<Client['nativeEnums']>().toEqualTypeOf<Postgres['nativeEnums']>();
  expectTypeOf<Tx['enums']>().toEqualTypeOf<Postgres['enums']>();
  expectTypeOf<Tx['nativeEnums']>().toEqualTypeOf<Postgres['nativeEnums']>();
});

test('a role-bound transaction has the members of a postgres transaction', () => {
  expectTypeOf<Tx>().toEqualTypeOf<PostgresTransactionContext<Contract, Classes>>();
});

test('the pg option takes a pg.Pool only', () => {
  expectTypeOf<SupabaseOptions<Contract>['pg']>().toEqualTypeOf<Pool | undefined>();
});
