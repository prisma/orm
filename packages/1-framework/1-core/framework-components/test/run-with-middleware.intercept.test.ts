import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan } from '../src/execution/query-plan';
import { runQueryWithMiddleware } from '../src/execution/run-with-middleware';
import type {
  AfterQueryResult,
  QueryInterceptResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '../src/execution/runtime-middleware';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test',
  lane: 'raw-sql',
};

interface MockExec extends ExecutionPlan {
  readonly id: string;
}

const mockExec: MockExec = { id: 'exec-1', meta };

function makeCtx(overrides?: Partial<RuntimeMiddlewareContext>): RuntimeMiddlewareContext {
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    contentHash: async () => 'mock-hash',
    scope: 'runtime',
    planExecutionId: 'test-fixture-plan-execution-id',
    ...overrides,
  };
}

async function* yieldRows<R>(rows: ReadonlyArray<R>): AsyncGenerator<R, void, unknown> {
  for (const row of rows) {
    yield row;
  }
}

describe('runQueryWithMiddleware — interceptQuery', () => {
  describe('chain semantics', () => {
    it('first interceptQueryor returning a non-undefined result wins; subsequent interceptQuery does not fire', async () => {
      const interceptQueryCalls: string[] = [];
      const winnerRows = [{ id: 'a' }, { id: 'b' }];

      const winner: RuntimeMiddleware<MockExec> = {
        name: 'winner',
        async interceptQuery() {
          interceptQueryCalls.push('winner');
          return { rows: winnerRows };
        },
      };
      const loser: RuntimeMiddleware<MockExec> = {
        name: 'loser',
        async interceptQuery() {
          interceptQueryCalls.push('loser');
          return { rows: [{ id: 'should-not-appear' }] };
        },
      };

      const driverFactory = vi.fn(() => yieldRows([{ id: 'driver' }]));

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [winner, loser],
        makeCtx(),
        driverFactory,
      );

      const out = await result.toArray();

      expect(out).toEqual(winnerRows);
      expect(interceptQueryCalls).toEqual(['winner']);
      expect(driverFactory).not.toHaveBeenCalled();
    });

    it('passes through to subsequent middleware when interceptQuery returns undefined', async () => {
      const interceptQueryCalls: string[] = [];
      const winnerRows = [{ id: 'B-served' }];

      const a: RuntimeMiddleware<MockExec> = {
        name: 'A',
        async interceptQuery() {
          interceptQueryCalls.push('A');
          return undefined;
        },
      };
      const b: RuntimeMiddleware<MockExec> = {
        name: 'B',
        async interceptQuery() {
          interceptQueryCalls.push('B');
          return { rows: winnerRows };
        },
      };

      const driverFactory = vi.fn(() => yieldRows([{ id: 'driver' }]));

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [a, b],
        makeCtx(),
        driverFactory,
      );

      const out = await result.toArray();

      expect(out).toEqual(winnerRows);
      expect(interceptQueryCalls).toEqual(['A', 'B']);
      expect(driverFactory).not.toHaveBeenCalled();
    });

    it('mixed chain: A is observer-only, B interceptQuerys → driver is skipped; interceptQuery + afterQuery fire', async () => {
      const events: string[] = [];

      const a: RuntimeMiddleware<MockExec> = {
        name: 'A',
        // `beforeQuery` is fired by the family runtime via
        // `runBeforeQueryChain` before `runQueryWithMiddleware` is
        // even reached; it is therefore not visible to interceptQueryors.
        // See `before-execute-chain.test.ts`.
        async afterQuery() {
          events.push('A:afterQuery');
        },
      };
      const b: RuntimeMiddleware<MockExec> = {
        name: 'B',
        async interceptQuery() {
          events.push('B:interceptQuery');
          return { rows: [{ id: 1 }] };
        },
        async afterQuery() {
          events.push('B:afterQuery');
        },
      };

      const driverFactory = vi.fn(() => yieldRows([{ id: 'driver' }]));

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [a, b],
        makeCtx(),
        driverFactory,
      );

      await result.toArray();

      expect(events).toEqual(['B:interceptQuery', 'A:afterQuery', 'B:afterQuery']);
      expect(driverFactory).not.toHaveBeenCalled();
    });
  });

  describe('hit path', () => {
    it('skips onRow; afterQuery fires with source: "middleware"', async () => {
      const events: string[] = [];
      let observedResult: AfterQueryResult | undefined;

      // `beforeQuery` is fired by the family runtime via
      // `runBeforeQueryChain` before `runQueryWithMiddleware`; it is not
      // visible at the interceptQuery-vs-driver decision point. Asserted in
      // `before-execute-chain.test.ts`.
      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'interceptQueryor',
        async interceptQuery() {
          events.push('interceptQuery');
          return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
        },
        async onRow() {
          events.push('onRow');
        },
        async afterQuery(_plan, result) {
          observedResult = result;
          events.push('afterQuery');
        },
      };

      const driverFactory = vi.fn(() => yieldRows([{ id: 'driver' }]));

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        driverFactory,
      );

      const out = await result.toArray();

      expect(out).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(events).toEqual(['interceptQuery', 'afterQuery']);
      expect(driverFactory).not.toHaveBeenCalled();
      expect(observedResult).toMatchObject({
        rowCount: 3,
        completed: true,
        source: 'middleware',
      });
      expect(observedResult?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('emits a middleware.interceptQuery debug log event naming the winning middleware', async () => {
      const debug = vi.fn();
      const ctx = makeCtx({
        log: { info: () => {}, warn: () => {}, error: () => {}, debug },
      });

      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'cache',
        async interceptQuery() {
          return { rows: [{ id: 1 }] };
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        ctx,
        () => yieldRows([]),
      );

      await result.toArray();

      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledWith({
        event: 'middleware.interceptQuery',
        middleware: 'cache',
      });
    });

    it('does not require a debug log function; interceptQuerys succeed without it', async () => {
      const ctx: RuntimeMiddlewareContext = {
        contract: {},
        mode: 'strict',
        now: () => Date.now(),
        // No `debug` field — this is the optional case.
        log: { info: () => {}, warn: () => {}, error: () => {} },
        contentHash: async () => 'mock-hash',
        scope: 'runtime',
        planExecutionId: 'test-fixture-plan-execution-id',
      };

      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'cache',
        async interceptQuery() {
          return { rows: [{ id: 1 }] };
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        ctx,
        () => yieldRows([]),
      );

      await expect(result.toArray()).resolves.toEqual([{ id: 1 }]);
    });

    it('accepts arrays as the row source', async () => {
      const cached = [{ id: 1 }, { id: 2 }];
      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'array',
        async interceptQuery(): Promise<QueryInterceptResult> {
          return { rows: cached };
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        () => yieldRows([]),
      );

      const out = await result.toArray();
      expect(out).toEqual(cached);
    });

    it('accepts sync Iterable (generator function) as the row source', async () => {
      function* syncGen(): Generator<Record<string, unknown>, void, unknown> {
        yield { id: 'a' };
        yield { id: 'b' };
      }
      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'sync-gen',
        async interceptQuery(): Promise<QueryInterceptResult> {
          return { rows: syncGen() };
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        () => yieldRows([]),
      );

      const out = await result.toArray();
      expect(out).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('accepts AsyncIterable (async generator) as the row source', async () => {
      async function* asyncGen(): AsyncGenerator<Record<string, unknown>, void, unknown> {
        yield { id: 'x' };
        yield { id: 'y' };
        yield { id: 'z' };
      }
      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'async-gen',
        async interceptQuery(): Promise<QueryInterceptResult> {
          return { rows: asyncGen() };
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        () => yieldRows([]),
      );

      const out = await result.toArray();
      expect(out).toEqual([{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
    });

    it('rowCount reported in afterQuery matches the number of interceptQueryed rows yielded', async () => {
      let observed: AfterQueryResult | undefined;
      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'counter',
        async interceptQuery() {
          return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] };
        },
        async afterQuery(_plan, result) {
          observed = result;
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        () => yieldRows([]),
      );

      await result.toArray();
      expect(observed?.rowCount).toBe(4);
    });
  });

  describe('miss path', () => {
    it('all-undefined interceptQuerys → driver path runs normally with source: "driver"', async () => {
      const events: string[] = [];
      let observed: AfterQueryResult | undefined;
      const driverRows = [{ id: 1 }, { id: 2 }];

      const a: RuntimeMiddleware<MockExec> = {
        name: 'A',
        async interceptQuery() {
          events.push('A:interceptQuery');
          return undefined;
        },
        async onRow() {
          events.push('A:onRow');
        },
        async afterQuery(_plan, result) {
          observed = result;
          events.push('A:afterQuery');
        },
      };
      const b: RuntimeMiddleware<MockExec> = {
        name: 'B',
        async interceptQuery() {
          events.push('B:interceptQuery');
          return undefined;
        },
      };

      const driverFactory = vi.fn(() => yieldRows(driverRows));

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [a, b],
        makeCtx(),
        driverFactory,
      );

      const out = await result.toArray();

      expect(out).toEqual(driverRows);
      expect(driverFactory).toHaveBeenCalledTimes(1);
      // `beforeQuery` is fired by `runBeforeQueryChain` outside this
      // helper; the event log here only sees `interceptQuery`, `onRow`, and
      // `afterQuery`.
      expect(events).toEqual([
        'A:interceptQuery',
        'B:interceptQuery',
        'A:onRow',
        'A:onRow',
        'A:afterQuery',
      ]);
      expect(observed?.source).toBe('driver');
    });

    it('middleware without interceptQuery hooks behave as observers (zero-change baseline)', async () => {
      const events: string[] = [];
      const driverRows = [{ id: 1 }];

      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async onRow() {
          events.push('onRow');
        },
        async afterQuery() {
          events.push('afterQuery');
        },
      };

      const driverFactory = vi.fn(() => yieldRows(driverRows));

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [observer],
        makeCtx(),
        driverFactory,
      );

      const out = await result.toArray();

      expect(out).toEqual(driverRows);
      expect(driverFactory).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['onRow', 'afterQuery']);
    });

    it('runDriver factory is invoked lazily — only after interceptQuery chain resolves to passthrough', async () => {
      const callOrder: string[] = [];

      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'late-passthrough',
        async interceptQuery() {
          callOrder.push('interceptQuery');
          return undefined;
        },
      };

      const driverFactory = vi.fn(() => {
        callOrder.push('driverFactory');
        return yieldRows([{ id: 1 }]);
      });

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        driverFactory,
      );

      await result.toArray();

      // interceptQuery must run before runDriver is called.
      expect(callOrder).toEqual(['interceptQuery', 'driverFactory']);
    });
  });

  describe('error path', () => {
    it('an interceptQueryor that throws → afterQuery fires with completed: false, source: "middleware", and the error is rethrown', async () => {
      const events: string[] = [];
      let observed: AfterQueryResult | undefined;
      const boom = new Error('interceptQuery boom');

      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'boom',
        async interceptQuery() {
          events.push('interceptQuery');
          throw boom;
        },
        async afterQuery(_plan, result) {
          observed = result;
          events.push('afterQuery');
        },
      };

      const driverFactory = vi.fn(() => yieldRows([]));

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        driverFactory,
      );

      await expect(result.toArray()).rejects.toBe(boom);

      expect(events).toEqual(['interceptQuery', 'afterQuery']);
      expect(driverFactory).not.toHaveBeenCalled();
      expect(observed).toMatchObject({
        completed: false,
        source: 'middleware',
        rowCount: 0,
        error: boom,
      });
    });

    it('an error thrown while iterating interceptQueryed rows → afterQuery fires with completed: false, source: "middleware"', async () => {
      let observed: AfterQueryResult | undefined;
      const boom = new Error('rows boom');

      async function* badRows(): AsyncGenerator<Record<string, unknown>, void, unknown> {
        yield { id: 1 };
        throw boom;
      }

      const interceptQueryor: RuntimeMiddleware<MockExec> = {
        name: 'bad-rows',
        async interceptQuery(): Promise<QueryInterceptResult> {
          return { rows: badRows() };
        },
        async afterQuery(_plan, result) {
          observed = result;
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [interceptQueryor],
        makeCtx(),
        () => yieldRows([]),
      );

      await expect(result.toArray()).rejects.toBe(boom);

      expect(observed).toMatchObject({
        completed: false,
        source: 'middleware',
        rowCount: 1, // one row was yielded before the throw
        error: boom,
      });
    });

    it('errors thrown by afterQuery on the interceptQueryed error path are swallowed; the original error is rethrown', async () => {
      const events: string[] = [];
      const interceptQueryError = new Error('interceptQuery boom');
      const afterError = new Error('afterQuery boom');

      const noisy: RuntimeMiddleware<MockExec> = {
        name: 'noisy',
        async interceptQuery() {
          throw interceptQueryError;
        },
        async afterQuery() {
          events.push('noisy:afterQuery');
          throw afterError;
        },
      };
      const tail: RuntimeMiddleware<MockExec> = {
        name: 'tail',
        async afterQuery() {
          events.push('tail:afterQuery');
        },
      };

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [noisy, tail],
        makeCtx(),
        () => yieldRows([]),
      );

      await expect(result.toArray()).rejects.toBe(interceptQueryError);

      // Both afterQuery callbacks ran; the noisy throw was swallowed.
      expect(events).toEqual(['noisy:afterQuery', 'tail:afterQuery']);
    });

    it('afterQuery on the interceptQuery error path runs in registration order across multiple middleware', async () => {
      const events: string[] = [];
      const observed: Array<{ label: string; source: string; completed: boolean }> = [];
      const interceptQueryError = new Error('interceptQuery boom');

      function mw(label: string, doesIntercept: boolean): RuntimeMiddleware<MockExec> {
        return {
          name: label,
          ...(doesIntercept
            ? {
                async interceptQuery(): Promise<QueryInterceptResult | undefined> {
                  events.push(`${label}:interceptQuery`);
                  throw interceptQueryError;
                },
              }
            : {}),
          async afterQuery(_plan, result) {
            observed.push({
              label,
              source: result.source,
              completed: result.completed,
            });
            events.push(`${label}:afterQuery`);
          },
        };
      }

      const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
        mockExec,
        [mw('A', false), mw('B', true), mw('C', false)],
        makeCtx(),
        () => yieldRows([]),
      );

      await expect(result.toArray()).rejects.toBe(interceptQueryError);

      // A.interceptQuery doesn't exist; B.interceptQuery throws; C.interceptQuery never runs.
      // afterQuery fires for all three in registration order.
      expect(events).toEqual(['B:interceptQuery', 'A:afterQuery', 'B:afterQuery', 'C:afterQuery']);
      expect(observed).toEqual([
        { label: 'A', source: 'middleware', completed: false },
        { label: 'B', source: 'middleware', completed: false },
        { label: 'C', source: 'middleware', completed: false },
      ]);
    });
  });
});
