import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { expectTypeOf, test } from 'vitest';
import {
  createMongoExecutionStack,
  type MongoExecutionStack,
  type MongoExecutionStackWithDriver,
  type MongoRuntimeAdapterDescriptor,
  type MongoRuntimeDriverInstance,
  type MongoRuntimeTargetDescriptor,
} from '../src/mongo-execution-stack';

declare const target: MongoRuntimeTargetDescriptor<'mongo'>;
declare const adapter: MongoRuntimeAdapterDescriptor<'mongo'>;
declare const driver: RuntimeDriverDescriptor<
  'mongo',
  'mongo',
  unknown,
  MongoRuntimeDriverInstance<'mongo'>
>;

test('a stack with a driver always has one', () => {
  expectTypeOf<MongoExecutionStackWithDriver['driver']>().not.toBeNullable();
  expectTypeOf(createMongoExecutionStack({ target, adapter, driver })).toEqualTypeOf<
    MongoExecutionStackWithDriver<'mongo'>
  >();
});

test('a stack built without a driver has no driver member', () => {
  expectTypeOf(createMongoExecutionStack({ target, adapter })).toEqualTypeOf<
    MongoExecutionStack<'mongo'>
  >();
  expectTypeOf<MongoExecutionStack>().not.toHaveProperty('driver');
});
