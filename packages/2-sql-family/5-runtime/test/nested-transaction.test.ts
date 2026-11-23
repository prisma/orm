import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { type TransactionContext, withTransaction } from '../src/sql-runtime';
import { deferred } from './closed-runtime-stub';
import {
  createSetup,
  finalized,
  rawPlan,
  rejectsWith,
  trace,
  transactionIds,
} from './transaction-activity-fixtures';

const statementB = rawPlan('insert b');
const statementC = rawPlan('insert c');

const savepointMiddleware = (hooks: Omit<SqlMiddleware, 'name' | 'familyId'>): SqlMiddleware => ({
  name: 'savepoint-hooks',
  familyId: 'sql',
  ...hooks,
});

describe('TransactionContext.transaction', () => {
  it('releases the savepoint after the callback resolves and names a nested savepoint sp_2', async () => {
    const { runtime, events } = createSetup();

    const result = await withTransaction(runtime, (tx) =>
      tx.transaction(async (middle) => {
        await middle.execute(statementB);
        return middle.transaction(async (inner) => {
          await inner.execute(statementC);
          return 42;
        });
      }),
    );

    expect(result).toBe(42);
    expect(trace(events)).toBe(
      'begin, SAVEPOINT sp_1, insert b, SAVEPOINT sp_2, insert c, RELEASE SAVEPOINT sp_2, RELEASE SAVEPOINT sp_1, commit, release',
    );
  });

  it('rolls back to the savepoint when the callback throws, rethrows the error and leaves the outer transaction usable', async () => {
    const { runtime, events } = createSetup();
    const error = new Error('nope');

    await withTransaction(runtime, async (tx) => {
      await expect(
        tx.transaction(async (inner) => {
          await inner.execute(statementB);
          throw error;
        }),
      ).rejects.toBe(error);
      await tx.execute(statementC);
    });

    expect(trace(events)).toBe(
      'begin, SAVEPOINT sp_1, insert b, ROLLBACK TO SAVEPOINT sp_1, insert c, commit, release',
    );
    expect(finalized(events)).toBe(
      'statement:rolled-back, transaction:rolled-back, statement:committed, transaction:committed',
    );
  });

  it('rolls back to the savepoint after a failed RELEASE and rejects with RUNTIME.TRANSACTION_COMMIT_FAILED', async () => {
    const releaseError = new Error('release failed');
    const { runtime, events } = createSetup({ failures: { releaseSavepoint: releaseError } });

    await withTransaction(runtime, async (tx) => {
      await expect(tx.transaction(async () => 1)).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_COMMIT_FAILED',
        cause: releaseError,
      });
      await tx.execute(statementC);
    });

    expect(trace(events)).toBe(
      'begin, SAVEPOINT sp_1, RELEASE SAVEPOINT sp_1, ROLLBACK TO SAVEPOINT sp_1, insert c, commit, release',
    );
  });

  it('rejects with RUNTIME.TRANSACTION_ROLLBACK_FAILED when ROLLBACK TO fails, closes the outer context and destroys the connection', async () => {
    const { runtime, events } = createSetup({
      failures: { rollbackToSavepoint: new Error('rollback to failed') },
    });
    const error = new Error('nope');

    const run = withTransaction(runtime, async (tx) => {
      await expect(
        tx.transaction(async () => {
          throw error;
        }),
      ).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED', cause: error });
      await rejectsWith(tx.execute(statementC), 'TRANSACTION_CLOSED');
    });

    await rejectsWith(run, 'TRANSACTION_COMMIT_FAILED');
    expect(trace(events)).toBe('begin, SAVEPOINT sp_1, ROLLBACK TO SAVEPOINT sp_1, destroy');
  });

  it('rejects with the error of an activityStarted hook that refuses the savepoint, without calling the callback', async () => {
    const refusal = new Error('refused');
    const { runtime, events } = createSetup({
      middleware: [
        savepointMiddleware({
          async activityStarted(activity, ctx) {
            if (activity.kind === 'transaction' && ctx.inTransaction()) throw refusal;
          },
        }),
      ],
    });
    const callback = vi.fn(async () => 1);

    await withTransaction(runtime, async (tx) => {
      await expect(tx.transaction(callback)).rejects.toBe(refusal);
      await tx.execute(statementC);
    });

    expect(callback).not.toHaveBeenCalled();
    expect(trace(events)).toBe('begin, insert c, commit, release');
  });

  it('rejects with the error of an activityEnded hook after a resolved RELEASE, without ROLLBACK TO', async () => {
    const hookError = new Error('ended failed');
    const { runtime, events } = createSetup({
      middleware: [
        savepointMiddleware({
          async activityEnded(activity, _result, ctx) {
            if (activity.kind === 'transaction' && ctx.inTransaction()) throw hookError;
          },
        }),
      ],
    });

    await withTransaction(runtime, async (tx) => {
      await expect(tx.transaction(async () => 1)).rejects.toBe(hookError);
    });

    expect(trace(events)).toBe('begin, SAVEPOINT sp_1, RELEASE SAVEPOINT sp_1, commit, release');
  });

  it('refuses work on the nested context after the nested call settled, sending nothing', async () => {
    const { runtime, events } = createSetup();

    await withTransaction(runtime, async (tx) => {
      const escaped = await tx.transaction(async (inner) => inner);
      const before = events.length;

      expect(escaped.invalidated).toBe(true);
      await rejectsWith(escaped.execute(statementC), 'TRANSACTION_CLOSED');
      await rejectsWith(escaped.query(statementC).toArray(), 'TRANSACTION_CLOSED');
      await rejectsWith(
        escaped.transaction(async () => 1),
        'TRANSACTION_CLOSED',
      );
      expect(events.slice(before)).toEqual([]);
    });
  });

  it('rejects with RUNTIME.TRANSACTION_TIMEOUT when the outer timeout fires during the callback, and ends the savepoint activity', async () => {
    const { runtime, events } = createSetup();
    let nested: Promise<unknown> = Promise.resolve();

    const run = withTransaction(
      runtime,
      (tx) => {
        nested = tx.transaction(() => new Promise<never>(() => {}));
        return nested;
      },
      { timeout: 1 },
    );

    await rejectsWith(run, 'TRANSACTION_TIMEOUT');
    await rejectsWith(nested, 'TRANSACTION_TIMEOUT');
    const savepointId = transactionIds(events)[1];
    expect(
      events.filter((event) => event.activity?.id === savepointId).map((event) => event.name),
    ).toEqual([
      'started:transaction',
      'ended:transaction:failed',
      'finalized:transaction:rolled-back',
    ]);
  });

  it.each([
    { enclosing: 'the outer transaction', depth: 0 },
    { enclosing: 'a savepoint', depth: 1 },
  ])(
    'closes the transaction when $enclosing returns while a nested call it did not await is running',
    async ({ depth }) => {
      const { runtime, events } = createSetup();
      const proceed = deferred();
      const contexts: TransactionContext[] = [];
      let nested: Promise<unknown> = Promise.resolve();
      const enclosingCall = deferred<{ call: Promise<unknown> }>();
      const leave = (ctx: TransactionContext) => {
        contexts.push(ctx);
        nested = ctx.transaction(async (inner) => {
          contexts.push(inner);
          await proceed.promise;
          return 1;
        });
      };

      const run = withTransaction(runtime, async (tx) => {
        if (depth === 0) return leave(tx);
        contexts.push(tx);
        const call = tx.transaction(async (middle) => leave(middle));
        enclosingCall.resolve({ call });
        await call.catch(() => undefined);
      });

      await rejectsWith(
        depth === 0 ? run : (await enclosingCall.promise).call,
        'TRANSACTION_COMMIT_FAILED',
      );
      await run.catch(() => undefined);
      const before = events.length;
      for (const ctx of contexts) {
        await rejectsWith(ctx.execute(statementC), 'TRANSACTION_CLOSED');
      }
      proceed.resolve();
      await nested.catch(() => undefined);

      expect(trace(events.slice(before))).toBe('');
      expect(trace(events).endsWith('destroy')).toBe(true);
      const ends = transactionIds(events).map(
        (id) =>
          events.filter((event) => event.activity?.id === id && event.name.startsWith('ended:'))
            .length,
      );
      expect(ends).toEqual(ends.map(() => 1));
    },
  );

  it.each([
    { enclosing: 'the outer transaction', depth: 0, sent: 'begin, SAVEPOINT sp_1, destroy' },
    { enclosing: 'a savepoint', depth: 1, sent: 'begin, SAVEPOINT sp_1, SAVEPOINT sp_2, destroy' },
  ])(
    'rejects with RUNTIME.TRANSACTION_ROLLBACK_FAILED and closes the transaction when $enclosing throws while a nested call it did not await is running',
    async ({ depth, sent }) => {
      const { runtime, events } = createSetup();
      const proceed = deferred();
      const error = new Error('nope');
      const contexts: TransactionContext[] = [];
      let nested: Promise<unknown> = Promise.resolve();
      const enclosingCall = deferred<{ call: Promise<unknown> }>();
      const leave = (ctx: TransactionContext) => {
        contexts.push(ctx);
        nested = ctx.transaction(async (inner) => {
          contexts.push(inner);
          await proceed.promise;
        });
        throw error;
      };

      const run = withTransaction(runtime, async (tx) => {
        if (depth === 0) return leave(tx);
        contexts.push(tx);
        const call = tx.transaction(async (middle) => leave(middle));
        enclosingCall.resolve({ call });
        await call.catch(() => undefined);
      });

      await expect(depth === 0 ? run : (await enclosingCall.promise).call).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
        cause: error,
        details: { rollbackError: { code: 'RUNTIME.TRANSACTION_SUSPENDED' } },
      });
      await run.catch(() => undefined);
      const before = events.length;
      expect(contexts).toHaveLength(depth + 2);
      for (const ctx of contexts) {
        await rejectsWith(ctx.execute(statementC), 'TRANSACTION_CLOSED');
      }
      proceed.resolve();
      await nested.catch(() => undefined);

      const ends = transactionIds(events).map(
        (id) =>
          events.filter((event) => event.activity?.id === id && event.name.startsWith('ended:'))
            .length,
      );
      expect({
        afterClose: trace(events.slice(before)),
        trace: trace(events),
        ends,
      }).toEqual({
        afterClose: '',
        trace: sent,
        ends: Array.from({ length: depth + 2 }, () => 1),
      });
    },
  );

  it.each([
    { enclosing: 'the outer transaction', depth: 0 },
    { enclosing: 'a savepoint', depth: 1 },
  ])(
    'closes the context of a nested call still running when $enclosing returned, and its open stream',
    async ({ depth }) => {
      const { runtime } = createSetup();
      const opened = deferred();
      const proceed = deferred();
      let inner: TransactionContext | undefined;
      let rows: AsyncIterator<unknown> | undefined;
      let nested: Promise<unknown> = Promise.resolve();
      const leave = async (ctx: TransactionContext) => {
        nested = ctx.transaction(async (nestedCtx) => {
          inner = nestedCtx;
          rows = nestedCtx.query(rawPlan('select id from t'))[Symbol.asyncIterator]();
          await rows.next();
          opened.resolve();
          await proceed.promise;
        });
        await opened.promise;
      };

      const run = withTransaction(runtime, (tx) =>
        depth === 0 ? leave(tx) : tx.transaction((middle) => leave(middle)),
      );
      await run.catch(() => undefined);

      expect(inner?.invalidated).toBe(true);
      await rejectsWith(Promise.resolve(rows?.next()), 'TRANSACTION_CLOSED');
      proceed.resolve();
      await nested.catch(() => undefined);
    },
  );
});
