import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan } from '../src/execution/query-plan';
import { runAfterTransaction } from '../src/execution/run-with-middleware';
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
