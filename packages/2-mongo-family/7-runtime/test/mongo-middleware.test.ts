import type { PlanMeta } from '@internal/contract/types';
import type { CodecCallContext } from '@internal/framework-components/codec';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoAdapter, MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import {
  AggregateWireCommand,
  type AnyMongoDmlWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@internal/mongo-wire';
import { describe, expect, it, vi } from 'vitest';
import type {
  MongoExecutionContext,
  MongoExecutionStack,
  MongoRuntimeAdapterDescriptor,
  MongoRuntimeAdapterInstance,
  MongoRuntimeTargetDescriptor,
} from '../src/mongo-execution-stack';
import type { MongoMiddleware, MongoMiddlewareContext } from '../src/mongo-middleware';
import { createMongoRuntime } from '../src/mongo-runtime';

function makeContext(
  _adapter: MongoAdapter,
  wireCommand: AnyMongoDmlWireCommand = new AggregateWireCommand('users', []),
): MongoExecutionContext {
  const codecs: MongoCodecRegistry = newMongoCodecRegistry();
  const adapterInstance: MongoRuntimeAdapterInstance<'mongo'> = {
    familyId: 'mongo',
    targetId: 'mongo',
    lower: vi.fn(
      async () => wireCommand,
    ) as unknown as MongoRuntimeAdapterInstance<'mongo'>['lower'],
    structuralLower: vi.fn(
      (plan: MongoQueryPlan): MongoLoweredDraft => ({
        kind: 'rawAggregate',
        collection: plan.collection,
        pipeline: [],
      }),
    ),
    resolveParams: vi.fn(async (_draft: MongoLoweredDraft, _ctx: CodecCallContext) => wireCommand),
  };
  const target: MongoRuntimeTargetDescriptor<'mongo'> = {
    kind: 'target',
    id: 'mongo',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: () => newMongoCodecRegistry(),
    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
  };
  const adapterDescriptor: MongoRuntimeAdapterDescriptor<'mongo'> = {
    kind: 'adapter',
    id: 'mongo',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: () => newMongoCodecRegistry(),
    create: () => adapterInstance,
  };
  const stack: MongoExecutionStack<'mongo'> = {
    target,
    adapter: adapterDescriptor,
    driver: undefined,
    extensions: [],
  };
  return Object.freeze({ contract: {}, codecs, stack, applyMutationDefaults: () => [] });
}

const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'test',
  lane: 'orm',
};

function createPlan(overrides?: Partial<MongoQueryPlan>): MongoQueryPlan {
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta: baseMeta,
    ...overrides,
  } as MongoQueryPlan;
}

function createMockAdapter(): MongoAdapter {
  return {
    lower: vi.fn((plan: MongoQueryPlan) => ({
      collection: plan.collection,
      command: plan.command,
    })),
  } as unknown as MongoAdapter;
}

function createMockDriver(rows: Record<string, unknown>[] = []): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) {
        yield row as Row;
      }
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

