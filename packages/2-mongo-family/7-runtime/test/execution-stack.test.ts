import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { newMongoCodecRegistry } from '@internal/mongo-codec';
import { describe, expect, it, vi } from 'vitest';
import {
  createMongoExecutionStack,
  type MongoRuntimeAdapterDescriptor,
  type MongoRuntimeDriverInstance,
  type MongoRuntimeTargetDescriptor,
} from '../src/mongo-execution-stack';

function target(sessionSettings?: Record<string, string>): MongoRuntimeTargetDescriptor<'mongo'> {
  return {
    kind: 'target',
    id: 'test-target',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: newMongoCodecRegistry,
    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
    ...(sessionSettings === undefined ? {} : { sessionSettings }),
  };
}

const adapter: MongoRuntimeAdapterDescriptor<'mongo'> = {
  kind: 'adapter',
  id: 'test-adapter',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  codecs: newMongoCodecRegistry,
  create: () => {
    throw new Error('the stack never instantiates the adapter');
  },
};

function driverDescriptor() {
  const instance: MongoRuntimeDriverInstance<'mongo'> = {
    familyId: 'mongo',
    targetId: 'mongo',
    connect: async () => undefined,
    execute: () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    }),
    run: async () => undefined,
    close: async () => undefined,
  };
  const create = vi.fn(() => instance);
  const descriptor: RuntimeDriverDescriptor<
    'mongo',
    'mongo',
    unknown,
    MongoRuntimeDriverInstance<'mongo'>
  > = {
    kind: 'driver',
    id: 'test-driver',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    create,
  };
  return { descriptor, create, instance };
}

describe('createMongoExecutionStack', () => {
  it('creates the driver with the session settings the target declares', () => {
    const { descriptor, create, instance } = driverDescriptor();
    const stack = createMongoExecutionStack({
      target: target({ TimeZone: 'UTC' }),
      adapter,
      driver: descriptor,
    });

    expect(stack.driver.create()).toBe(instance);
    expect(create).toHaveBeenCalledWith(undefined, { TimeZone: 'UTC' });
  });

  it('creates the driver without session settings when the target declares none', () => {
    const { descriptor, create } = driverDescriptor();
    const stack = createMongoExecutionStack({ target: target(), adapter, driver: descriptor });

    stack.driver.create();

    expect(create).toHaveBeenCalledWith();
  });

  it('builds a stack without a driver when none is given', () => {
    const plainTarget = target();
    const stack = createMongoExecutionStack({ target: plainTarget, adapter });

    expect(stack).toStrictEqual({ target: plainTarget, adapter, extensions: [] });
  });
});
