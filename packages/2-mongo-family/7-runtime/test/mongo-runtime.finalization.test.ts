import type { PlanMeta } from '@internal/contract/types';
import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import type {
  ActivityEndedResult,
  ActivityFinalizedResult,
} from '@internal/framework-components/runtime';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter, MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import type { MongoExecutionContext, MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import {
  AggregateWireCommand,
  type AnyMongoDmlWireCommand,
  DeleteOneWireCommand,
} from '@internal/mongo-wire';
import { describe, expect, it, vi } from 'vitest';
import type { MongoMiddleware, MongoMiddlewareContext } from '../src/mongo-middleware';
import { createMongoRuntime } from '../src/mongo-runtime';
import { testContract } from './mongo-middleware-fixtures';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

interface HookEvent {
  readonly name: 'ended' | 'finalized';
  readonly activityId: string;
  readonly ctx: MongoMiddlewareContext;
  readonly outcome: ActivityEndedResult['outcome'] | ActivityFinalizedResult['outcome'];
}

const meta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'test',
  lane: 'orm',
};

const plan = {
  collection: 'users',
  command: { kind: 'find', filter: {} },
  meta,
} as unknown as MongoQueryPlan;

const failingDecodePlan = {
  ...plan,
  resultShape: {
    kind: 'document',
    fields: { name: { kind: 'leaf', codecId: 'test/failing-decode@1', nullable: false } },
  },
} as unknown as MongoQueryPlan;

function codecsWithFailingDecode() {
  const registry = newMongoCodecRegistry();
  registry.register(
    mongoCodec({
      typeId: 'test/failing-decode@1',
      fromWire: (): string => {
        throw new Error('decode failed');
      },
      toWire: (value: string) => value,
      dataType: textType,
      fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
    }),
  );
  return registry;
}

function makeExecution(
  wireCommand: AnyMongoDmlWireCommand,
  onResolveParams: () => void = () => {},
): { readonly context: MongoExecutionContext<MongoContract>; readonly adapter: MongoAdapter } {
  const adapter = {
    familyId: 'mongo',
    targetId: 'mongo',
    lower: vi.fn(async () => wireCommand),
    structuralLower: vi.fn(
      (queryPlan: MongoQueryPlan): MongoLoweredDraft => ({
        kind: 'rawAggregate',
        collection: queryPlan.collection,
        pipeline: [],
      }),
    ),
    resolveParams: vi.fn(async () => {
      onResolveParams();
      return wireCommand;
    }),
  } as unknown as MongoAdapter;
  return {
    context: {
      contract: testContract,
      codecs: codecsWithFailingDecode(),
      applyMutationDefaults: () => [],
    },
    adapter,
  };
}