describe('MongoRuntime middleware lifecycle', () => {
  it('calls beforeQuery, onRow, afterQuery in order', async () => {
    const callOrder: string[] = [];
    const middleware: MongoMiddleware = {
      name: 'test',
      async beforeQuery() {
        callOrder.push('beforeQuery');
      },
      async onRow() {
        callOrder.push('onRow');
      },
      async afterQuery() {
        callOrder.push('afterQuery');
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([{ _id: '1', name: 'Alice' }]),
      middleware: [middleware],
    });

    const plan = createPlan();
    for await (const _row of runtime.query(plan)) {
      void _row;
    }

    expect(callOrder).toEqual(['beforeQuery', 'onRow', 'afterQuery']);
  });

  it('works with no middleware', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([{ _id: '1' }]),
    });

    const results: unknown[] = [];
    for await (const row of runtime.query(createPlan())) {
      results.push(row);
    }

    expect(results).toHaveLength(1);
  });

  it('intercepts execute statistics through only execute hooks', async () => {
    const calls: string[] = [];
    const contexts: MongoMiddlewareContext[] = [];
    const driver = createMockDriver([{ deletedCount: 99 }]);
    const context = makeContext(createMockAdapter(), new DeleteOneWireCommand('users', { id: 1 }));
    const runtime = createMongoRuntime({
      context,
      driver,
      middleware: [
        {
          name: 'query-only',
          async beforeQuery() {
            calls.push('beforeQuery');
          },
          async interceptQuery() {
            calls.push('interceptQuery');
            return undefined;
          },
          async afterQuery() {
            calls.push('afterQuery');
          },
        },
        {
          name: 'passthrough',
          async beforeExecute(_plan, ctx) {
            calls.push('beforeExecute');
            contexts.push(ctx);
          },
          async interceptExecute(_plan, ctx) {
            calls.push('passthrough');
            contexts.push(ctx);
            return undefined;
          },
          async afterExecute(_plan, result, ctx) {
            calls.push(`afterExecute:${result.completed ? result.stats.affectedRows : 'failed'}`);
            contexts.push(ctx);
          },
        },
        {
          name: 'winner',
          async interceptExecute(_plan, ctx) {
            calls.push('winner');
            contexts.push(ctx);
            return { stats: { affectedRows: 5 } };
          },
        },
        {
          name: 'tail',
          async interceptExecute() {
            calls.push('tail');
            return { stats: { affectedRows: 6 } };
          },
        },
      ],
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 5 });
    expect(driver.execute).not.toHaveBeenCalled();
    expect(calls).toEqual(['beforeExecute', 'passthrough', 'winner', 'afterExecute:5']);
    expect(contexts).toHaveLength(4);
    expect(contexts.every((ctx) => ctx === contexts[0])).toBe(true);
    expect(contexts[0]?.contract).toBe(context.contract);
    expect(contexts[0]?.scope).toBe('runtime');
    expect(contexts[0]?.planExecutionId).toBeTypeOf('string');
  });

  it('maps updateOne modifiedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(
        adapter,
        new UpdateOneWireCommand('users', { id: 1 }, { $set: { active: true } }),
      ),
      driver: createMockDriver([{ matchedCount: 1, modifiedCount: 1 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 1 });
  });

  it('maps update modifiedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(
        adapter,
        new UpdateManyWireCommand('users', {}, { $set: { active: true } }),
      ),
      driver: createMockDriver([{ matchedCount: 6, modifiedCount: 4 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 4 });
  });

  it('maps deleteOne deletedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter, new DeleteOneWireCommand('users', { id: 1 })),
      driver: createMockDriver([{ deletedCount: 1 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 1 });
  });

  it('maps delete deletedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter, new DeleteManyWireCommand('users', {})),
      driver: createMockDriver([{ deletedCount: 3 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 3 });
  });

  it('rejects unsupported statistics commands without a default count', async () => {
    const adapter = createMockAdapter();
    const driver = createMockDriver([{ count: 5 }]);
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver,
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_UNSUPPORTED',
    });
  });

  it('rejects zero statistics results', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter, new DeleteOneWireCommand('users', { id: 1 })),
      driver: createMockDriver([]),
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_RESULT_INVALID',
    });
  });

  it('rejects multiple statistics results', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(
        adapter,
        new UpdateOneWireCommand('users', { id: 1 }, { $set: { active: true } }),
      ),
      driver: createMockDriver([{ modifiedCount: 1 }, { modifiedCount: 2 }]),
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_RESULT_INVALID',
    });
  });

  it('rejects update statistics without modifiedCount', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(
        adapter,
        new UpdateManyWireCommand('users', {}, { $set: { active: true } }),
      ),
      driver: createMockDriver([{ matchedCount: 2 }]),
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_RESULT_INVALID',
    });
  });

  it('passes plan metadata to middleware hooks', async () => {
    const receivedMeta: PlanMeta[] = [];
    const middleware: MongoMiddleware = {
      name: 'meta-inspector',
      async beforeQuery(plan) {
        receivedMeta.push(plan.meta);
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([]),
      middleware: [middleware],
    });

    const plan = createPlan();
    for await (const _row of runtime.query(plan)) {
      void _row;
    }

    expect(receivedMeta).toHaveLength(1);
    expect(receivedMeta[0]!.target).toBe('mongo');
    expect(receivedMeta[0]!.lane).toBe('orm');
  });

  it('calls afterQuery with completed: false on error, then rethrows', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* []; // satisfy generator contract before throwing
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    let afterResult: { completed: boolean; rowCount: number } | undefined;
    const middleware: MongoMiddleware = {
      name: 'error-observer',
      async afterQuery(_plan, result) {
        afterResult = { completed: result.completed, rowCount: result.rowCount };
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: failingDriver,
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.query(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');

    expect(afterResult).toEqual({ completed: false, rowCount: 0 });
  });

  it('handles error path with middleware that has no afterQuery', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* [];
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    const beforeCalled = vi.fn();
    const middleware: MongoMiddleware = {
      name: 'no-afterQuery',
      async beforeQuery() {
        beforeCalled();
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: failingDriver,
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.query(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');

    expect(beforeCalled).toHaveBeenCalledOnce();
  });

  it('swallows afterQuery errors during error handling and rethrows the original', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* [];
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    const middleware: MongoMiddleware = {
      name: 'failing-afterQuery',
      async afterQuery() {
        throw new Error('afterQuery also fails');
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: failingDriver,
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.query(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');
  });

  it('reports correct rowCount and completed: true on success', async () => {
    let afterResult: { completed: boolean; rowCount: number } | undefined;
    const middleware: MongoMiddleware = {
      name: 'result-observer',
      async afterQuery(_plan, result) {
        afterResult = { completed: result.completed, rowCount: result.rowCount };
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([{ _id: '1' }, { _id: '2' }, { _id: '3' }]),
      middleware: [middleware],
    });

    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }

    expect(afterResult).toEqual({ completed: true, rowCount: 3 });
  });

  it('passes mode through to middleware context', async () => {
    let receivedMode: string | undefined;
    const middleware: MongoMiddleware = {
      name: 'mode-inspector',
      async beforeQuery(_plan, ctx) {
        receivedMode = ctx.mode;
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([]),
      middleware: [middleware],
      mode: 'permissive',
    });

    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }

    expect(receivedMode).toBe('permissive');
  });

  it('provides working log and now on the middleware context', async () => {
    let logWorks = false;
    const middleware: MongoMiddleware = {
      name: 'ctx-tester',
      async beforeQuery(_plan, ctx) {
        ctx.log.info('test');
        ctx.log.warn('test');
        ctx.log.error('test');
        ctx.now();
        logWorks = true;
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([]),
      middleware: [middleware],
    });

    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }

    expect(logWorks).toBe(true);
  });

  it('exposes a working contentHash on the middleware context over the resolved plan', async () => {
    const observedKeys: string[] = [];
    const middleware: MongoMiddleware = {
      name: 'content-hash-tester',
      async afterQuery(plan, _result, ctx) {
        observedKeys.push(await ctx.contentHash(plan));
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([{ _id: '1' }, { _id: '2' }, { _id: '3' }]),
      middleware: [middleware],
    });

    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }
    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }

    expect(observedKeys).toHaveLength(2);
    expect(observedKeys[0]).toMatch(/^sha512:[0-9a-f]{128}$/);
    expect(observedKeys[0]).toBe(observedKeys[1]);
  });
});

