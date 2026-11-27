import { expectTypeOf, test } from 'vitest';
import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
  type RequiredCapabilities,
} from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const User = model('User', {
  fields: { id: field.column({ codecId: 'pg/int4@1' } as const).id() },
}).sql({ table: 'users' });

test('a list spread from the version’s and the driver’s keeps each capability in the type', () => {
  const contract = defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver] });
  expectTypeOf(contract.capabilities.sql.interactiveTransactions).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.sql.returning).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.postgres.forNoKeyUpdate).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.postgres).not.toHaveProperty('orderBy');
});

test('the list is the type, so a feature it leaves out is not offered', () => {
  expectTypeOf(
    defineContract({ requiredCapabilities: ['http.batch'] }).capabilities.http.batch,
  ).toEqualTypeOf<true>();
  const contract = defineContract({
    requiredCapabilities: postgres18.filter(
      (capability) => capability !== 'postgres.forNoKeyUpdate',
    ),
    models: { User },
  });
  const db = postgres({ contract, url: 'postgres://localhost/db' });
  db.orm.public.User.forUpdate();
  // @ts-expect-error the list leaves out postgres.forNoKeyUpdate
  db.orm.public.User.forNoKeyUpdate();
});

test('a list filtered by a comparison leaves what it filters out of the type too', () => {
  const contract = defineContract({
    requiredCapabilities: postgres18.filter((capability) => capability !== 'sql.returning'),
  });
  expectTypeOf(contract.capabilities.sql).not.toHaveProperty('returning');
  expectTypeOf(contract.capabilities.sql.lateral).toEqualTypeOf<true>();
});

test('a list typed as RequiredCapabilities names no capability in the type, and the client is still created', () => {
  const required: RequiredCapabilities = [...postgres18];
  const contract = defineContract({ requiredCapabilities: required, models: { User } });
  postgres({ contract, url: 'postgres://localhost/db' });
});

test('the list is required, and its entries are capability keys', () => {
  // @ts-expect-error the list is required
  defineContract({});
  // @ts-expect-error a capability is a key with a namespace
  defineContract({ requiredCapabilities: ['returning'] });
  // @ts-expect-error the database version is not an option
  defineContract({ databaseVersion: 18 });
  // @ts-expect-error the capability sets option is gone
  defineContract({ requiredCapabilities: postgres18, capabilities: [] });
});
