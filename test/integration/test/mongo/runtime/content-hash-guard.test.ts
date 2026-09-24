import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import type { PlanMeta } from '@internal/contract/types';
import { isRuntimeError } from '@internal/framework-components/runtime';
import type { MongoDriver } from '@internal/mongo-lowering';
import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoMiddleware,
} from '@internal/mongo-runtime';
import { MongoParamRef } from '@internal/mongo-value';
import type { AnyMongoWireCommand } from '@internal/mongo-wire';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, it, vi } from 'vitest';

const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'test',
  lane: 'orm',
};

describe('Mongo runtime content hash before param resolution', () => {
  it('throws the same code when beforeQuery calls ctx.contentHash on the pre-resolve plan', async () => {
    const middleware: MongoMiddleware = {
      name: 'hash-too-early',
      async beforeQuery(plan, ctx) {
        await ctx.contentHash(plan);
      },
    };

    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract: {}, stack });
    const driver = {
      execute: vi.fn(async function* (_command: AnyMongoWireCommand) {
        yield { insertedId: 'x' };
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;
    const runtime = createMongoRuntime({
      context,
      driver,
      middleware: [middleware],
    });

    await expect(
      runtime
        .query({
          collection: 'users',
          command: new InsertOneCommand('users', { name: new MongoParamRef('Alice') }),
          meta: baseMeta,
        })
        .toArray(),
    ).rejects.toSatisfy((error) => {
      if (!isRuntimeError(error)) return false;
      return error.code === 'RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND';
    });
  });
});
