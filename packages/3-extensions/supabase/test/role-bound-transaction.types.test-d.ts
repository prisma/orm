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

test('a role-bound client has transaction() when its contract lists interactive transactions', () => {
  expectTypeOf<RoleBoundDb<WithInteractiveTransactions>>().toHaveProperty('transaction');
  expectTypeOf<ServiceRoleDb<WithInteractiveTransactions>>().toHaveProperty('transaction');
});

test('a role-bound client has no transaction() when its contract does not list them', () => {
  expectTypeOf<RoleBoundDb<WithoutInteractiveTransactions>>().not.toHaveProperty('transaction');
  expectTypeOf<ServiceRoleDb<WithoutInteractiveTransactions>>().not.toHaveProperty('transaction');
});
