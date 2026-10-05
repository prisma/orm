import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan } from '../src/execution/query-plan';
import { runQueryWithMiddleware } from '../src/execution/run-with-middleware';
import type {
  AfterQueryResult,
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

const mockCtx: RuntimeMiddlewareContext = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  contentHash: async () => 'mock-hash',
  scope: 'runtime',
  planExecutionId: 'test-fixture-plan-execution-id',
};

async function* yieldRows<R>(rows: ReadonlyArray<R>): AsyncGenerator<R, void, unknown> {
  for (const row of rows) {
    yield row;
  }
}

describe('runQueryWithMiddleware', () => {
  it('zero middleware passes driver rows through unchanged', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [],
      mockCtx,
      () => yieldRows(rows),
    );

    const out = await result.toArray();
    expect(out).toEqual(rows);
  });

  it('single middleware sees onRow per row, then afterQuery(completed: true)', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const events: string[] = [];
    let observedResult: AfterQueryResult | undefined;

    const mw: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      // beforeQuery fires from `runBeforeQueryChain`, not from
      // `runQueryWithMiddleware`. Asserted in `before-execute-chain.test.ts`.
      async onRow(row) {
        events.push(`onRow:${(row as { id: number }).id}`);
      },
      async afterQuery(plan, result, ctx) {
        expect(plan).toBe(mockExec);
        expect(ctx).toBe(mockCtx);
        observedResult = result;
        events.push('afterQuery');
      },
    };

    const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [mw],
      mockCtx,
      () => yieldRows(rows),
    );

    const out = await result.toArray();

    expect(out).toEqual(rows);
    expect(events).toEqual(['onRow:1', 'onRow:2', 'afterQuery']);
    expect(observedResult).toMatchObject({ rowCount: 2, completed: true, source: 'driver' });
    expect(observedResult?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('multiple middleware run in registration order at every hook site', async () => {
    const rows = [{ id: 'a' }];
    const events: string[] = [];

    function mw(label: string): RuntimeMiddleware<MockExec> {
      return {
        name: label,
        async onRow() {
          events.push(`${label}:onRow`);
        },
        async afterQuery() {
          events.push(`${label}:afterQuery`);
        },
      };
    }

    const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [mw('A'), mw('B'), mw('C')],
      mockCtx,
      () => yieldRows(rows),
    );

    await result.toArray();

    expect(events).toEqual([
      'A:onRow',
      'B:onRow',
      'C:onRow',
      'A:afterQuery',
      'B:afterQuery',
      'C:afterQuery',
    ]);
  });

  it('error path: driver throw triggers afterQuery(completed: false) for each middleware in order then rethrows', async () => {
    const events: string[] = [];
    const observed: Array<{ label: string; result: AfterQueryResult }> = [];
    const driverError = new Error('driver boom');

    function mw(label: string): RuntimeMiddleware<MockExec> {
      return {
        name: label,
        async afterQuery(_plan, result) {
          observed.push({ label, result });
          events.push(`${label}:afterQuery`);
        },
      };
    }

    const failingDriver = async function* (): AsyncGenerator<
      Record<string, unknown>,
      void,
      unknown
    > {
      yield { id: 1 };
      throw driverError;
    };

    const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [mw('A'), mw('B')],
      mockCtx,
      failingDriver,
    );

    await expect(result.toArray()).rejects.toBe(driverError);

    expect(events).toEqual(['A:afterQuery', 'B:afterQuery']);
    expect(observed).toEqual([
      {
        label: 'A',
        result: {
          completed: false,
          rowCount: 1,
          source: 'driver',
          latencyMs: expect.any(Number),
          error: driverError,
        },
      },
      {
        label: 'B',
        result: {
          completed: false,
          rowCount: 1,
          source: 'driver',
          latencyMs: expect.any(Number),
          error: driverError,
        },
      },
    ]);
  });

  it('error path: non-Error driver rejection is passed to afterQuery unchanged', async () => {
    let observed: AfterQueryResult | undefined;
    const rejection = { code: 'ETIMEDOUT' };

    const mw: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async afterQuery(_plan, result) {
        observed = result;
      },
    };

    const failingDriver: () => AsyncIterable<Record<string, unknown>> = () => ({
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Record<string, unknown>>> {
            return Promise.reject(rejection);
          },
        };
      },
    });

    const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [mw],
      mockCtx,
      failingDriver,
    );

    await expect(result.toArray()).rejects.toBe(rejection);
    expect(observed).toMatchObject({ completed: false, error: rejection });
  });

  it('error inside afterQuery during error path is swallowed and the original driver error is rethrown', async () => {
    const driverError = new Error('driver boom');
    const afterQueryError = new Error('afterQuery boom');
    const events: string[] = [];

    const noisy: RuntimeMiddleware<MockExec> = {
      name: 'noisy',
      async afterQuery() {
        events.push('noisy:afterQuery');
        throw afterQueryError;
      },
    };
    const tail: RuntimeMiddleware<MockExec> = {
      name: 'tail',
      async afterQuery() {
        events.push('tail:afterQuery');
      },
    };

    const failingDriver: () => AsyncIterable<Record<string, unknown>> = () => ({
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Record<string, unknown>>> {
            return Promise.reject(driverError);
          },
        };
      },
    });

    const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [noisy, tail],
      mockCtx,
      failingDriver,
    );

    await expect(result.toArray()).rejects.toBe(driverError);

    expect(events).toEqual(['noisy:afterQuery', 'tail:afterQuery']);
  });

  it('skips hooks that the middleware does not implement', async () => {
    const rows = [{ id: 1 }];
    const events: string[] = [];

    const partial: RuntimeMiddleware<MockExec> = {
      name: 'partial',
      async onRow() {
        events.push('onRow');
      },
    };

    const result = runQueryWithMiddleware<MockExec, Record<string, unknown>>(
      mockExec,
      [partial],
      mockCtx,
      () => yieldRows(rows),
    );

    await result.toArray();
    expect(events).toEqual(['onRow']);
  });
});
