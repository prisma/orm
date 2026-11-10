import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import { RuntimeCore } from '../src/execution/runtime-core';
import type {
  ActivityContext,
  ActivityContextFields,
  RuntimeMiddleware,
} from '../src/execution/runtime-middleware';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test',
  lane: 'raw-sql',
};

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface MockPlan<Row = Record<string, unknown>> extends QueryPlan<Row> {
  readonly draftId: string;
}

interface MockExec<Row = Record<string, unknown>> extends ExecutionPlan<Row> {
  readonly compiledId: string;
}

interface RecorderEntry {
  readonly stage:
    | 'runBeforeCompile'
    | 'lower'
    | 'runDriver'
    | 'runExecute'
    | 'activityStarted'
    | 'beforeEncode'
    | 'onRow'
    | 'activityEnded'
    | 'activityFinalized';
  readonly label?: string;
}

class MockRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
  readonly events: RecorderEntry[] = [];

  constructor(
    middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
    ctx: ActivityContextFields,
    private readonly rows: ReadonlyArray<Record<string, unknown>>,
  ) {
    super({ middleware, ctx });
  }

  protected override runBeforeCompile(plan: MockPlan): MockPlan {
    this.events.push({ stage: 'runBeforeCompile' });
    return plan;
  }

  protected lower(plan: MockPlan): MockExec {
    this.events.push({ stage: 'lower' });
    return { compiledId: plan.draftId, meta: plan.meta };
  }

  protected runDriver(_exec: MockExec): AsyncIterable<Record<string, unknown>> {
    this.events.push({ stage: 'runDriver' });
    const rows = this.rows;
    const iter = {
      async *[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        for (const row of rows) {
          yield row;
        }
      },
    };
    return iter;
  }

  protected async runExecute(_exec: MockExec): Promise<{ affectedRows: number }> {
    this.events.push({ stage: 'runExecute' });
    return { affectedRows: 3 };
  }

  async close(): Promise<void> {}
}

function recorder(label: string, log: RecorderEntry[]): RuntimeMiddleware<MockExec> {
  return {
    name: label,
    async activityStarted() {
      log.push({ stage: 'activityStarted', label });
    },
    async beforeEncode() {
      log.push({ stage: 'beforeEncode', label });
    },
    async onRow() {
      log.push({ stage: 'onRow', label });
    },
    async activityEnded() {
      log.push({ stage: 'activityEnded', label });
    },
    async activityFinalized() {
      log.push({ stage: 'activityFinalized', label });
    },
  };
}

const ctx: ActivityContextFields = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  contentHash: async () => 'mock-hash',
  scope: 'runtime',
};

