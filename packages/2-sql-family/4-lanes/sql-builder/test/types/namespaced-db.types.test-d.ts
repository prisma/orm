import { expectTypeOf, test } from 'vitest';
import type { Db, Namespace, TableProxy } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

declare const db: Db<Contract>;

test('the namespace facet exposes its tables as TableProxy keyed by namespace coordinate', () => {
  expectTypeOf(db.public.users).toEqualTypeOf<TableProxy<Contract, 'public', 'users'>>();
  expectTypeOf<Namespace<Contract, 'public'>['users']>().toEqualTypeOf<
    TableProxy<Contract, 'public', 'users'>
  >();
});
