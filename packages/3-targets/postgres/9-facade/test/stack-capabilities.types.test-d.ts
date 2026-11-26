import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { StackProvides } from '@internal/sql-runtime';
import type postgresTarget from '@internal/target-postgres/runtime';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';

const url = 'postgres://localhost/db';

const withTheDefaultList = defineContract({ databaseVersion: 18 });
const withoutInteractiveTransactions = defineContract({
  databaseVersion: 18,
  capabilities: [postgresAdapter.capabilities],
});

test('a contract from the default list can run transaction() on the client and the serverless connection', async () => {
  const db = postgres({ contract: withTheDefaultList, url });
  expectTypeOf(db.transaction(async () => 1)).toEqualTypeOf<Promise<number>>();
  const connection = await postgresServerless({ contract: withTheDefaultList }).connect({ url });
  expectTypeOf(connection.transaction(async () => 1)).toEqualTypeOf<Promise<number>>();
});

test('for a contract whose list lacks interactive transactions, transaction() is a type error that names the capability', async () => {
  const db = postgres({ contract: withoutInteractiveTransactions, url });
  // @ts-expect-error the contract does not list sql.interactiveTransactions
  db.transaction(async () => 1);
  const connection = await postgresServerless({
    contract: withoutInteractiveTransactions,
  }).connect({ url });
  // @ts-expect-error the contract does not list sql.interactiveTransactions
  connection.transaction(async () => 1);
  expectTypeOf<Parameters<typeof db.transaction<number>>[0]>().toExtend<{
    readonly 'the contract does not list sql.interactiveTransactions': never;
  }>();
});

test('creating a client from a known contract is a type error when its adapter and driver lack a capability the contract requires', () => {
  const contract = defineContract({
    databaseVersion: 18,
    capabilities: [{ http: { batch: true } }],
  });
  // @ts-expect-error http.batch is required by the contract but not provided by its database version, adapter, driver or extensions
  postgres({ contract, url });
  // @ts-expect-error http.batch is required by the contract but not provided by its database version, adapter, driver or extensions
  postgresServerless({ contract });
});

// The facade's own driver provides interactive transactions, so this stack stands for one whose driver does not, such as a driver over HTTP.
interface StackOverHttp {
  readonly target: typeof postgresTarget;
  readonly adapter: typeof postgresAdapter;
  readonly driver: { readonly capabilities: Record<never, never> };
}

const notProvidedByTheStack =
  ' is required by the contract but not provided by its database version, adapter, driver or extensions';

test('with a driver that lacks interactive transactions, a contract that requires them is a type error that names them', () => {
  expectTypeOf<
    keyof StackProvides<typeof withTheDefaultList, StackOverHttp>
  >().toEqualTypeOf<`sql.interactiveTransactions${typeof notProvidedByTheStack}`>();
  expectTypeOf<
    StackProvides<typeof withoutInteractiveTransactions, StackOverHttp>
  >().toEqualTypeOf<unknown>();
});

test("the database's capabilities are left to signing, so no adapter or driver need provide them", () => {
  interface DatabaseOnly {
    readonly target: typeof postgresTarget;
    readonly adapter: { readonly capabilities: Record<never, never> };
    readonly driver: { readonly capabilities: Record<never, never> };
  }
  expectTypeOf<
    StackProvides<typeof withoutInteractiveTransactions, DatabaseOnly>
  >().toEqualTypeOf<unknown>();
});

test('a contract typed as any passes both checks, as at run time it is checked from its values', () => {
  // JSON.parse returns any.
  const contract: ReturnType<typeof JSON.parse> = withoutInteractiveTransactions;
  const db = postgres({ contract, url });
  db.transaction(async () => 1);
});

test('a function that wraps the client for any contract compiles, and keeps the client’s members', () => {
  function connectTo<TContract extends Contract<SqlStorage>>(contract: TContract) {
    const db = postgres({ contract, url });
    const serverless = postgresServerless({ contract });
    return { db, serverless, orm: db.orm, connect: db.connect };
  }
  expectTypeOf(connectTo(withTheDefaultList).db.orm).toEqualTypeOf(
    postgres({ contract: withTheDefaultList, url }).orm,
  );
});

test('a function generic over contracts runs transaction() with its own contract type', () => {
  function inTransaction<TContract extends Contract<SqlStorage>>(contract: TContract) {
    return postgres({ contract, url }).transaction(async (tx) => tx.orm);
  }
  expectTypeOf(inTransaction(withTheDefaultList)).toEqualTypeOf<
    Promise<ReturnType<typeof postgres<typeof withTheDefaultList>>['orm']>
  >();
});