describe('RuntimeCore', () => {
  it('executes the lifecycle in order with a single middleware', async () => {
    const log: RecorderEntry[] = [];
    const runtime = new MockRuntime([recorder('A', log)], ctx, [{ id: 1 }]);

    const plan: MockPlan = { draftId: 'd-1', meta };
    const out = await runtime.query(plan).toArray();

    expect(out).toEqual([{ id: 1 }]);
    expect([...runtime.events, ...log]).toEqual([
      { stage: 'runBeforeCompile' },
      { stage: 'lower' },
      { stage: 'runDriver' },
      { stage: 'activityStarted', label: 'A' },
      { stage: 'beforeEncode', label: 'A' },
      { stage: 'onRow', label: 'A' },
      { stage: 'activityEnded', label: 'A' },
      { stage: 'activityFinalized', label: 'A' },
    ]);
  });

  it('preserves middleware registration order at every hook site', async () => {
    const log: RecorderEntry[] = [];
    const runtime = new MockRuntime(
      [recorder('A', log), recorder('B', log), recorder('C', log)],
      ctx,
      [{ id: 1 }, { id: 2 }],
    );

    const plan: MockPlan = { draftId: 'd-2', meta };
    await runtime.query(plan).toArray();

    const middlewareOrder = log.map((e) => `${e.stage}:${e.label ?? ''}`);
    expect(middlewareOrder).toEqual([
      'activityStarted:A',
      'activityStarted:B',
      'activityStarted:C',
      'beforeEncode:A',
      'beforeEncode:B',
      'beforeEncode:C',
      'onRow:A',
      'onRow:B',
      'onRow:C',
      'onRow:A',
      'onRow:B',
      'onRow:C',
      'activityEnded:A',
      'activityEnded:B',
      'activityEnded:C',
      'activityFinalized:A',
      'activityFinalized:B',
      'activityFinalized:C',
    ]);
  });

  it('runBeforeCompile defaults to identity (does not transform the plan)', async () => {
    class IdentityRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
      observed: MockPlan | undefined;
      protected override runBeforeCompile(plan: MockPlan): MockPlan {
        this.observed = plan;
        return plan;
      }
      protected lower(plan: MockPlan): MockExec {
        return { compiledId: plan.draftId, meta: plan.meta };
      }
      protected runDriver(): AsyncIterable<Record<string, unknown>> {
        return {
          async *[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {},
        };
      }
      protected async runExecute(): Promise<{ affectedRows: number }> {
        return { affectedRows: 0 };
      }
      async close(): Promise<void> {}
    }

    const runtime = new IdentityRuntime({ middleware: [], ctx });
    const plan: MockPlan = { draftId: 'd-3', meta };

    await runtime.query(plan).toArray();

    expect(runtime.observed).toBe(plan);
  });

  it('forwards the lowered exec to runDriver and to middleware hooks', async () => {
    const seenByMiddleware: MockExec[] = [];
    const seenByDriver: MockExec[] = [];

    class ForwardingRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
      protected lower(plan: MockPlan): MockExec {
        return { compiledId: `compiled:${plan.draftId}`, meta: plan.meta };
      }
      protected runDriver(exec: MockExec): AsyncIterable<Record<string, unknown>> {
        seenByDriver.push(exec);
        return {
          async *[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
            yield { ok: true };
          },
        };
      }
      protected async runExecute(): Promise<{ affectedRows: number }> {
        return { affectedRows: 0 };
      }
      async close(): Promise<void> {}
    }

    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async beforeEncode(exec) {
        seenByMiddleware.push(exec);
      },
    };

    const runtime = new ForwardingRuntime({ middleware: [observer], ctx });
    const plan: MockPlan = { draftId: 'd-4', meta };
    await runtime.query(plan).toArray();

    expect(seenByMiddleware).toHaveLength(1);
    expect(seenByMiddleware[0]).toMatchObject({ compiledId: 'compiled:d-4' });
    expect(seenByDriver).toHaveLength(1);
    expect(seenByDriver[0]).toBe(seenByMiddleware[0]);
  });

  it('executes statistics through only the execute lifecycle', async () => {
    const hooks: string[] = [];
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async activityStarted(activity) {
        hooks.push(`activityStarted:${activity.kind === 'statement' ? activity.returns : ''}`);
      },
      async beforeEncode() {
        hooks.push('beforeEncode');
      },
      intercept: {
        async onQuery() {
          hooks.push('onQuery');
          return undefined;
        },
        async onExecute() {
          hooks.push('onExecute');
          return undefined;
        },
      },
      async onRow() {
        hooks.push('onRow');
      },
      async activityEnded(_activity, result) {
        hooks.push(`activityEnded:${result.kind === 'statement' ? result.returns : ''}`);
      },
    };
    const runtime = new MockRuntime([middleware], ctx, [{ id: 'not-a-statistic' }]);

    await expect(runtime.execute({ draftId: 'stats', meta })).resolves.toEqual({
      affectedRows: 3,
    });

    expect(runtime.events).toEqual([
      { stage: 'runBeforeCompile' },
      { stage: 'lower' },
      { stage: 'runExecute' },
    ]);
    expect(hooks).toEqual([
      'activityStarted:stats',
      'beforeEncode',
      'onExecute',
      'activityEnded:stats',
    ]);
  });

  it.each(['query', 'execute'] as const)(
    'ends a %s failed and finalizes it unknown when beforeEncode throws',
    async (operation) => {
      const beforeError = new Error('before failed');
      const ended = vi.fn(async () => {});
      const finalized = vi.fn(async () => {});
      const middleware: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        beforeEncode() {
          throw beforeError;
        },
        activityEnded: ended,
        activityFinalized: finalized,
      };
      const runtime = new MockRuntime([middleware], ctx, []);
      const plan: MockPlan = { draftId: 'before-failure', meta };

      const pending = operation === 'query' ? runtime.query(plan).toArray() : runtime.execute(plan);
      await expect(pending).rejects.toBe(beforeError);
      expect(runtime.events).not.toContainEqual({ stage: 'runDriver' });
      expect(runtime.events).not.toContainEqual({ stage: 'runExecute' });
      expect(ended).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'statement' }),
        expect.objectContaining({ outcome: 'failed' }),
        expect.any(Object),
      );
      expect(finalized).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'statement' }),
        { outcome: 'unknown' },
        expect.any(Object),
      );
    },
  );

  describe('signal propagation', () => {
    it('exposes the query signal by identity to every middleware hook', async () => {
      const controller = new AbortController();
      const observed: AbortSignal[] = [];
      const middleware: RuntimeMiddleware<MockExec> = {
        name: 'signal-observer',
        beforeEncode(_plan, hookCtx) {
          if (hookCtx.signal) observed.push(hookCtx.signal);
        },
        intercept: {
          async onQuery(_plan, hookCtx) {
            if (hookCtx.signal) observed.push(hookCtx.signal);
            return undefined;
          },
        },
        async onRow(_row, _plan, hookCtx) {
          if (hookCtx.signal) observed.push(hookCtx.signal);
        },
        async activityEnded(_activity, _result, hookCtx) {
          if (hookCtx.signal) observed.push(hookCtx.signal);
        },
      };
      const runtime = new MockRuntime([middleware], ctx, [{ id: 1 }]);

      await runtime
        .query({ draftId: 'query-signal', meta }, { signal: controller.signal })
        .toArray();

      expect(observed).toEqual([
        controller.signal,
        controller.signal,
        controller.signal,
        controller.signal,
      ]);
    });

    it('omits signal when a query supplies no options', async () => {
      const observed: boolean[] = [];
      const middleware: RuntimeMiddleware<MockExec> = {
        name: 'signal-observer',
        beforeEncode(_plan, hookCtx) {
          observed.push('signal' in hookCtx);
        },
      };
      const runtime = new MockRuntime([middleware], ctx, []);

      await runtime.query({ draftId: 'query-without-signal', meta }).toArray();

      expect(observed).toEqual([false]);
    });

    it('aborts an in-flight query beforeEncode hook', async () => {
      const controller = new AbortController();
      const entered = deferred();
      const middleware: RuntimeMiddleware<MockExec> = {
        name: 'blocking-before-encode',
        beforeEncode() {
          entered.resolve();
          return new Promise<void>(() => {});
        },
      };
      const runtime = new MockRuntime([middleware], ctx, []);
      const pending = runtime
        .query({ draftId: 'query-abort', meta }, { signal: controller.signal })
        .toArray();

      await entered.promise;
      controller.abort(new Error('query cancelled'));

      await expect(pending).rejects.toMatchObject({
        code: 'RUNTIME.ABORTED',
        details: { phase: 'beforeEncode' },
        cause: controller.signal.reason,
      });
    });
  });

  describe('activity identity', () => {
    function observer(log: Array<{ readonly id: string; readonly ctx: ActivityContext }>) {
      const middleware: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async beforeEncode(_plan, hookCtx) {
          log.push({ id: '', ctx: hookCtx });
        },
        async activityEnded(activity, _result, hookCtx) {
          log.push({ id: activity.id, ctx: hookCtx });
        },
      };
      return middleware;
    }

    it('gives every hook of one query the same context', async () => {
      const log: Array<{ readonly id: string; readonly ctx: ActivityContext }> = [];
      const runtime = new MockRuntime([observer(log)], ctx, [{ id: 1 }]);

      await runtime.query({ draftId: 'one-query', meta }).toArray();

      expect(log).toHaveLength(2);
      expect(log[0]?.ctx).toBe(log[1]?.ctx);
      expect(log[1]?.id).toBeTypeOf('string');
    });

    it('gives two queries of the same plan distinct activity ids', async () => {
      const log: Array<{ readonly id: string; readonly ctx: ActivityContext }> = [];
      const runtime = new MockRuntime([observer(log)], ctx, [{ id: 1 }]);
      const plan: MockPlan = { draftId: 'shared-plan', meta };

      await runtime.query(plan).toArray();
      await runtime.query(plan).toArray();

      expect(log[1]?.id).not.toBe(log[3]?.id);
      expect(log[1]?.ctx).not.toBe(log[3]?.ctx);
    });
  });
});
