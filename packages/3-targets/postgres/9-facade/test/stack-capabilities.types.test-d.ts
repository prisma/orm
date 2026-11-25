import postgresAdapter from '@internal/adapter-postgres/runtime';
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

test('a contract from the default list has transaction() on the client and the serverless connection', async () => {
  const db = postgres({ contract: withTheDefaultList, url });
  expectTypeOf(db).toHaveProperty('transaction');
  const connection = await postgresServerless({ contract: withTheDefaultList }).connect({ url });
  expectTypeOf(connection).toHaveProperty('transaction');
});

test('a contract whose list lacks interactive transactions has no transaction()', async () => {
  const db = postgres({ contract: withoutInteractiveTransactions, url });
  expectTypeOf(db).not.toHaveProperty('transaction');
  const connection = await postgresServerless({
    contract: withoutInteractiveTransactions,
  }).connect({ url });
  expectTypeOf(connection).not.toHaveProperty('transaction');
});

test('creating a client is a type error when its adapter and driver lack a capability the contract requires', () => {
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
