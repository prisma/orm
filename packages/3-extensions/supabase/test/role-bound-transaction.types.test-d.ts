import type { Contract } from '@internal/contract/types';
import type { InteractiveTransactionsCapability } from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { RoleBoundDb, ServiceRoleDb } from '../src/exports/runtime';

type WithInteractiveTransactions = Contract<SqlStorage> & {
  readonly capabilities: InteractiveTransactionsCapability;
};
type WithoutInteractiveTransactions = Contract<SqlStorage> & {
  readonly capabilities: { readonly sql: { readonly returning: true } };
};

test('a role-bound client runs transaction() when its contract lists interactive transactions', () => {
  const user = {} as RoleBoundDb<WithInteractiveTransactions>;
  const service = {} as ServiceRoleDb<WithInteractiveTransactions>;
  expectTypeOf(user.transaction(async () => 1)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(service.transaction(async () => 1)).toEqualTypeOf<Promise<number>>();
});

test('transaction() is a type error on a role-bound client whose contract does not list them', () => {
  const user = {} as RoleBoundDb<WithoutInteractiveTransactions>;
  const service = {} as ServiceRoleDb<WithoutInteractiveTransactions>;
  // @ts-expect-error the contract does not list sql.interactiveTransactions
  user.transaction(async () => 1);
  // @ts-expect-error the contract does not list sql.interactiveTransactions
  service.transaction(async () => 1);
});
