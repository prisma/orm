import { describe, expect, it, vi } from 'vitest';
import type {
  Activity,
  ActivityContext,
  RuntimeMiddleware,
} from '../src/execution/runtime-middleware';
import {
  startTransactionActivity,
  type TransactionSettlement,
} from '../src/execution/transaction-activity';
import {
  collect,
  contextFields,
  executeStatementWith,
  type MockExec,
  queryStatement,
  recorder,
  yieldRows,
} from './statement-fixtures';

function openTransaction(middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>) {
  return startTransactionActivity({
    middleware,
    context: contextFields({ scope: 'transaction' }),
    parent: undefined,
    holdFinishedChildren: true,
  });
}

describe('transaction activity', () => {
  it('starts with a transaction activity and its own context', async () => {
    const started: Array<{ activity: Activity; ctx: ActivityContext }> = [];
    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async activityStarted(activity, ctx) {
        started.push({ activity, ctx });
      },
    };

    const transaction = await openTransaction([observer]);

    expect(started).toEqual([{ activity: transaction.activity, ctx: transaction.ctx }]);
    expect(transaction.activity).toEqual({
      id: expect.any(String),
      kind: 'transaction',
      annotations: new Map(),
    });
    expect(transaction.ctx.scope).toBe('transaction');
  });

  it('holds its statements until it ends, then finalizes them in start order and itself last', async () => {
    const events: string[] = [];
    const middleware = [recorder('A', events)];
    const transaction = await openTransaction(middleware);

    await collect(
      queryStatement(middleware, () => yieldRows([{ id: 1 }]), { parent: transaction }),
    );
    await executeStatementWith(middleware, async () => ({ affectedRows: 1 }), {
      parent: transaction,
    });
    const beforeEnd = [...events];
    await transaction.end({ by: 'commit', outcome: 'succeeded' });

    expect(beforeEnd.filter((event) => event.includes('finalized'))).toEqual([]);
    expect(events.filter((event) => /:(started|ended|finalized):/.test(event))).toEqual([
      'A:started:transaction',
      'A:started:statement',
      'A:ended:statement:succeeded',
      'A:started:statement',
      'A:ended:statement:succeeded',
      'A:ended:transaction:succeeded',
      'A:finalized:statement:committed',
      'A:finalized:statement:committed',
      'A:finalized:transaction:committed',
    ]);
  });

  describe('finalization outcome', () => {
    it.each<{
      readonly name: string;
      readonly childFails: boolean;
      readonly settlement: TransactionSettlement;
      readonly outcome: string;
    }>([
      {
        name: 'commit resolved, no statement failed',
        childFails: false,
        settlement: { by: 'commit', outcome: 'succeeded' },
        outcome: 'committed',
      },
      {
        name: 'commit resolved after a statement failed',
        childFails: true,
        settlement: { by: 'commit', outcome: 'succeeded' },
        outcome: 'unknown',
      },
      {
        name: 'commit rejected',
        childFails: false,
        settlement: { by: 'commit', outcome: 'failed' },
        outcome: 'unknown',
      },
      {
        name: 'rollback settled, no commit attempted',
        childFails: true,
        settlement: { by: 'rollback', outcome: 'succeeded', commitAttempted: false },
        outcome: 'rolled-back',
      },
      {
        name: 'rollback rejected, no commit attempted',
        childFails: false,
        settlement: { by: 'rollback', outcome: 'failed', commitAttempted: false },
        outcome: 'rolled-back',
      },
      {
        name: 'rollback after a commit was attempted',
        childFails: false,
        settlement: { by: 'rollback', outcome: 'succeeded', commitAttempted: true },
        outcome: 'unknown',
      },
    ])('is $outcome when $name', async ({ childFails, settlement, outcome }) => {
      const outcomes: string[] = [];
      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async activityFinalized(activity, result) {
          outcomes.push(`${activity.kind}:${result.outcome}`);
        },
      };
      const transaction = await openTransaction([observer]);

      await executeStatementWith([observer], async () => ({ affectedRows: 1 }), {
        parent: transaction,
      });
      if (childFails) {
        await expect(
          executeStatementWith(
            [observer],
            async () => {
              throw new Error('statement failed');
            },
            { parent: transaction },
          ),
        ).rejects.toThrow('statement failed');
      }
      await transaction.end(settlement);

      expect(new Set(outcomes)).toEqual(
        new Set([`statement:${outcome}`, `transaction:${outcome}`]),
      );
    });

    it('does not count a statement the caller stopped reading as a failure', async () => {
      const outcomes: string[] = [];
      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async activityFinalized(activity, result) {
          outcomes.push(`${activity.kind}:${result.outcome}`);
        },
      };
      const transaction = await openTransaction([observer]);

      for await (const _row of queryStatement([observer], () => yieldRows([{}, {}]), {
        parent: transaction,
      })) {
        break;
      }
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(outcomes).toEqual(['statement:committed', 'transaction:committed']);
    });
  });

  it('finalizes a statement still running when the transaction ends after it ends, with the transaction outcome', async () => {
    const events: string[] = [];
    const key = Symbol('kept');
    const kept: unknown[] = [];
    const keeper: RuntimeMiddleware<MockExec> = {
      name: 'keeper',
      async activityStarted(activity, ctx) {
        if (activity.kind === 'statement') ctx.state(key)['value'] = 'kept';
      },
      async activityFinalized(activity, _result, ctx) {
        if (activity.kind === 'statement') kept.push(ctx.state(key)['value']);
      },
    };
    const middleware = [recorder('A', events), keeper];
    const transaction = await openTransaction(middleware);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = executeStatementWith(
      middleware,
      async () => {
        await gate;
        return { affectedRows: 1 };
      },
      { parent: transaction },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await transaction.end({ by: 'commit', outcome: 'succeeded' });
    release();
    await running;

    expect(events.filter((event) => /:(ended|finalized):/.test(event))).toEqual([
      'A:ended:transaction:succeeded',
      'A:finalized:transaction:committed',
      'A:ended:statement:succeeded',
      'A:finalized:statement:committed',
    ]);
    expect(kept).toEqual(['kept']);
  });

  it('does not wait for a statement still running when the transaction ends', async () => {
    const events: string[] = [];
    const middleware = [recorder('A', events)];
    const transaction = await openTransaction(middleware);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = executeStatementWith(
      middleware,
      async () => {
        await gate;
        return { affectedRows: 1 };
      },
      { parent: transaction },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    await transaction.end({ by: 'rollback', outcome: 'succeeded', commitAttempted: false });
    expect(events).not.toContain('A:finalized:statement:rolled-back');

    release();
    await running;
    expect(events.at(-1)).toBe('A:finalized:statement:rolled-back');
  });

  it('ends and finalizes only once when end is called twice', async () => {
    const events: string[] = [];
    const transaction = await openTransaction([recorder('A', events)]);

    await transaction.end({ by: 'commit', outcome: 'failed' });
    await transaction.end({ by: 'rollback', outcome: 'succeeded', commitAttempted: true });

    expect(events).toEqual([
      'A:started:transaction',
      'A:ended:transaction:failed',
      'A:finalized:transaction:unknown',
    ]);
  });

  it('refuses to adopt an activity once it has ended', async () => {
    const transaction = await openTransaction([]);
    await transaction.end({ by: 'commit', outcome: 'succeeded' });

    expect(() => transaction.adopt({ finalize: async () => {} })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
        message:
          'An activity was started beneath a transaction that no longer accepts children: its commit() or rollback() has been called',
      }),
    );
  });

  it('resolves end only after every finalized hook has resolved', async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deferred: RuntimeMiddleware<MockExec> = {
      name: 'deferred',
      async activityFinalized(activity) {
        if (activity.kind === 'statement') await gate;
        events.push(`finalized:${activity.kind}`);
      },
    };
    const transaction = await openTransaction([deferred]);
    await executeStatementWith([deferred], async () => ({ affectedRows: 1 }), {
      parent: transaction,
    });

    const ending = transaction
      .end({ by: 'commit', outcome: 'succeeded' })
      .then(() => events.push('end resolved'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    events.push('released');
    release();
    await ending;

    expect(events).toEqual([
      'released',
      'finalized:statement',
      'finalized:transaction',
      'end resolved',
    ]);
  });

  describe('errors', () => {
    it('rethrows an activityEnded error after a successful settlement, once finalization has run', async () => {
      const events: string[] = [];
      const endedError = new Error('ended failed');
      const failing: RuntimeMiddleware<MockExec> = {
        name: 'failing',
        async activityEnded() {
          throw endedError;
        },
      };
      const transaction = await openTransaction([failing, recorder('A', events)]);

      await expect(transaction.end({ by: 'commit', outcome: 'succeeded' })).rejects.toBe(
        endedError,
      );
      expect(events).toEqual([
        'A:started:transaction',
        'A:ended:transaction:succeeded',
        'A:finalized:transaction:committed',
      ]);
    });

    it('swallows an activityEnded error after a failed settlement', async () => {
      const events: string[] = [];
      const failing: RuntimeMiddleware<MockExec> = {
        name: 'failing',
        async activityEnded() {
          throw new Error('ended failed');
        },
      };
      const transaction = await openTransaction([failing, recorder('A', events)]);

      await expect(transaction.end({ by: 'commit', outcome: 'failed' })).resolves.toBeUndefined();
      expect(events).toEqual([
        'A:started:transaction',
        'A:ended:transaction:failed',
        'A:finalized:transaction:unknown',
      ]);
    });

    it('logs and swallows an activityFinalized error, and still finalizes later activities', async () => {
      const error = vi.fn();
      const failure = new Error('finalized failed');
      const later = vi.fn(async () => {});
      const middleware: RuntimeMiddleware<MockExec>[] = [
        {
          name: 'failing',
          async activityFinalized() {
            throw failure;
          },
        },
        { name: 'later', activityFinalized: later },
      ];
      const transaction = await startTransactionActivity({
        holdFinishedChildren: true,
        middleware,
        context: contextFields({ log: { info: vi.fn(), warn: vi.fn(), error } }),
        parent: undefined,
      });
      await executeStatementWith(middleware, async () => ({ affectedRows: 1 }), {
        parent: transaction,
      });

      await expect(
        transaction.end({ by: 'commit', outcome: 'succeeded' }),
      ).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith({
        event: 'middleware.activityFinalized.error',
        middleware: 'failing',
        error: failure,
      });
      expect(later).toHaveBeenCalledTimes(2);
    });

    it('ends failed, finalizes rolled-back and rethrows when activityStarted throws', async () => {
      const events: string[] = [];
      const refused = new Error('started failed');
      const failing: RuntimeMiddleware<MockExec> = {
        ...recorder('failing', events),
        async activityStarted() {
          events.push('failing:started:transaction');
          throw refused;
        },
      };

      await expect(
        openTransaction([recorder('A', events), failing, recorder('B', events)]),
      ).rejects.toBe(refused);
      expect(events).toEqual([
        'A:started:transaction',
        'failing:started:transaction',
        'A:ended:transaction:failed',
        'failing:ended:transaction:failed',
        'A:finalized:transaction:rolled-back',
        'failing:finalized:transaction:rolled-back',
      ]);
    });
  });

  describe('a transaction that does not hold its finished children', () => {
    function open(middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>) {
      return startTransactionActivity({
        middleware,
        context: contextFields({ scope: 'transaction' }),
        parent: undefined,
        holdFinishedChildren: false,
      });
    }

    it('keeps no finished child, so it finalizes none when it ends', async () => {
      const transaction = await open([]);
      const finalize = vi.fn(async () => {});

      const slot = transaction.adopt({ finalize });
      await slot.ended({ outcome: 'committed' });
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(finalize).not.toHaveBeenCalled();
    });

    it('still reports unknown for a resolved commit after a failed child', async () => {
      const outcomes: string[] = [];
      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async activityFinalized(activity, result) {
          if (activity.kind === 'transaction') outcomes.push(result.outcome);
        },
      };
      const transaction = await open([observer]);

      await expect(
        executeStatementWith(
          [],
          async () => {
            throw new Error('statement failed');
          },
          { parent: transaction },
        ),
      ).rejects.toThrow('statement failed');
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(outcomes).toEqual(['unknown']);
    });

    it('still ends its statements and gives them the transaction as parent', async () => {
      const events: string[] = [];
      const transaction = await open([]);
      let parent: unknown;
      const observer: RuntimeMiddleware<MockExec> = {
        ...recorder('A', events),
        async activityStarted(_activity, ctx) {
          parent = ctx.parent;
        },
      };

      await executeStatementWith([observer], async () => ({ affectedRows: 1 }), {
        parent: transaction,
      });
      await transaction.end({ by: 'commit', outcome: 'succeeded' });

      expect(parent).toBe(transaction.ctx);
      expect(events).toContain('A:ended:statement:succeeded');
    });
  });
});
