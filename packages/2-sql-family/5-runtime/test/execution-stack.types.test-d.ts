import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { expectTypeOf, test } from 'vitest';
import type {
  SqlExecutionStack,
  SqlExecutionStackWithDriver,
  SqlRuntimeDriverInstance,
} from '../src/sql-context';
import { createSqlExecutionStack } from '../src/sql-context';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestTargetDescriptor,
} from './utils';

declare const driver: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  unknown,
  SqlRuntimeDriverInstance<'postgres'>
>;

const target = createTestTargetDescriptor();
const adapter = createTestAdapterDescriptor(createStubAdapter());

test('a stack with a driver always has one', () => {
  expectTypeOf<SqlExecutionStackWithDriver['driver']>().not.toBeNullable();
  expectTypeOf(createSqlExecutionStack({ target, adapter, driver })).toEqualTypeOf<
    SqlExecutionStackWithDriver<'postgres'>
  >();
});

test('a stack built without a driver has no driver member', () => {
  expectTypeOf(createSqlExecutionStack({ target, adapter })).toEqualTypeOf<
    SqlExecutionStack<'postgres'>
  >();
  expectTypeOf<SqlExecutionStack>().not.toHaveProperty('driver');
});
