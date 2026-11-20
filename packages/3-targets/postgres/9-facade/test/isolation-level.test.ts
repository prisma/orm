import { expect, expectTypeOf, test } from 'vitest';
import type postgres from '../src/exports/runtime';
import { IsolationLevel } from '../src/exports/runtime';
import type serverless from '../src/exports/serverless';
import { IsolationLevel as ServerlessIsolationLevel } from '../src/exports/serverless';

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
    NonNullable<Parameters<ReturnType<typeof postgres>['transaction']>[1]>
  >();
  expectTypeOf<{ isolationLevel: typeof ServerlessIsolationLevel.Serializable }>().toExtend<
    NonNullable<Parameters<typeof serverless>[0]['transactionOptions']>
  >();
  expectTypeOf<{ isolationLevel: typeof ServerlessIsolationLevel.Serializable }>().toExtend<
    NonNullable<
      Parameters<Awaited<ReturnType<ReturnType<typeof serverless>['connect']>>['transaction']>[1]
    >
  >();
  expectTypeOf<{ isolationLevel: 'Serializable' }>().toExtend<
    NonNullable<Parameters<ReturnType<typeof postgres>['transaction']>[1]>
  >();
});
