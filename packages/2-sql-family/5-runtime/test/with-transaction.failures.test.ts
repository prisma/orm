import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { type RuntimeConnection, withTransaction } from '../src/sql-runtime';
import { createSetup, names, rawPlan } from './transaction-activity-fixtures';

function failingTransactionEnd(error: unknown): SqlMiddleware {
  return {
    name: 'failing-end',
    familyId: 'sql',
    async activityEnded(activity) {
      if (activity.kind === 'transaction') throw error;
    },
  };
}

describe('withTransaction when a transaction hook fails', () => {
  it('rethrows an activityEnded error after a resolved COMMIT without a ROLLBACK, and finalizes committed', async () => {
    const hookError = new Error('transaction ended hook failed');
    const { runtime, events } = createSetup({ middleware: [failingTransactionEnd(hookError)] });

    const run = withTransaction(runtime, async (tx) => {
      await tx.execute(rawPlan('update t set x = 1'));
    });

    await expect(run).rejects.toBe(hookError);
    expect(names(events)).not.toContain('rollback');
    expect(names(events)).toContain('finalized:transaction:committed');
    expect(names(events).at(-1)).toBe('release');
  });

  it('rethrows a non-object thrown by activityEnded after a resolved COMMIT, without a ROLLBACK', async () => {
    const { runtime, events } = createSetup({ middleware: [failingTransactionEnd('hook failed')] });

    const run = withTransaction(runtime, async (tx) => {
      await tx.execute(rawPlan('update t set x = 1'));
    });

    await expect(run).rejects.toBe('hook failed');
    expect(names(events)).not.toContain('rollback');
    expect(names(events)).toContain('finalized:transaction:committed');
  });
});

describe('a transaction whose COMMIT resolved', () => {
  it('ignores rollback() after a commit() that rejected with a hook error', async () => {
    const hookError = new Error('transaction ended hook failed');
    const { runtime, events } = createSetup({ middleware: [failingTransactionEnd(hookError)] });
    const transaction = await (await runtime.connection()).transaction();
    await transaction.execute(rawPlan('update t set x = 1'));

    await expect(transaction.commit()).rejects.toBe(hookError);
    await expect(transaction.rollback()).resolves.toBeUndefined();

    expect(names(events)).not.toContain('rollback');
    expect(names(events).filter((name) => name.includes(':transaction:'))).toEqual([
      'ended:transaction:succeeded',
      'finalized:transaction:committed',
    ]);
  });

  it('ignores rollback() after a commit() that resolved', async () => {
    const { runtime, events } = createSetup();
    const transaction = await (await runtime.connection()).transaction();

    await transaction.commit();
    await transaction.rollback();

    expect(names(events)).not.toContain('rollback');
  });
});

describe('withTransaction when the transaction cannot start', () => {
  it('destroys the connection when BEGIN fails', async () => {
    const { runtime, events } = createSetup({ failures: { begin: new Error('begin failed') } });

    await expect(withTransaction(runtime, async () => undefined)).rejects.toThrow('begin failed');

    expect(names(events).filter((name) => name === 'release' || name === 'destroy')).toEqual([
      'destroy',
    ]);
  });

  it('releases the connection when the transaction activityStarted throws a non-object', async () => {
    const failingStart: SqlMiddleware = {
      name: 'failing-start',
      familyId: 'sql',
      async activityStarted(activity) {
        if (activity.kind === 'transaction') throw 'started failed';
      },
    };
    const { runtime, events } = createSetup({ middleware: [failingStart] });

    await expect(withTransaction(runtime, async () => undefined)).rejects.toBe('started failed');

    expect(names(events)).not.toContain('begin');
    expect(names(events).filter((name) => name === 'release' || name === 'destroy')).toEqual([
      'release',
    ]);
  });

  it('releases the connection when the transaction activityStarted throws, because no BEGIN was sent', async () => {
    const refused = new Error('started failed');
    const failingStart: SqlMiddleware = {
      name: 'failing-start',
      familyId: 'sql',
      async activityStarted(activity) {
        if (activity.kind === 'transaction') throw refused;
      },
    };
    const { runtime, events } = createSetup({ middleware: [failingStart] });

    await expect(withTransaction(runtime, async () => undefined)).rejects.toBe(refused);

    expect(names(events)).not.toContain('begin');
    expect(names(events).filter((name) => name === 'release' || name === 'destroy')).toEqual([
      'release',
    ]);
  });
});

describe('withTransaction with a connection the runtime did not make', () => {
  it('destroys the connection when its transaction() rejects', async () => {
    const startError = new Error('custom start failed');
    const release = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    const connection = {
      transaction: vi.fn(async () => {
        throw startError;
      }),
      release,
      destroy,
    } as unknown as RuntimeConnection;

    await expect(
      withTransaction({ connection: async () => connection }, async () => undefined),
    ).rejects.toBe(startError);

    expect(destroy).toHaveBeenCalledWith(startError);
    expect(release).not.toHaveBeenCalled();
  });
});

