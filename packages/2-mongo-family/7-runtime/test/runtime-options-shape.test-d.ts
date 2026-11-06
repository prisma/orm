import type { MongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter } from '@internal/mongo-lowering';
import { expectTypeOf, test } from 'vitest';
import type {
  MongoExecutionContext,
  MongoExecutionStack,
  MongoRuntimeOptions,
} from '../src/exports/index';
import { createMongoRuntime } from '../src/mongo-runtime';

declare const ctx: MongoExecutionContext<MongoContract>;
declare const adapter: MongoAdapter;
declare const stack: MongoExecutionStack;

test('the runtime takes the adapter beside the context, as the SQL runtime does', () => {
  expectTypeOf<MongoExecutionContext>().not.toHaveProperty('stack');
  expectTypeOf<MongoRuntimeOptions['adapter']>().toEqualTypeOf<MongoAdapter>();
  expectTypeOf<MongoExecutionStack>().not.toHaveProperty('driver');
});

test('runtime options accept only context, adapter, driver, middleware, and mode', () => {
  createMongoRuntime({ context: ctx, adapter, driver: {} as never });

  const validOptions = {
    context: ctx,
    adapter,
    driver: {} as never,
    middleware: [
      {
        name: 'middleware',
        familyId: 'mongo',
        async beforeEncode() {},
      },
    ],
    mode: 'permissive',
  } satisfies MongoRuntimeOptions;

  createMongoRuntime(validOptions);

  createMongoRuntime({
    context: ctx,
    adapter,
    driver: {} as never,
    // @ts-expect-error `codecs` is not a property of MongoRuntimeOptions —
    // codecs are aggregated via `createMongoExecutionContext` and reached
    // through `context.codecs`.
    codecs: {} as MongoCodecRegistry,
  });

  createMongoRuntime({
    context: ctx,
    adapter,
    driver: {} as never,
    // @ts-expect-error `stack` is not a property of MongoRuntimeOptions —
    // the client creates the adapter from its stack and passes the adapter.
    stack,
  });

  createMongoRuntime({
    context: ctx,
    adapter,
    driver: {} as never,
    // @ts-expect-error `targetId` is not a property of MongoRuntimeOptions —
    // the target is read from `context.contract.target`.
    targetId: 'mongo',
  });

  createMongoRuntime({
    context: ctx,
    adapter,
    driver: {} as never,
    // @ts-expect-error `contract` is not a property of MongoRuntimeOptions —
    // the contract is reached via `context.contract`.
    contract: {},
  });
});
