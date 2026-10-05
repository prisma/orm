import type { PlanMeta } from '@internal/contract/types';
import type { AfterTransactionResult } from '@internal/framework-components/runtime';
import { newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoAdapter, MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import {
  AggregateWireCommand,
  type AnyMongoDmlWireCommand,
  DeleteOneWireCommand,
} from '@internal/mongo-wire';
import { describe, expect, it, vi } from 'vitest';
import type { MongoExecutionPlan } from '../src/mongo-execution-plan';
import type { MongoExecutionContext } from '../src/mongo-execution-stack';
import type { MongoMiddleware } from '../src/mongo-middleware';
import { createMongoRuntime } from '../src/mongo-runtime';

interface HookEvent {
  readonly name: string;
  readonly plan: MongoExecutionPlan;
  readonly planExecutionId: string;
  readonly outcome?: AfterTransactionResult['outcome'];
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

function makeContext(wireCommand: AnyMongoDmlWireCommand): MongoExecutionContext {
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
    resolveParams: vi.fn(async () => wireCommand),
  } as unknown as MongoAdapter;
  return {
    contract: {},
    codecs: newMongoCodecRegistry(),
    stack: {
      target: {
        kind: 'target',
        id: 'mongo',
        familyId: 'mongo',
        targetId: 'mongo',
        version: '0.0.1',
        codecs: () => newMongoCodecRegistry(),
        create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
      },
      adapter: {
        kind: 'adapter',
        id: 'mongo',
        familyId: 'mongo',
        targetId: 'mongo',
        version: '0.0.1',
        codecs: () => newMongoCodecRegistry(),
        create: () => adapter,
      },
      driver: undefined,
      extensions: [],
    },
    applyMutationDefaults: () => [],
  } as unknown as MongoExecutionContext;
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

function recorder(
  events: HookEvent[],
): Required<Pick<MongoMiddleware, 'afterTransaction'>> & MongoMiddleware {
  const record = (
    name: string,
    exec: MongoExecutionPlan,
    planExecutionId: string,
    outcome?: AfterTransactionResult['outcome'],
  ) => {
    events.push({ name, plan: exec, planExecutionId, ...(outcome ? { outcome } : {}) });
  };
  return {
    name: 'recorder',
    async afterQuery(exec, _result, ctx) {
      record('afterQuery', exec, ctx.planExecutionId);
    },
    async afterExecute(exec, _result, ctx) {
      record('afterExecute', exec, ctx.planExecutionId);
    },
    async afterTransaction(exec, result, ctx) {
      record('afterTransaction', exec, ctx.planExecutionId, result.outcome);
    },
  };
}

async function drain(rows: AsyncIterable<unknown>): Promise<void> {
  for await (const _row of rows) {
    void _row;
  }
}

function expectStageRightAfter(events: HookEvent[], afterHook: string): void {
  expect(events.map(({ name, outcome }) => ({ name, outcome }))).toEqual([
    { name: afterHook, outcome: undefined },
    { name: 'afterTransaction', outcome: 'committed' },
  ]);
  expect(events[1]?.plan).toBe(events[0]?.plan);
  expect(events[1]?.planExecutionId).toBe(events[0]?.planExecutionId);
}

describe('MongoRuntime afterTransaction stage', () => {
  describe('query', () => {
    it('fires committed once right after afterQuery', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        context: makeContext(new AggregateWireCommand('users', [])),
        driver: createDriver([{ _id: '1' }, { _id: '2' }]),
        middleware: [recorder(events)],
      });

      await drain(runtime.query(plan));

      expectStageRightAfter(events, 'afterQuery');
    });

    it('fires committed once right after afterQuery when the driver throws', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        context: makeContext(new AggregateWireCommand('users', [])),
        driver: createDriver([{ _id: '1' }], new Error('driver failure')),
        middleware: [recorder(events)],
      });

      await expect(drain(runtime.query(plan))).rejects.toThrow('driver failure');

      expectStageRightAfter(events, 'afterQuery');
    });

    it('fires nothing when the caller stops reading the rows early', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        context: makeContext(new AggregateWireCommand('users', [])),
        driver: createDriver([{ _id: '1' }, { _id: '2' }]),
        middleware: [recorder(events)],
      });

      for await (const _row of runtime.query(plan)) {
        void _row;
        break;
      }

      expect(events).toEqual([]);
    });
  });

  describe('execute', () => {
    it('fires committed once right after afterExecute', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        context: makeContext(new DeleteOneWireCommand('users', { id: 1 })),
        driver: createDriver([{ deletedCount: 1 }]),
        middleware: [recorder(events)],
      });

      await expect(runtime.execute(plan)).resolves.toEqual({ affectedRows: 1 });

      expectStageRightAfter(events, 'afterExecute');
    });

    it('fires committed once right after afterExecute when the driver throws', async () => {
      const events: HookEvent[] = [];
      const runtime = createMongoRuntime({
        context: makeContext(new DeleteOneWireCommand('users', { id: 1 })),
        driver: createDriver([], new Error('driver failure')),
        middleware: [recorder(events)],
      });

      await expect(runtime.execute(plan)).rejects.toThrow('driver failure');

      expectStageRightAfter(events, 'afterExecute');
    });
  });
});

describe('MongoRuntime whose middleware do not declare afterTransaction', () => {
  function createRuntimeThatDeclaresAfterTransactionLate(
    events: HookEvent[],
    wireCommand: AnyMongoDmlWireCommand,
    results: Record<string, unknown>[],
  ) {
    const { afterTransaction, ...withoutAfterTransaction } = recorder(events);
    const middleware: MongoMiddleware = withoutAfterTransaction;
    const runtime = createMongoRuntime({
      context: makeContext(wireCommand),
      driver: createDriver(results),
      middleware: [middleware],
    });
    middleware.afterTransaction = afterTransaction;
    return runtime;
  }

  it('runs afterQuery and no stage for a query', async () => {
    const events: HookEvent[] = [];
    const runtime = createRuntimeThatDeclaresAfterTransactionLate(
      events,
      new AggregateWireCommand('users', []),
      [{ _id: '1' }, { _id: '2' }],
    );

    await expect(runtime.query(plan).toArray()).resolves.toEqual([{ _id: '1' }, { _id: '2' }]);

    expect(events.map(({ name }) => name)).toEqual(['afterQuery']);
  });

  it('runs afterExecute and no stage for an execute', async () => {
    const events: HookEvent[] = [];
    const runtime = createRuntimeThatDeclaresAfterTransactionLate(
      events,
      new DeleteOneWireCommand('users', { id: 1 }),
      [{ deletedCount: 1 }],
    );

    await expect(runtime.execute(plan)).resolves.toEqual({ affectedRows: 1 });

    expect(events.map(({ name }) => name)).toEqual(['afterExecute']);
  });
});