describe('a transaction whose ROLLBACK resolved', () => {
  it('rethrows the callback error unchanged from withTransaction and releases the connection when activityEnded then throws', async () => {
    const callbackError = new Error('callback failed');
    const { runtime, events } = createSetup({
      middleware: [failingTransactionEnd(new Error('transaction ended hook failed'))],
    });

    const run = withTransaction(runtime, async (tx) => {
      await tx.execute(rawPlan('update t set x = 1'));
      throw callbackError;
    });

    await expect(run).rejects.toBe(callbackError);
    expect(names(events)).toContain('rollback');
    expect(names(events)).toContain('finalized:transaction:rolled-back');
    expect(names(events).filter((name) => name === 'release' || name === 'destroy')).toEqual([
      'release',
    ]);
  });
});

describe('rollback() while commit() is finalizing', () => {
  it('resolves only after the commit finalization hooks have run', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const slowFinalize: SqlMiddleware = {
      name: 'slow-finalize',
      familyId: 'sql',
      async activityFinalized(activity) {
        if (activity.kind !== 'transaction') return;
        await gate;
        order.push('finalized');
      },
    };
    const { runtime } = createSetup({ middleware: [slowFinalize] });
    const transaction = await (await runtime.connection()).transaction();

    const committing = transaction.commit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rollingBack = transaction.rollback().then(() => order.push('rollback resolved'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([committing, rollingBack]);

    expect(order).toEqual(['finalized', 'rollback resolved']);
  });
});

describe('the hook error after a resolved ROLLBACK', () => {
  it('is passed to the transaction log when withTransaction reports the callback error instead', async () => {
    const hookError = new Error('transaction ended hook failed');
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { runtime } = createSetup({ log, middleware: [failingTransactionEnd(hookError)] });

    await expect(
      withTransaction(runtime, async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');

    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ error: hookError }));
  });
});

describe('rollback() twice', () => {
  it('sends one ROLLBACK and resolves both times', async () => {
    const { runtime, events } = createSetup();
    const transaction = await (await runtime.connection()).transaction();

    await transaction.rollback();
    await expect(transaction.rollback()).resolves.toBeUndefined();

    expect(names(events).filter((name) => name === 'rollback')).toEqual(['rollback']);
  });
});

describe('a driver failure and a transaction activityEnded hook that throws', () => {
  const hookError = new Error('transaction ended hook failed');

  function setupWith(failures: Parameters<typeof createSetup>[0]) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const setup = createSetup({ ...failures, log, middleware: [failingTransactionEnd(hookError)] });
    return { ...setup, log };
  }

  it('reports the failed BEGIN and logs the hook error', async () => {
    const beginError = new Error('begin failed');
    const { runtime, log } = setupWith({ failures: { begin: beginError } });

    await expect((await runtime.connection()).transaction()).rejects.toBe(beginError);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ error: hookError }));
  });

  it('reports the rejected COMMIT and logs the hook error', async () => {
    const commitError = new Error('commit failed');
    const { runtime, log } = setupWith({ failures: { commit: commitError } });
    const transaction = await (await runtime.connection()).transaction();

    await expect(transaction.commit()).rejects.toBe(commitError);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ error: hookError }));
  });

  it('reports the rejected ROLLBACK and logs the hook error', async () => {
    const rollbackError = new Error('rollback failed');
    const { runtime, log } = setupWith({ failures: { rollback: rollbackError } });
    const transaction = await (await runtime.connection()).transaction();

    await expect(transaction.rollback()).rejects.toBe(rollbackError);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ error: hookError }));
  });

  it('gives withTransaction the COMMIT error as commitError', async () => {
    const commitError = new Error('commit failed');
    const { runtime } = setupWith({ failures: { commit: commitError } });

    await expect(withTransaction(runtime, async () => undefined)).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_COMMIT_FAILED',
      details: { commitError },
    });
  });

  it('invalidates the transaction context immediately when the callback throws while rollback is pending', async () => {
    let unblockRollback: () => void = () => {};
    const rollbackHeldUntil = new Promise<void>((resolve) => {
      unblockRollback = resolve;
    });

    const { runtime } = createSetup({ failures: { rollbackHeldUntil } });

    let statementPromise: Promise<unknown> | undefined;

    const run = withTransaction(runtime, async (tx) => {
      const callbackError = new Error('callback write failed');
      statementPromise = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return tx.execute(rawPlan('insert into t (id) values (2)'));
      })();

      // Catch statementPromise immediately to avoid unhandled rejection in node event loop
      statementPromise.catch(() => {});

      throw callbackError;
    });

    // Unblock the held rollback so withTransaction can complete
    setTimeout(unblockRollback, 50);

    await expect(run).rejects.toThrow('callback write failed');
    await expect(statementPromise).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_CLOSED',
    });
  });
});
