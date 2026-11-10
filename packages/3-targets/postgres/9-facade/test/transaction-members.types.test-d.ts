import type { Collection } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import type { PostgresClient, PostgresTransactionContext } from '../src/exports/runtime';
import type { PostgresServerlessConnection } from '../src/exports/serverless';
import type { Contract } from './fixtures/generated/contract';

declare class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string): this;
}
type Classes = { Post: typeof PostCollection };
type Client = PostgresClient<Contract, Classes>;
type Tx = PostgresTransactionContext<Contract, Classes>;
type Connection = PostgresServerlessConnection<Contract, Classes>;
type ConnectionTx = Parameters<
  Parameters<PostgresServerlessConnection<Contract, Classes>['transaction']>[0]
>[0];

test('each query member of a transaction has the type it has on the client', () => {
  expectTypeOf<Tx['sql']>().toEqualTypeOf<Client['sql']>();
  expectTypeOf<Tx['orm']>().toEqualTypeOf<Client['orm']>();
  expectTypeOf<Tx['raw']>().toEqualTypeOf<Client['raw']>();
  expectTypeOf<Tx['prepare']>().toEqualTypeOf<Client['prepare']>();
  expectTypeOf<Tx['orm']['public']['Post']['titled']>().toBeFunction();
});

test('query and execute have one type on a client, a serverless connection and a transaction', () => {
  expectTypeOf<Tx['query']>().toEqualTypeOf<Client['query']>();
  expectTypeOf<Tx['execute']>().toEqualTypeOf<Client['execute']>();
  expectTypeOf<Connection['query']>().toEqualTypeOf<Client['query']>();
  expectTypeOf<Connection['execute']>().toEqualTypeOf<Client['execute']>();
});

test('toSql has one type on a client, a serverless connection and a transaction', () => {
  expectTypeOf<Connection['toSql']>().toEqualTypeOf<Client['toSql']>();
  expectTypeOf<Tx['toSql']>().toEqualTypeOf<Client['toSql']>();
});

test('a serverless connection gives its transactions the same members', () => {
  expectTypeOf<ConnectionTx>().toEqualTypeOf<Tx>();
});

test('a transaction has no lifecycle members, transaction or runtime', () => {
  expectTypeOf<
    Extract<keyof Tx, 'close' | 'transaction' | 'runtime' | typeof Symbol.asyncDispose>
  >().toBeNever();
});
