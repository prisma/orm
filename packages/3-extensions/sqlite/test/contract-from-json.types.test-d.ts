import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../3-targets/3-targets/sqlite/test/fixtures/sqlite-contract.d';
import contractJson from '../../../3-targets/3-targets/sqlite/test/fixtures/sqlite-contract.json' with {
  type: 'json',
};
import sqlite, { type SqliteClient } from '../src/exports/runtime';
import sqliteStatic, { contractFromJson, type SqliteStaticContext } from '../src/exports/static';

const contract = contractFromJson<Contract>(contractJson);

test('contractFromJson returns the named contract type', () => {
  expectTypeOf(contract).toEqualTypeOf<Contract>();
});

test('contractFromJson takes only a SQL contract type', () => {
  // @ts-expect-error a type that is not a SQL contract
  contractFromJson<{ readonly target: 'sqlite' }>(contractJson);
});

test('each client infers the contract type from the value', () => {
  expectTypeOf(sqlite({ contract })).toEqualTypeOf<SqliteClient<Contract>>();
  expectTypeOf(sqliteStatic({ contract })).toEqualTypeOf<SqliteStaticContext<Contract>>();
  expectTypeOf(sqlite({ contract }).orm.Post).toHaveProperty('all');
});

test('no client takes contractJson', () => {
  // @ts-expect-error the contract is passed as a value
  sqlite<Contract>({ contractJson });
  // @ts-expect-error the contract is passed as a value
  sqliteStatic({ contractJson });
});
