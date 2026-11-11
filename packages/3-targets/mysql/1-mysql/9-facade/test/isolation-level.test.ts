import { expect, expectTypeOf, test } from 'vitest';
import type mysql from '../src/exports/runtime';
import { IsolationLevel } from '../src/exports/runtime';

test('exports isolation constants accepted by factory and callback options', () => {
  expect(IsolationLevel).toEqual({
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable',
  });
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.Serializable }>().toExtend<
    NonNullable<Parameters<typeof mysql>[0]['transactionOptions']>
  >();
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.ReadCommitted }>().toExtend<
    NonNullable<Parameters<ReturnType<typeof mysql>['transaction']>[1]>
  >();
  expectTypeOf<{ isolationLevel: 'Serializable' }>().toExtend<
    NonNullable<Parameters<ReturnType<typeof mysql>['transaction']>[1]>
  >();
});