function createDriver(results: Record<string, unknown>[], failure?: Error): MongoDriver {
  return {
    execute: vi.fn(async function* () {
      yield* results;
      if (failure) throw failure;
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

function recorder(events: HookEvent[]): MongoMiddleware {
  return {
    name: 'recorder',
    async activityEnded(activity, result, ctx) {
      events.push({ name: 'ended', activityId: activity.id, ctx, outcome: result.outcome });
    },
    async activityFinalized(activity, result, ctx) {
      events.push({ name: 'finalized', activityId: activity.id, ctx, outcome: result.outcome });
    },
  };
}

async function drain(rows: AsyncIterable<unknown>): Promise<void> {
  for await (const _row of rows) {
    void _row;
  }
}

function expectFinalizedRightAfterEnd(
  events: HookEvent[],
  ended: ActivityEndedResult['outcome'],
  finalized: ActivityFinalizedResult['outcome'],
): void {
  expect(events.map(({ name, outcome }) => ({ name, outcome }))).toEqual([
    { name: 'ended', outcome: ended },
    { name: 'finalized', outcome: finalized },
  ]);
  expect(events[1]?.activityId).toBe(events[0]?.activityId);
  expect(events[1]?.ctx).toBe(events[0]?.ctx);
  expect(events[0]?.ctx.parent).toBeUndefined();
  expect(events[0]?.ctx.inTransaction()).toBe(false);
}

describe('MongoRuntime statement finalization', () => {
  describe('query', () => {
    it('finalizes a query committed right after it ends', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        ...makeExecution(new AggregateWireCommand('users', [])),
        driver: createDriver([{ _id: '1' }, { _id: '2' }]),
        middleware: [recorder(events)],
      });

      await drain(runtime.query(plan));

      expectFinalizedRightAfterEnd(events, 'succeeded', 'committed');
    });

    it('finalizes a query unknown right after it fails when the driver throws', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        ...makeExecution(new AggregateWireCommand('users', [])),
        driver: createDriver([{ _id: '1' }], new Error('driver failure')),
        middleware: [recorder(events)],
      });

      await expect(drain(runtime.query(plan))).rejects.toThrow('driver failure');

      expectFinalizedRightAfterEnd(events, 'failed', 'unknown');
    });

    it('ends a query stopped and finalizes it unknown when the caller stops reading early', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        ...makeExecution(new AggregateWireCommand('users', [])),
        driver: createDriver([{ _id: '1' }, { _id: '2' }]),
        middleware: [recorder(events)],
      });

      for await (const _row of runtime.query(plan)) {
        void _row;
        break;
      }

      expectFinalizedRightAfterEnd(events, 'stopped', 'unknown');
    });

    it('finalizes a query unknown when a row fails to decode', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        ...makeExecution(new AggregateWireCommand('users', [])),
        driver: createDriver([{ name: 'alice' }]),
        middleware: [recorder(events)],
      });

      await expect(drain(runtime.query(failingDecodePlan))).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
      });

      expectFinalizedRightAfterEnd(events, 'failed', 'unknown');
    });

    it('finalizes a query unknown when the signal aborts between rows', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        ...makeExecution(new AggregateWireCommand('users', [])),
        driver: createDriver([{ _id: '1' }, { _id: '2' }]),
        middleware: [recorder(events)],
      });
      const controller = new AbortController();

      await expect(
        (async () => {
          for await (const _row of runtime.query(plan, { signal: controller.signal })) {
            controller.abort();
          }
        })(),
      ).rejects.toMatchObject({ code: 'RUNTIME.ABORTED' });

      expectFinalizedRightAfterEnd(events, 'failed', 'unknown');
    });
  });

  describe('execute', () => {
    it('finalizes an execute committed right after it ends', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        ...makeExecution(new DeleteOneWireCommand('users', { id: 1 })),
        driver: createDriver([{ deletedCount: 1 }]),
        middleware: [recorder(events)],
      });

      await expect(runtime.execute(plan)).resolves.toEqual({ affectedRows: 1 });

      expectFinalizedRightAfterEnd(events, 'succeeded', 'committed');
    });

    it('finalizes an execute unknown when the driver throws', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        ...makeExecution(new DeleteOneWireCommand('users', { id: 1 })),
        driver: createDriver([], new Error('driver failure')),
        middleware: [recorder(events)],
      });

      await expect(runtime.execute(plan)).rejects.toThrow('driver failure');

      expectFinalizedRightAfterEnd(events, 'failed', 'unknown');
    });

    it('finalizes an execute unknown when the signal aborts after the plan is encoded', async () => {
      const events: HookEvent[] = [];
      const controller = new AbortController();
      const runtime = createMongoRuntime({
        ...makeExecution(new DeleteOneWireCommand('users', { id: 1 }), () => controller.abort()),
        driver: createDriver([{ deletedCount: 1 }]),
        middleware: [recorder(events)],
      });

      await expect(runtime.execute(plan, { signal: controller.signal })).rejects.toMatchObject({
        code: 'RUNTIME.ABORTED',
      });

      expectFinalizedRightAfterEnd(events, 'failed', 'unknown');
    });
  });

  it.each([
    ['query', (runtime: ReturnType<typeof createMongoRuntime>) => drain(runtime.query(plan))],
    ['execute', (runtime: ReturnType<typeof createMongoRuntime>) => runtime.execute(plan)],
  ])('ends a %s failed and finalizes it unknown when beforeEncode throws', async (_name, run) => {
    const events: HookEvent[] = [];
    const failingBeforeHook: MongoMiddleware = {
      name: 'failing-before-hook',
      async beforeEncode() {
        throw new Error('before-hook failed');
      },
    };
    const runtime = createMongoRuntime({
      ...makeExecution(new DeleteOneWireCommand('users', { id: 1 })),
      driver: createDriver([{ deletedCount: 1 }]),
      middleware: [failingBeforeHook, recorder(events)],
    });

    await expect(run(runtime)).rejects.toThrow('before-hook failed');

    expectFinalizedRightAfterEnd(events, 'failed', 'unknown');
  });
});
