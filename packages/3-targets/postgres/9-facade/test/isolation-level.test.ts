import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expect, expectTypeOf, test } from 'vitest';
import type postgres from '../src/exports/runtime';
import {
  type InteractiveTransactionsCapability,
  IsolationLevel,
  type PostgresClient,
} from '../src/exports/runtime';
import type serverless from '../src/exports/serverless';
import {
  type PostgresServerlessConnection,
  IsolationLevel as ServerlessIsolationLevel,
} from '../src/exports/serverless';

type TransactionalContract = Contract<SqlStorage> & {
  readonly capabilities: InteractiveTransactionsCapability;
};

test('exports shared isolation constants for pooled and serverless transactions', () => {
  expect(IsolationLevel).toEqual({
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable',
  });
  expect(ServerlessIsolationLevel).toBe(IsolationLevel);
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.Serializable }>().toExtend<
    NonNullable<Parameters<typeof postgres>[0]['transactionOptions']>
  >();
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.RepeatableRead }>().toExtend<
    NonNullable<Parameters<PostgresClient<TransactionalContract>['transaction']>[1]>
  >();
  expectTypeOf<{ isolationLevel: typeof ServerlessIsolationLevel.Serializable }>().toExtend<
    NonNullable<Parameters<typeof serverless>[0]['transactionOptions']>
  >();
  expectTypeOf<{ isolationLevel: typeof ServerlessIsolationLevel.Serializable }>().toExtend<
    NonNullable<Parameters<PostgresServerlessConnection<TransactionalContract>['transaction']>[1]>
  >();
  expectTypeOf<{ isolationLevel: 'Serializable' }>().toExtend<
    NonNullable<Parameters<PostgresClient<TransactionalContract>['transaction']>[1]>
  >();
});
