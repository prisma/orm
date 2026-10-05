import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan } from '../src/execution/query-plan';
import {
  executeWithAfterTransaction,
  queryWithAfterTransaction,
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

describe('queryWithAfterTransaction', () => {
  function recordStage(events: string[]) {
    return async (result: AfterTransactionResult) => {
      events.push(`afterTransaction:${result.outcome}`);
    };
  }

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

  it('fires committed once after the last row', async () => {
    const events: string[] = [];

    const read = await collect(
      delegate(queryWithAfterTransaction(recordStage(events), () => rows(events))),
    );

    expect({ read, events }).toEqual({
      read: [1, 2],
      events: ['row 1', 'row 2', 'rows done', 'afterTransaction:committed'],
    });
  });

  it('fires unknown once and rethrows when the rows throw', async () => {
    const events: string[] = [];
    const failure = new Error('rows failed');

    await expect(
      collect(
        delegate(queryWithAfterTransaction(recordStage(events), () => rows(events, failure))),
      ),
    ).rejects.toBe(failure);

    expect(events).toEqual(['row 1', 'afterTransaction:unknown']);
  });

  it('fires unknown once when the caller stops reading', async () => {
    const events: string[] = [];

    for await (const _row of delegate(
      queryWithAfterTransaction(recordStage(events), () => rows(events)),
    )) {
      break;
    }

    expect(events).toEqual(['row 1', 'afterTransaction:unknown']);
  });

  it('returns the rows unchanged when there is nothing to fire', () => {
    const events: string[] = [];
    const source = rows(events);

    expect(queryWithAfterTransaction(undefined, () => source)).toBe(source);
  });
});

describe('executeWithAfterTransaction', () => {
  it('fires committed once after the operation resolves', async () => {
    const events: string[] = [];

    const result = await executeWithAfterTransaction(
      async (stage) => {
        events.push(`afterTransaction:${stage.outcome}`);
      },
      async () => {
        events.push('executed');
        return 3;
      },
    );

    expect({ result, events }).toEqual({
      result: 3,
      events: ['executed', 'afterTransaction:committed'],
    });
  });

  it('fires unknown once and rethrows when the operation rejects', async () => {
    const events: string[] = [];
    const failure = new Error('execute failed');

    await expect(
      executeWithAfterTransaction(
        async (stage) => {
          events.push(`afterTransaction:${stage.outcome}`);
        },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    expect(events).toEqual(['afterTransaction:unknown']);
  });

  it('runs the operation alone when there is nothing to fire', async () => {
    await expect(executeWithAfterTransaction(undefined, async () => 3)).resolves.toBe(3);
  });
});
