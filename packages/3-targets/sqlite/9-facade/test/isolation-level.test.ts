import { expect, expectTypeOf, test } from 'vitest';
import type sqlite from '../src/exports/runtime';
import { IsolationLevel } from '../src/exports/runtime';

test('exports only Serializable for SQLite transactions', () => {
  expect(IsolationLevel).toEqual({ Serializable: 'Serializable' });
  expectTypeOf<keyof typeof IsolationLevel>().toEqualTypeOf<'Serializable'>();
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.Serializable }>().toExtend<
    NonNullable<Parameters<typeof sqlite>[0]['transactionOptions']>
  >();
  expectTypeOf<{ isolationLevel: typeof IsolationLevel.Serializable }>().toExtend<
    NonNullable<Parameters<ReturnType<typeof sqlite>['transaction']>[1]>
  >();
  expectTypeOf<{ isolationLevel: 'Serializable' }>().toExtend<
    NonNullable<Parameters<ReturnType<typeof sqlite>['transaction']>[1]>
  >();
  expectTypeOf<{ isolationLevel: 'ReadCommitted' }>().not.toExtend<
    NonNullable<Parameters<ReturnType<typeof sqlite>['transaction']>[1]>
  >();
});
