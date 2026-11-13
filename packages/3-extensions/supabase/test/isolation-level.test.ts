import { IsolationLevel as PostgresIsolationLevel } from '@internal/postgres/runtime';
import { expect, expectTypeOf, test } from 'vitest';
import { IsolationLevel, type RoleBoundDb, type SupabaseOptions } from '../src/exports/runtime';
import type { Contract } from './fixtures/example-app/contract';

test('reuses the PostgreSQL isolation object for factory and callback options', () => {
  expect(IsolationLevel).toBe(PostgresIsolationLevel);
  expect(IsolationLevel).toEqual({
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable',
  });
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.Serializable }>().toExtend<
    NonNullable<SupabaseOptions<Contract>['transactionOptions']>
  >();
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.ReadCommitted }>().toExtend<
    NonNullable<Parameters<RoleBoundDb<Contract>['transaction']>[1]>
  >();
  expectTypeOf<{ isolationLevel: 'Serializable' }>().toExtend<
    NonNullable<Parameters<RoleBoundDb<Contract>['transaction']>[1]>
  >();
});