describe('MongoRuntime planExecutionId (ADR 220)', () => {
  interface Observation {
    readonly hook: 'beforeQuery' | 'afterQuery';
    readonly planExecutionId: string;
  }

  function observerMiddleware(log: Observation[]): MongoMiddleware {
    return {
      name: 'observer',
      async beforeQuery(_plan, ctx) {
        log.push({ hook: 'beforeQuery', planExecutionId: ctx.planExecutionId });
      },
      async afterQuery(_plan, _result, ctx) {
        log.push({ hook: 'afterQuery', planExecutionId: ctx.planExecutionId });
      },
    };
  }

  it('assigns the same planExecutionId to beforeQuery and afterQuery within one query call', async () => {
    const log: Observation[] = [];
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([{ _id: '1' }]),
      middleware: [observerMiddleware(log)],
    });

    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }

    expect(log).toHaveLength(2);
    expect(log[0]?.hook).toBe('beforeQuery');
    expect(log[1]?.hook).toBe('afterQuery');
    expect(log[0]?.planExecutionId).toBeTypeOf('string');
    expect(log[0]?.planExecutionId).toBe(log[1]?.planExecutionId);
  });

  it('assigns distinct planExecutionIds to two queries of the same plan instance', async () => {
    const log: Observation[] = [];
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: createMockDriver([{ _id: '1' }]),
      middleware: [observerMiddleware(log)],
    });

    const plan = createPlan();
    for await (const _row of runtime.query(plan)) {
      void _row;
    }
    for await (const _row of runtime.query(plan)) {
      void _row;
    }

    expect(log).toHaveLength(4);
    expect(log[0]?.planExecutionId).toBe(log[1]?.planExecutionId);
    expect(log[2]?.planExecutionId).toBe(log[3]?.planExecutionId);
    expect(log[0]?.planExecutionId).not.toBe(log[2]?.planExecutionId);
  });
});

describe('MongoRuntime middleware compatibility validation', () => {
  it('accepts a generic middleware (no familyId)', () => {
    const middleware: MongoMiddleware = { name: 'generic' };
    expect(() =>
      createMongoRuntime({
        context: makeContext(createMockAdapter()),
        driver: createMockDriver(),
        middleware: [middleware],
      }),
    ).not.toThrow();
  });

  it('accepts a mongo middleware', () => {
    const middleware: MongoMiddleware = { name: 'mongo-specific', familyId: 'mongo' };
    expect(() =>
      createMongoRuntime({
        context: makeContext(createMockAdapter()),
        driver: createMockDriver(),
        middleware: [middleware],
      }),
    ).not.toThrow();
  });

  it('rejects a SQL middleware with a clear error', () => {
    // Intentionally misconfigured to verify the runtime rejects mismatched familyId. The static type narrows familyId to 'mongo' | undefined, so we cast to bypass the type check and exercise the runtime path.
    const middleware = {
      name: 'sql-lints',
      familyId: 'sql' as const,
    } as unknown as MongoMiddleware;
    expect(() =>
      createMongoRuntime({
        context: makeContext(createMockAdapter()),
        driver: createMockDriver(),
        middleware: [middleware],
      }),
    ).toThrow(
      "Middleware 'sql-lints' requires family 'sql' but the runtime is configured for family 'mongo'",
    );
  });
});
