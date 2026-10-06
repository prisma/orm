import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan } from '../src/execution/query-plan';
import {
  onQueryEndOutsideTransaction,
  type QueryEnding,
  reportExecuteEnding,
  reportQueryEnding,
  runAfterTransaction,
} from '../src/execution/run-with-middleware';
import type {
  AfterTransactionResult,
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

const exec: MockExec = { id: 'exec-1', meta };
const committed: AfterTransactionResult = { outcome: 'committed' };

function makeCtx(): RuntimeMiddlewareContext {
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    contentHash: async () => 'mock-hash',
    scope: 'runtime',
    planExecutionId: 'after-transaction-execution',
  };
}

describe('runAfterTransaction', () => {
  it('calls each hook in registration order with the plan, result and context', async () => {
    const ctx = makeCtx();
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const record =
      (name: string): NonNullable<RuntimeMiddleware<MockExec>['afterTransaction']> =>
      async (...args) => {
        calls.push({ name, args });
      };
    const middleware: RuntimeMiddleware<MockExec>[] = [
      { name: 'first', afterTransaction: record('first') },
      { name: 'no-hook' },
      { name: 'second', afterTransaction: record('second') },
    ];

    await runAfterTransaction(exec, middleware, committed, ctx);

    expect(calls).toEqual([
      { name: 'first', args: [exec, committed, ctx] },
      { name: 'second', args: [exec, committed, ctx] },
    ]);
  });

  it('logs and swallows a hook error and still runs later hooks', async () => {
    const ctx = makeCtx();
    const failure = new Error('hook failed');
    const later = vi.fn(async () => {});
    const middleware: RuntimeMiddleware<MockExec>[] = [
      {
        name: 'failing',
        async afterTransaction() {
          throw failure;
        },
      },
      { name: 'later', afterTransaction: later },
    ];

    await expect(
      runAfterTransaction(exec, middleware, { outcome: 'rolled-back' }, ctx),
    ).resolves.toBeUndefined();

    expect(ctx.log.error).toHaveBeenCalledWith({
      event: 'middleware.afterTransaction.error',
      middleware: 'failing',
      error: failure,
    });
    expect(later).toHaveBeenCalledWith(exec, { outcome: 'rolled-back' }, ctx);
  });

  it('resolves and still runs later hooks when logging a hook error throws too', async () => {
    const ctx: RuntimeMiddlewareContext = {
      ...makeCtx(),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: () => {
          throw new Error('log failed');
        },
      },
    };
    const later = vi.fn(async () => {});
    const middleware: RuntimeMiddleware<MockExec>[] = [
      {
        name: 'failing',
        async afterTransaction() {
          throw new Error('hook failed');
        },
      },
      { name: 'later', afterTransaction: later },
    ];

    await expect(runAfterTransaction(exec, middleware, committed, ctx)).resolves.toBeUndefined();

    expect(later).toHaveBeenCalledWith(exec, committed, ctx);
  });

  it('resolves after every hook has resolved', async () => {
    const ctx = makeCtx();
    const events: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const middleware: RuntimeMiddleware<MockExec>[] = [
      {
        name: 'deferred',
        async afterTransaction() {
          await gate;
          events.push('deferred resolved');
        },
      },
      {
        name: 'after',
        async afterTransaction() {
          events.push('after ran');
        },
      },
    ];

    const run = runAfterTransaction(exec, middleware, committed, ctx).then(() => {
      events.push('runner resolved');
    });
    await Promise.resolve();
    events.push('released');
    release();
    await run;

    expect(events).toEqual(['released', 'deferred resolved', 'after ran', 'runner resolved']);
  });
});

function recordEnding(events: string[]) {
  return async (ending: QueryEnding) => {
    events.push(`ended:${ending}`);
  };
}

