import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { type TransactionContext, withSavepoint, withTransaction } from '../src/sql-runtime';
import { createSetup, type HookEvent, rawPlan } from './transaction-activity-fixtures';

const statementB = rawPlan('insert b');
const statementC = rawPlan('insert c');

const trace = (events: readonly HookEvent[]) =>
  events
    .map((event) => (event.name === 'beforeEncode' ? event.sql : event.name))
    .filter(
      (name): name is string =>
        name !== undefined &&
        /^(SAVEPOINT|RELEASE|ROLLBACK|begin|commit|rollback|release|destroy|insert)/.test(name),
    )
    .join(', ');

const finalized = (events: readonly HookEvent[]) =>
  events
    .map((event) => event.name)
    .filter((name) => name.startsWith('finalized:'))
    .map((name) => name.slice('finalized:'.length))
    .join(', ');

const rejectsWith = (work: Promise<unknown>, code: string) =>
  expect(work).rejects.toMatchObject({ code: `RUNTIME.${code}` });

const build = (ctx: TransactionContext) => ({ ctx });

const savepointMiddleware = (hooks: Omit<SqlMiddleware, 'name' | 'familyId'>): SqlMiddleware => ({
  name: 'savepoint-hooks',
  familyId: 'sql',
  ...hooks,
});

describe('withSavepoint', () => {
  it('releases the savepoint after the callback resolves, builds the context at each level and names a nested savepoint sp_2', async () => {
    const { runtime, events } = createSetup();
    const builder = vi.fn(build);

    const result = await withTransaction(runtime, (tx) =>
      withSavepoint(
        tx,
        async (middle) => {
          await middle.ctx.execute(statementB);
          return withSavepoint(
            middle.ctx,
            async (inner) => {
              await inner.ctx.execute(statementC);
              return 42;
            },
            builder,
          );
        },
        builder,
      ),
    );

    expect(result).toBe(42);
    expect(builder).toHaveBeenCalledTimes(2);
    expect(trace(events)).toBe(
      'begin, SAVEPOINT sp_1, insert b, SAVEPOINT sp_2, insert c, RELEASE SAVEPOINT sp_2, RELEASE SAVEPOINT sp_1, commit, release',
    );
  });

  it('rolls back to the savepoint when the callback throws, rethrows the error and leaves the outer transaction usable', async () => {
    const { runtime, events } = createSetup();
    const error = new Error('nope');

    await withTransaction(runtime, async (tx) => {
      await expect(
        withSavepoint(
          tx,
          async (inner) => {
            await inner.ctx.execute(statementB);
            throw error;
          },
          build,
        ),
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
      await expect(withSavepoint(tx, async () => 1, build)).rejects.toMatchObject({
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
        withSavepoint(
          tx,
          async () => {
            throw error;
          },
          build,
        ),
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
      await expect(withSavepoint(tx, callback, build)).rejects.toBe(refusal);
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
      await expect(withSavepoint(tx, async () => 1, build)).rejects.toBe(hookError);
    });

    expect(trace(events)).toBe('begin, SAVEPOINT sp_1, RELEASE SAVEPOINT sp_1, commit, release');
  });

  it('refuses work on the nested context after the nested call settled, sending nothing', async () => {
    const { runtime, events } = createSetup();

    await withTransaction(runtime, async (tx) => {
      const escaped = await withSavepoint(tx, async (inner) => inner.ctx, build);
      const before = events.length;

      expect(escaped.invalidated).toBe(true);
      await rejectsWith(escaped.execute(statementC), 'TRANSACTION_CLOSED');
      await rejectsWith(escaped.query(statementC).toArray(), 'TRANSACTION_CLOSED');
      await rejectsWith(
        withSavepoint(escaped, async () => 1, build),
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
        nested = withSavepoint(tx, () => new Promise<never>(() => {}), build);
        return nested;
      },
      { timeout: 1 },
    );

    await rejectsWith(run, 'TRANSACTION_TIMEOUT');
    await rejectsWith(nested, 'TRANSACTION_TIMEOUT');
    const savepointId = events.filter((event) => event.name === 'started:transaction')[1]?.activity
      ?.id;
    expect(
      events.filter((event) => event.activity?.id === savepointId).map((event) => event.name),
    ).toEqual([
      'started:transaction',
      'ended:transaction:failed',
      'finalized:transaction:rolled-back',
    ]);
  });

  it('rejects a context the runtime did not make', async () => {
    const { runtime } = createSetup();

    await withTransaction(runtime, async (tx) => {
      const foreign: TransactionContext = {
        invalidated: false,
        query: (plan) => tx.query(plan),
        execute: (plan) => tx.execute(plan),
      };
      await rejectsWith(
        withSavepoint(foreign, async () => 1, build),
        'UNKNOWN_TRANSACTION_CONTEXT',
      );
    });
  });
});
