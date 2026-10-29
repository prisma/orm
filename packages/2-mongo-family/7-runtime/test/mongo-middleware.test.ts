import type { PlanMeta } from '@internal/contract/types';
import type { MongoDriver } from '@internal/mongo-lowering';
import { DeleteOneWireCommand } from '@internal/mongo-wire';
import { describe, expect, it, vi } from 'vitest';
import type { MongoMiddleware, MongoMiddlewareContext } from '../src/mongo-middleware';
import { createMongoRuntime } from '../src/mongo-runtime';
import {
  createMockAdapter,
  createMockDriver,
  createPlan,
  makeExecution,
} from './mongo-middleware-fixtures';

describe('MongoRuntime middleware lifecycle', () => {
  it('calls activityStarted, beforeEncode, onQuery, onRow, activityEnded, activityFinalized in order', async () => {
    const callOrder: string[] = [];
    const middleware: MongoMiddleware = {
      name: 'test',
      async activityStarted() {
        callOrder.push('activityStarted');
      },
      async beforeEncode() {
        callOrder.push('beforeEncode');
      },
      intercept: {
        async onQuery() {
          callOrder.push('onQuery');
          return undefined;
        },
      },
      async onRow() {
        callOrder.push('onRow');
      },
      async activityEnded() {
        callOrder.push('activityEnded');
      },
      async activityFinalized(_activity, result) {
        callOrder.push(`activityFinalized:${result.outcome}`);
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
      driver: createMockDriver([{ _id: '1', name: 'Alice' }]),
      middleware: [middleware],
    });

    const plan = createPlan();
    for await (const _row of runtime.query(plan)) {
      void _row;
    }

    expect(callOrder).toEqual([
      'activityStarted',
      'beforeEncode',
      'onQuery',
      'onRow',
      'activityEnded',
      'activityFinalized:committed',
    ]);
  });

  it('works with no middleware', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
      driver: createMockDriver([{ _id: '1' }]),
    });

    const results: unknown[] = [];
    for await (const row of runtime.query(createPlan())) {
      results.push(row);
    }

    expect(results).toHaveLength(1);
  });

  it('checks middleware against the target named by the context contract', () => {
    const execution = makeExecution(createMockAdapter());
    const driver = createMockDriver();
    const middlewareFor = (targetId: string): MongoMiddleware => ({
      name: `for-${targetId}`,
      familyId: 'mongo',
      targetId,
    });

    expect(() =>
      createMongoRuntime({ ...execution, driver, middleware: [middlewareFor('mongo')] }),
    ).not.toThrow();
    expect(() =>
      createMongoRuntime({ ...execution, driver, middleware: [middlewareFor('other')] }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.MIDDLEWARE_TARGET_MISMATCH' }));
  });

  it('intercepts execute statistics through intercept.onExecute only', async () => {
    const calls: string[] = [];
    const contexts: MongoMiddlewareContext[] = [];
    const driver = createMockDriver([{ deletedCount: 99 }]);
    const { context, adapter } = makeExecution(
      createMockAdapter(),
      new DeleteOneWireCommand('users', { id: 1 }),
    );
    const runtime = createMongoRuntime({
      context,
      adapter,
      driver,
      middleware: [
        {
          name: 'query-only',
          intercept: {
            async onQuery() {
              calls.push('onQuery');
              return undefined;
            },
          },
        },
        {
          name: 'passthrough',
          async beforeEncode(_plan, ctx) {
            calls.push('beforeEncode');
            contexts.push(ctx);
          },
          intercept: {
            async onExecute(_plan, ctx) {
              calls.push('passthrough');
              contexts.push(ctx);
              return undefined;
            },
          },
          async activityEnded(_activity, result, ctx) {
            calls.push(
              `ended:${result.kind === 'statement' && result.returns === 'stats' ? result.stats?.affectedRows : 'rows'}`,
            );
            contexts.push(ctx);
          },
        },
        {
          name: 'winner',
          intercept: {
            async onExecute(_plan, ctx) {
              calls.push('winner');
              contexts.push(ctx);
              return { stats: { affectedRows: 5 } };
            },
          },
        },
        {
          name: 'tail',
          intercept: {
            async onExecute() {
              calls.push('tail');
              return { stats: { affectedRows: 6 } };
            },
          },
        },
      ],
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 5 });
    expect(driver.execute).not.toHaveBeenCalled();
    expect(calls).toEqual(['beforeEncode', 'passthrough', 'winner', 'ended:5']);
    expect(contexts).toHaveLength(4);
    expect(contexts.every((ctx) => ctx === contexts[0])).toBe(true);
    expect(contexts[0]?.contract).toBe(context.contract);
    expect(contexts[0]?.scope).toBe('runtime');
    expect(contexts[0]?.parent).toBeUndefined();
  });

  it('passes plan metadata to middleware hooks', async () => {
    const receivedMeta: PlanMeta[] = [];
    const middleware: MongoMiddleware = {
      name: 'meta-inspector',
      async beforeEncode(plan) {
        receivedMeta.push(plan.meta);
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
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

  it('ends the statement failed on error, then rethrows', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* []; // satisfy generator contract before throwing
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    let afterResult: { outcome: string; rowCount: number } | undefined;
    const middleware: MongoMiddleware = {
      name: 'error-observer',
      async activityEnded(_activity, result) {
        if (result.kind === 'statement' && result.returns === 'rows') {
          afterResult = { outcome: result.outcome, rowCount: result.rowCount };
        }
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
      driver: failingDriver,
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.query(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');

    expect(afterResult).toEqual({ outcome: 'failed', rowCount: 0 });
  });

  it('handles error path with middleware that has no activityEnded', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* [];
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    const beforeCalled = vi.fn();
    const middleware: MongoMiddleware = {
      name: 'no-activityEnded',
      async beforeEncode() {
        beforeCalled();
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
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

  it('swallows activityEnded errors during error handling and rethrows the original', async () => {
    const failingDriver = {
      execute: vi.fn(async function* () {
        yield* [];
        throw new Error('driver failure');
      }),
      close: vi.fn(async () => {}),
    } as unknown as MongoDriver;

    const middleware: MongoMiddleware = {
      name: 'failing-activityEnded',
      async activityEnded() {
        throw new Error('activityEnded also fails');
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
      driver: failingDriver,
      middleware: [middleware],
    });

    await expect(async () => {
      for await (const _row of runtime.query(createPlan())) {
        void _row;
      }
    }).rejects.toThrow('driver failure');
  });

  it('reports the row count and a succeeded outcome on success', async () => {
    let afterResult: { outcome: string; rowCount: number } | undefined;
    const middleware: MongoMiddleware = {
      name: 'result-observer',
      async activityEnded(_activity, result) {
        if (result.kind === 'statement' && result.returns === 'rows') {
          afterResult = { outcome: result.outcome, rowCount: result.rowCount };
        }
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
      driver: createMockDriver([{ _id: '1' }, { _id: '2' }, { _id: '3' }]),
      middleware: [middleware],
    });

    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }

    expect(afterResult).toEqual({ outcome: 'succeeded', rowCount: 3 });
  });

  it('passes mode through to middleware context', async () => {
    let receivedMode: string | undefined;
    const middleware: MongoMiddleware = {
      name: 'mode-inspector',
      async beforeEncode(_plan, ctx) {
        receivedMode = ctx.mode;
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
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
      async beforeEncode(_plan, ctx) {
        ctx.log.info('test');
        ctx.log.warn('test');
        ctx.log.error('test');
        ctx.now();
        logWorks = true;
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
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
      intercept: {
        async onQuery(plan, ctx) {
          observedKeys.push(await ctx.contentHash(plan));
          return undefined;
        },
      },
    };

    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
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
