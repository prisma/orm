import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import type { CapabilitySet } from '@internal/sql-contract-ts/contract-builder';
import { expectTypeOf, test } from 'vitest';
import { defineContractFor } from '../../src/contract/define-contract';
import { defineContract, field, model } from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';
import { versionsWithALaterFeature } from '../support/version-table';

const User = model('User', {
  fields: { id: field.column({ codecId: 'pg/int4@1' } as const).id() },
}).sql({ table: 'users' });

const defineContractWithALaterFeature = defineContractFor(versionsWithALaterFeature);

test('a contract for 16 does not offer a feature that needs 17', () => {
  const contract = defineContractWithALaterFeature({ version: 16, models: { User } });
  const db = postgres({ contract, url: 'postgres://localhost/db' });
  db.orm.public.User.forUpdate();
  // @ts-expect-error FOR NO KEY UPDATE arrives with 17 in this table
  db.orm.public.User.forNoKeyUpdate();
});

test('a contract for 17 offers it', () => {
  const contract = defineContractWithALaterFeature({ version: 17, models: { User } });
  const db = postgres({ contract, url: 'postgres://localhost/db' });
  db.orm.public.User.forNoKeyUpdate();
});

test('a version outside the table is a type error', () => {
  // @ts-expect-error 18 is not in this table
  defineContractWithALaterFeature({ version: 18 });
  // @ts-expect-error 14 is not a supported PostgreSQL version
  defineContract({ version: 14 });
  // @ts-expect-error the version is required
  defineContract({});
});

test('the capabilities list reaches the type in order, with false turning a flag off', () => {
  const contract = defineContract({
    version: 18,
    capabilities: [
      { sql: { interactiveTransactions: true, returning: false } },
      { http: { batch: true } },
    ],
  });
  expectTypeOf(contract.capabilities.sql.interactiveTransactions).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.sql).not.toHaveProperty('returning');
  expectTypeOf(contract.capabilities.http.batch).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.postgres.forNoKeyUpdate).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.postgres).not.toHaveProperty('orderBy');
});

test('a set with a wide type keeps the row in the type', () => {
  const wide: CapabilitySet = { sql: { interactiveTransactions: true } };
  const contract = defineContract({ version: 18, capabilities: [wide] });
  expectTypeOf(contract.capabilities.postgres.forNoKeyUpdate).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.sql.returning).toEqualTypeOf<true>();
});

test("the runtime adapter's and driver's capabilities are a list a contract accepts", () => {
  defineContract({
    version: 18,
    capabilities: [postgresAdapter.capabilities, postgresDriver.capabilities],
  });
});

test('a single set where the list belongs is refused', () => {
  // @ts-expect-error the capabilities are a list of sets, not one set
  defineContract({ version: 18, capabilities: { sql: { interactiveTransactions: true } } });
});