describe('reportQueryEnding', () => {
  async function* rows(events: string[], failure?: Error): AsyncGenerator<number> {
    events.push('row 1');
    yield 1;
    if (failure) throw failure;
    events.push('row 2');
    yield 2;
    events.push('rows done');
  }

  async function collect<Row>(iterable: AsyncIterable<Row>): Promise<Row[]> {
    const read: Row[] = [];
    for await (const row of iterable) read.push(row);
    return read;
  }

  async function* delegate<Row>(iterable: AsyncIterable<Row>): AsyncGenerator<Row> {
    yield* iterable;
  }

  it('reports completed once after the last row', async () => {
    const events: string[] = [];

    const read = await collect(
      delegate(reportQueryEnding(recordEnding(events), () => rows(events))),
    );

    expect({ read, events }).toEqual({
      read: [1, 2],
      events: ['row 1', 'row 2', 'rows done', 'ended:completed'],
    });
  });

  it('reports failed once and rethrows when the rows throw', async () => {
    const events: string[] = [];
    const failure = new Error('rows failed');

    await expect(
      collect(delegate(reportQueryEnding(recordEnding(events), () => rows(events, failure)))),
    ).rejects.toBe(failure);

    expect(events).toEqual(['row 1', 'ended:failed']);
  });

  it('reports stopped once when the caller stops reading', async () => {
    const events: string[] = [];

    for await (const _row of delegate(
      reportQueryEnding(recordEnding(events), () => rows(events)),
    )) {
      break;
    }

    expect(events).toEqual(['row 1', 'ended:stopped']);
  });

  it('reports stopped once when the caller stops before reading a row, without delegating', async () => {
    const events: string[] = [];
    const iterator = reportQueryEnding(recordEnding(events), () => rows(events))[
      Symbol.asyncIterator
    ]();

    await iterator.return?.();
    await iterator.return?.();
    await iterator.next();

    expect(events).toEqual(['ended:stopped']);
  });

  it('reports stopped once and rethrows when the caller throws into it before reading a row', async () => {
    const events: string[] = [];
    const failure = new Error('caller failed');
    const iterator = reportQueryEnding(recordEnding(events), () => rows(events))[
      Symbol.asyncIterator
    ]();

    await expect(iterator.throw?.(failure)).rejects.toBe(failure);
    await iterator.return?.();

    expect(events).toEqual(['ended:stopped']);
  });

  it('reports stopped once and rethrows when the caller throws into it after the first row', async () => {
    const events: string[] = [];
    const failure = new Error('caller failed');
    const iterator = reportQueryEnding(recordEnding(events), () => rows(events))[
      Symbol.asyncIterator
    ]();

    const first = await iterator.next();
    await expect(iterator.throw?.(failure)).rejects.toBe(failure);
    await iterator.return?.();

    expect({ first, events }).toEqual({
      first: { done: false, value: 1 },
      events: ['row 1', 'ended:stopped'],
    });
  });

  it('reports failed when the rows answer an error the caller threw in with an error of their own', async () => {
    const events: string[] = [];
    const rowsFailure = new Error('rows failed');
    const rowsThatFailWhenThrownInto = (): AsyncIterable<number> => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: 1 }),
        throw: async () => {
          throw rowsFailure;
        },
      }),
    });
    const iterator = reportQueryEnding(recordEnding(events), rowsThatFailWhenThrownInto)[
      Symbol.asyncIterator
    ]();

    await iterator.next();
    await expect(iterator.throw?.(new Error('caller failed'))).rejects.toBe(rowsFailure);

    expect(events).toEqual(['ended:failed']);
  });

  it('returns the rows unchanged when there is nothing to report to', () => {
    const events: string[] = [];
    const source = rows(events);

    expect(reportQueryEnding(undefined, () => source)).toBe(source);
  });
});

describe('reportExecuteEnding', () => {
  it('reports completed once after the operation resolves', async () => {
    const events: string[] = [];

    const result = await reportExecuteEnding(recordEnding(events), async () => {
      events.push('executed');
      return 3;
    });

    expect({ result, events }).toEqual({
      result: 3,
      events: ['executed', 'ended:completed'],
    });
  });

  it('reports failed once and rethrows when the operation rejects', async () => {
    const events: string[] = [];
    const failure = new Error('execute failed');

    await expect(
      reportExecuteEnding(recordEnding(events), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(events).toEqual(['ended:failed']);
  });

  it('runs the operation alone when there is nothing to report to', async () => {
    await expect(reportExecuteEnding(undefined, async () => 3)).resolves.toBe(3);
  });
});

describe('onQueryEndOutsideTransaction', () => {
  it.each([
    { ending: 'completed', outcome: 'committed' },
    { ending: 'failed', outcome: 'unknown' },
    { ending: 'stopped', outcome: 'unknown' },
  ] as const)(
    'runs the stage with $outcome when the query $ending',
    async ({ ending, outcome }) => {
      const results: AfterTransactionResult[] = [];
      const onQueryEnd = onQueryEndOutsideTransaction(async (result) => {
        results.push(result);
      });

      await onQueryEnd?.(ending);

      expect(results).toEqual([{ outcome }]);
    },
  );

  it('returns undefined when there is no stage to run', () => {
    expect(onQueryEndOutsideTransaction(undefined)).toBeUndefined();
  });
});
