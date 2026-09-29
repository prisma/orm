import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Runtime } from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import postgres, { type PostgresClient, type PostgresOptions } from '../src/runtime/postgres';
import postgresServerless, {
  type PostgresServerlessClient,
  type PostgresServerlessOptions,
} from '../src/runtime/postgres-serverless';
import type { Contract as FixtureContract } from './fixtures/generated/contract';

type TestContract = Contract<SqlStorage>;
type Serverless = PostgresServerlessClient<TestContract>;
type Connection = Awaited<ReturnType<Serverless['connect']>>;

test('the serverless client has the static members and connect', () => {
  expectTypeOf<keyof Serverless>().toEqualTypeOf<
    'sql' | 'raw' | 'enums' | 'nativeEnums' | 'context' | 'contract' | 'stack' | 'connect'
  >();
});

test('the connection has the members of a client except connect', () => {
  expectTypeOf<Connection>().toEqualTypeOf<Omit<PostgresClient<TestContract>, 'connect'>>();
});

test('the connection is not a Runtime', () => {
  expectTypeOf<Connection>().not.toMatchTypeOf<Runtime>();
  expectTypeOf<Extract<keyof Connection, 'query' | 'execute'>>().toBeNever();
});

test('the connection types orm and the transaction context from the contract', async () => {
  const db = {} as Awaited<ReturnType<PostgresServerlessClient<FixtureContract>['connect']>>;

  expectTypeOf(db.orm.public).not.toBeAny();
  expectTypeOf(db.orm.public.User).toHaveProperty('all');

  await db.transaction(async (tx) => {
    expectTypeOf(tx).not.toBeAny();
    expectTypeOf(tx.orm.public).not.toBeAny();
    expectTypeOf(tx.orm.public.User).toHaveProperty('all');
  });
});

test('connect() rejects bindings other than { url }', () => {
  const serverless = {} as Serverless;
  expectTypeOf(serverless.connect).parameter(0).toEqualTypeOf<{ readonly url: string }>();
  // @ts-expect-error binding is restricted to { url }; pg/binding shapes are not accepted
  void serverless.connect({ pg: {} as unknown });
  // @ts-expect-error binding is restricted to { url }; binding shape is not accepted
  void serverless.connect({ binding: { kind: 'url', url: 'x' } });
});

test('postgres() and postgresServerless() differ only in the binding and pool options', () => {
  type ClientOnly = Exclude<
    keyof PostgresOptions<TestContract>,
    keyof PostgresServerlessOptions<TestContract>
  >;
  type ServerlessOnly = Exclude<
    keyof PostgresServerlessOptions<TestContract>,
    keyof PostgresOptions<TestContract>
  >;
  expectTypeOf<ClientOnly>().toEqualTypeOf<'binding' | 'url' | 'pg' | 'poolOptions'>();
  expectTypeOf<ServerlessOnly>().toBeNever();
});

test('the cursor option has no disabled flag', () => {
  type CursorOption = NonNullable<PostgresOptions<TestContract>['cursor']>;
  expectTypeOf<keyof CursorOption>().toEqualTypeOf<'batchSize'>();

  const contract = {} as TestContract;
  // @ts-expect-error cursors are off when the option is unset; there is no disabled flag
  void postgres<TestContract>({ contract, cursor: { disabled: true } });
  void postgresServerless<TestContract>({
    contract,
    // @ts-expect-error cursors are off when the option is unset; there is no disabled flag
    cursor: { disabled: true },
  });
});
