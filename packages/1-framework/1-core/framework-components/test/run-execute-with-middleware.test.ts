import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan } from '../src/execution/query-plan';
import { runExecuteWithMiddleware } from '../src/execution/run-with-middleware';
import type {
  AfterExecuteResult,
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

function makeCtx(): RuntimeMiddlewareContext {
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    contentHash: async () => 'mock-hash',
    scope: 'runtime',
    planExecutionId: 'stats-execution',
  };
}

describe('runExecuteWithMiddleware', () => {
  it('returns driver statistics and reports successful completion', async () => {
    let observed: AfterExecuteResult | undefined;
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async afterExecute(_plan, result) {
        observed = result;
      },
    };

    await expect(
      runExecuteWithMiddleware(exec, [middleware], makeCtx(), async () => ({ affectedRows: 4 })),
    ).resolves.toEqual({ affectedRows: 4 });
    expect(observed).toMatchObject({
      completed: true,
      source: 'driver',
      stats: { affectedRows: 4 },
    });
    expect(observed).not.toHaveProperty('operation');
    expect(observed?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns intercepted statistics without invoking the driver', async () => {
    const driver = vi.fn(async () => ({ affectedRows: 99 }));
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'interceptor',
      async interceptExecute() {
        return { stats: { affectedRows: 7 } };
      },
    };

    await expect(runExecuteWithMiddleware(exec, [middleware], makeCtx(), driver)).resolves.toEqual({
      affectedRows: 7,
    });
    expect(driver).not.toHaveBeenCalled();
  });

  it('ignores query-only interception during statistics execution', async () => {
    const driver = vi.fn(async () => ({ affectedRows: 1 }));
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'query-cache',
      async interceptQuery() {
        return { rows: [{ affectedRows: 100 }] };
      },
    };

    await expect(runExecuteWithMiddleware(exec, [middleware], makeCtx(), driver)).resolves.toEqual({
      affectedRows: 1,
    });
    expect(driver).toHaveBeenCalledTimes(1);
  });

  it('propagates a success-path afterExecute error without invoking completion twice', async () => {
    const afterError = new Error('afterExecute failed');
    const afterExecute = vi.fn(async () => {
      throw afterError;
    });
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      afterExecute,
    };

    await expect(
      runExecuteWithMiddleware(exec, [middleware], makeCtx(), async () => ({ affectedRows: 1 })),
    ).rejects.toBe(afterError);
    expect(afterExecute).toHaveBeenCalledTimes(1);
  });

  it('passes the driver error to afterExecute with completed: false', async () => {
    const driverError = new Error('driver failed');
    let observed: AfterExecuteResult | undefined;
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async afterExecute(_plan, result) {
        observed = result;
      },
    };

    await expect(
      runExecuteWithMiddleware(exec, [middleware], makeCtx(), async () => {
        throw driverError;
      }),
    ).rejects.toBe(driverError);

    expect(observed).toEqual({
      completed: false,
      source: 'driver',
      latencyMs: expect.any(Number),
      error: driverError,
    });
  });

  it('passes an interceptExecute error to afterExecute with source: middleware', async () => {
    const interceptError = new Error('intercept failed');
    let observed: AfterExecuteResult | undefined;
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async interceptExecute() {
        throw interceptError;
      },
      async afterExecute(_plan, result) {
        observed = result;
      },
    };
    const runDriver = vi.fn(async () => ({ affectedRows: 1 }));

    await expect(runExecuteWithMiddleware(exec, [middleware], makeCtx(), runDriver)).rejects.toBe(
      interceptError,
    );

    expect(runDriver).not.toHaveBeenCalled();
    expect(observed).toMatchObject({
      completed: false,
      source: 'middleware',
      error: interceptError,
    });
  });

  it('preserves the original driver error when afterExecute also fails', async () => {
    const driverError = new Error('driver failed');
    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async afterExecute() {
        throw new Error('afterExecute failed');
      },
    };

    await expect(
      runExecuteWithMiddleware(exec, [middleware], makeCtx(), async () => {
        throw driverError;
      }),
    ).rejects.toBe(driverError);
  });
});
