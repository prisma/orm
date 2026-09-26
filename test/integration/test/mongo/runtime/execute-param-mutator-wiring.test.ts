import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import type { PlanMeta } from '@internal/contract/types';
import type { CodecCallContext } from '@internal/framework-components/codec';
import type { MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import type { MongoMiddleware } from '@internal/mongo-runtime';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoExecutionContext,
} from '@internal/mongo-runtime';
import { MongoParamRef } from '@internal/mongo-value';
import type { AnyMongoWireCommand } from '@internal/mongo-wire';
import { InsertOneWireCommand } from '@internal/mongo-wire';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, it, vi } from 'vitest';

const BULK_CODEC_ID = 'test/bulk-transform';

const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'test',
  lane: 'orm',
};

function buildStackContext(): MongoExecutionContext {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
  });
  return createMongoExecutionContext({ contract: {}, stack });
}

function recordingDriver(): {
  driver: MongoDriver;
  commands: AnyMongoWireCommand[];
} {
  const commands: AnyMongoWireCommand[] = [];
  const driver = {
    execute: vi.fn(async function* (command: AnyMongoWireCommand) {
      commands.push(command);
      yield { insertedId: 'stub-id' };
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
  return { driver, commands };
}

describe('MongoRuntime execute param-mutator wiring', () => {
  it('beforeQuery entries expose pre-resolve MongoParamRef handles', async () => {
    const observed: Array<{ readonly isParamRef: boolean; readonly codecId: string | undefined }> =
      [];
    const middleware: MongoMiddleware = {
      name: 'param-inspector',
      async beforeQuery(_plan, _ctx, params) {
        for (const entry of params?.entries() ?? []) {
          observed.push({
            isParamRef: entry.ref instanceof MongoParamRef,
            codecId: entry.codecId,
          });
        }
      },
    };

    const { driver } = recordingDriver();
    const runtime = createMongoRuntime({
      context: buildStackContext(),
      driver,
      middleware: [middleware],
    });

    const secretRef = new MongoParamRef('secret', { codecId: BULK_CODEC_ID });
    await runtime
      .query({
        collection: 'users',
        command: new InsertOneCommand('users', { token: secretRef }),
        meta: baseMeta,
      })
      .toArray();

    expect(observed).toEqual([{ isParamRef: true, codecId: BULK_CODEC_ID }]);
  });

  it('bulk-pattern middleware mutates codec-tagged params before the driver runs', async () => {
    const bulkTransform = vi.fn(async (values: readonly unknown[]) =>
      values.map((v) => `bulk:${String(v)}`),
    );

    const middleware: MongoMiddleware = {
      name: 'bulk-transform',
      async beforeQuery(_plan, _ctx, params) {
        const targets = [...(params?.entries() ?? [])].filter(
          (entry) => entry.codecId === BULK_CODEC_ID,
        );
        const transformed = await bulkTransform(targets.map((entry) => entry.value));
        params?.replaceValues(
          targets.map((entry, index) => ({
            ref: entry.ref,
            newValue: transformed[index],
          })),
        );
      },
    };

    const { driver, commands } = recordingDriver();
    const runtime = createMongoRuntime({
      context: buildStackContext(),
      driver,
      middleware: [middleware],
    });

    await runtime
      .query({
        collection: 'users',
        command: new InsertOneCommand('users', {
          token: new MongoParamRef('alpha', { codecId: BULK_CODEC_ID }),
          note: new MongoParamRef('plain'),
        }),
        meta: baseMeta,
      })
      .toArray();

    expect(bulkTransform).toHaveBeenCalledOnce();
    expect(bulkTransform).toHaveBeenCalledWith(['alpha']);
    expect(commands).toHaveLength(1);
    const cmd = commands[0];
    expect(cmd).toBeInstanceOf(InsertOneWireCommand);
    if (cmd instanceof InsertOneWireCommand) {
      expect(cmd.document).toMatchObject({ token: 'bulk:alpha', note: 'plain' });
    }
  });

  it('resolveParams receives the original draft by reference when middleware does not mutate', async () => {
    let structuralDraft: MongoLoweredDraft | undefined;
    const resolveDraftRefs: MongoLoweredDraft[] = [];

    const context = buildStackContext();
    const adapterInstance = context.stack.adapter.create(context.stack);
    const structuralLowerSpy = vi.fn((plan) => {
      structuralDraft = adapterInstance.structuralLower(plan);
      return structuralDraft;
    });
    const resolveParamsSpy = vi.fn(async (draft: MongoLoweredDraft, ctx: CodecCallContext) => {
      resolveDraftRefs.push(draft);
      return adapterInstance.resolveParams(draft, ctx);
    });

    const patchedStack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: {
        ...mongoRuntimeAdapter,
        create: () => ({
          ...adapterInstance,
          structuralLower: structuralLowerSpy,
          resolveParams: resolveParamsSpy,
        }),
      },
    });
    const patchedContext = createMongoExecutionContext({ contract: {}, stack: patchedStack });

    const { driver } = recordingDriver();
    const runtime = createMongoRuntime({ context: patchedContext, driver });

    await runtime
      .query({
        collection: 'users',
        command: new InsertOneCommand('users', { name: new MongoParamRef('Alice') }),
        meta: baseMeta,
      })
      .toArray();

    expect(structuralDraft).toBeDefined();
    expect(resolveDraftRefs).toHaveLength(1);
    expect(resolveDraftRefs[0]).toBe(structuralDraft);
  });

  it('content hash reflects middleware-mutated resolved values', async () => {
    const mutating: MongoMiddleware = {
      name: 'mutator',
      async beforeQuery(_plan, _ctx, params) {
        const updates = [...(params?.entries() ?? [])].map((entry) => ({
          ref: entry.ref,
          newValue: `mutated:${String(entry.value)}`,
        }));
        params?.replaceValues(updates);
      },
    };

    const identity: MongoMiddleware = {
      name: 'identity',
    };

    async function hashAfterExecute(middleware: MongoMiddleware): Promise<string> {
      let hash = '';
      const observer: MongoMiddleware = {
        name: 'hash-observer',
        async afterQuery(plan, _result, ctx) {
          hash = await ctx.contentHash(plan);
        },
      };
      const { driver } = recordingDriver();
      const runtime = createMongoRuntime({
        context: buildStackContext(),
        driver,
        middleware: [middleware, observer],
      });
      await runtime
        .query({
          collection: 'users',
          command: new InsertOneCommand('users', { label: new MongoParamRef('same') }),
          meta: baseMeta,
        })
        .toArray();
      return hash;
    }

    const hashMutated = await hashAfterExecute(mutating);
    const hashIdentity = await hashAfterExecute(identity);
    expect(hashMutated).not.toBe(hashIdentity);
  });
});
