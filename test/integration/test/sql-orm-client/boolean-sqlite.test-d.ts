import type { Collection } from '@internal/sql-orm-client';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/boolean-sqlite/generated/contract';

declare const accounts: Collection<Contract, 'Account'>;

describe('a SQLite Boolean field', () => {
  test('reads as a boolean', () => {
    const rows = accounts.select('active', 'admin').all();
    type Row = Awaited<typeof rows>[number];
    expectTypeOf<Row['active']>().toEqualTypeOf<boolean>();
    expectTypeOf<Row['admin']>().toEqualTypeOf<boolean | null>();
  });

  test('is filtered by equality and is not ordered', () => {
    accounts.where((account) => account.active.eq(true));
    accounts.where((account) => account.admin.neq(false));
    // @ts-expect-error a boolean is not ordered
    accounts.where((account) => account.active.gt(false));
  });

  test('needs no value on create, because it has a default', () => {
    accounts.create({ id: 1 });
  });
});
