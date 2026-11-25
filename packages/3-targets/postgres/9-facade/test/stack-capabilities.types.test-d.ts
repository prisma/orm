import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import type { CapabilitiesNotProvided, StackProvides } from '../src/runtime/stack-capabilities';

const url = 'postgres://localhost/db';

const withTheDefaultList = defineContract({ version: 18 });
const withoutInteractiveTransactions = defineContract({
  version: 18,
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
  const contract = defineContract({ version: 18, capabilities: [{ http: { batch: true } }] });
  // @ts-expect-error the adapter and driver do not provide http.batch
  postgres({ contract, url });
  // @ts-expect-error the adapter and driver do not provide http.batch
  postgresServerless({ contract });
});

// The facade's own driver provides interactive transactions, so this driver set stands for one that does not, such as a driver over HTTP.
const driverOverHttp = {} as const;

function clientWithDriver<DriverCapabilities>(_driver: DriverCapabilities) {
  return <Capabilities>(
    _options: { readonly contract: { readonly capabilities: Capabilities } } & StackProvides<
      CapabilitiesNotProvided<
        Capabilities,
        typeof postgresCapabilitiesByVersion,
        typeof postgresAdapter.capabilities,
        DriverCapabilities
      >
    >,
  ): void => {};
}

test('with a driver that lacks interactive transactions, a contract that requires them is a type error that names them', () => {
  const create = clientWithDriver(driverOverHttp);
  expectTypeOf<
    CapabilitiesNotProvided<
      (typeof withTheDefaultList)['capabilities'],
      typeof postgresCapabilitiesByVersion,
      typeof postgresAdapter.capabilities,
      typeof driverOverHttp
    >
  >().toEqualTypeOf<'sql.interactiveTransactions'>();
  // @ts-expect-error the adapter and driver do not provide sql.interactiveTransactions
  create({ contract: withTheDefaultList });
  create({ contract: withoutInteractiveTransactions });
});

test("the database's capabilities are left to signing, so no adapter or driver need provide them", () => {
  expectTypeOf<
    CapabilitiesNotProvided<
      (typeof withoutInteractiveTransactions)['capabilities'],
      typeof postgresCapabilitiesByVersion,
      Record<never, never>,
      Record<never, never>
    >
  >().toBeNever();
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
