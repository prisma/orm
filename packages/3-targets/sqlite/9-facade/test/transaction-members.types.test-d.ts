import type { Collection } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import type { SqliteClient, SqliteTransactionContext } from '../src/exports/runtime';
import type { SqliteStaticContext } from '../src/exports/static';

declare class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string): this;
}
type Classes = { Post: typeof PostCollection };
type Client = SqliteClient<Contract, Classes>;
type Tx = SqliteTransactionContext<Contract, Classes>;

test('each query member of a transaction has the type it has on the client', () => {
  expectTypeOf<Parameters<Parameters<Client['transaction']>[0]>[0]>().toEqualTypeOf<Tx>();
  expectTypeOf<Tx['sql']>().toEqualTypeOf<Client['sql']>();
  expectTypeOf<Tx['orm']>().toEqualTypeOf<Client['orm']>();
  expectTypeOf<Tx['raw']>().toEqualTypeOf<Client['raw']>();
  expectTypeOf<Tx['prepare']>().toEqualTypeOf<Client['prepare']>();
  expectTypeOf<Tx['query']>().toEqualTypeOf<Client['query']>();
  expectTypeOf<Tx['execute']>().toEqualTypeOf<Client['execute']>();
  expectTypeOf<Tx['toSql']>().toEqualTypeOf<Client['toSql']>();
  expectTypeOf<Tx['orm']['Post']['titled']>().toBeFunction();
});

test('the ORM offers fragment beside the models', () => {
  expectTypeOf<Client['orm']>().toHaveProperty('fragment');
  expectTypeOf<Tx['orm']>().toHaveProperty('fragment');
  expectTypeOf<Client['orm']>().toHaveProperty('Post');
});

test('a transaction has no lifecycle members, transaction or runtime', () => {
  expectTypeOf<
    Extract<keyof Tx, 'close' | 'transaction' | 'runtime' | typeof Symbol.asyncDispose>
  >().toBeNever();
});

test('the client has every static member of the static entry', () => {
  expectTypeOf<Client>().toMatchTypeOf<SqliteStaticContext<Contract>>();
});
