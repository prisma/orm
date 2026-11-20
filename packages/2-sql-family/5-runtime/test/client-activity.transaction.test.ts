import { startClientActivity } from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import { withTransaction } from '../src/sql-runtime';
import { testCall } from './client-activity-kinds';
import {
  createSetup,
  finalized,
  type HookEvent,
  names,
  rawPlan,
  trace,
} from './transaction-activity-fixtures';

function eventOf(events: readonly HookEvent[], name: string): HookEvent | undefined {
  return events.find((candidate) => candidate.name === name);
}

const driverCalls = (events: readonly HookEvent[]) =>
  names(events).filter((name) =>
    ['begin', 'commit', 'rollback', 'release', 'destroy'].includes(name),
  );

describe('the transaction of an activity handle', () => {
  describe('opened on the runtime', () => {
    it('runs the callback beneath the activity, commits and releases the connection', async () => {
      const { runtime, events } = createSetup();
      const call = await startActivityOn(runtime, testCall);

      const result = await call.transaction(async (tx) => {
        await tx.execute(rawPlan('update t set x = 1'));
        return 'done';
      });
      await call.end({ outcome: 'succeeded' });

      expect(result).toBe('done');
      expect(eventOf(events, 'started:transaction')?.ctx?.parent).toBe(
        eventOf(events, 'started:test-call')?.ctx,
      );
      expect(driverCalls(events)).toEqual(['begin', 'commit', 'release']);
      expect(names(events).filter((name) => name.startsWith('finalized:'))).toEqual([
        'finalized:statement:committed',
        'finalized:transaction:committed',
        'finalized:test-call:committed',
      ]);
    });

    it('rolls back, releases the connection and rethrows when the callback throws', async () => {
      const { runtime, events } = createSetup();
      const call = await startActivityOn(runtime, testCall);
      const failure = new Error('callback failed');

      await expect(
        call.transaction(async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'rollback', 'release']);
    });
  });

  it('of withTransaction starts beneath the parent it is given', async () => {
    const { runtime, events } = createSetup();
    await runtime.execute(rawPlan('select 1'));
    const context = eventOf(events, 'started:statement')?.ctx;
    if (context === undefined) throw new Error('no statement context');
    const parent = await startClientActivity(testCall, {
      middleware: [],
      context,
      parent: undefined,
      holdFinishedChildren: false,
    });

    await withTransaction(runtime, async () => undefined, undefined, parent);
    await parent.end({ outcome: 'succeeded' });

    expect(eventOf(events, 'started:transaction')?.ctx?.parent).toBe(parent.ctx);
  });

  describe('opened on a connection', () => {
    it('never releases the connection, after a commit, a rollback or a refused start', async () => {
      let transactionStarts = 0;
      const { runtime, events } = createSetup({
        middleware: [
          {
            name: 'refuse-third',
            familyId: 'sql',
            async activityStarted(activity) {
              if (activity.kind === 'transaction' && ++transactionStarts === 3) {
                throw new Error('refused');
              }
            },
          },
        ],
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await call.transaction(async () => undefined);
      await call.transaction(async () => Promise.reject(new Error('failed'))).catch(() => {});
      await call.transaction(async () => undefined).catch(() => {});
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit', 'begin', 'rollback']);
    });

    it('begins on that connection and leaves it held after commit and after rollback', async () => {
      const { runtime, events } = createSetup();
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await call.transaction(async (tx) => tx.execute(rawPlan('update t set x = 1')));
      await expect(
        call.transaction(async () => {
          throw new Error('callback failed');
        }),
      ).rejects.toThrow('callback failed');
      await call.end({ outcome: 'failed' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit', 'begin', 'rollback']);
    });

    it('destroys the connection after a failed rollback', async () => {
      const { runtime, events } = createSetup({
        failures: { rollback: new Error('rollback failed') },
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await expect(
        call.transaction(async () => {
          throw new Error('callback failed');
        }),
      ).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED' });
      await call.end({ outcome: 'failed' });

      expect(driverCalls(events)).toEqual(['begin', 'rollback', 'destroy']);
    });

    it('rejects a second transaction while the first is starting, and begins a new one after the first settles', async () => {
      let releaseStart: () => void = () => {};
      const startHeld = new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
      let transactionStarts = 0;
      const { runtime, events } = createSetup({
        middleware: [
          {
            name: 'slow-start',
            familyId: 'sql',
            async activityStarted(activity) {
              if (activity.kind === 'transaction' && ++transactionStarts === 1) await startHeld;
            },
          },
        ],
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      const first = call.transaction(async (tx) => tx.execute(rawPlan('update t set x = 1')));
      await expect(call.transaction(async () => undefined)).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
      });
      const beforeStart = driverCalls(events);
      releaseStart();
      await first;
      await call.transaction(async () => undefined);
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect({ beforeStart, beforeRelease }).toEqual({
        beforeStart: [],
        beforeRelease: ['begin', 'commit', 'begin', 'commit'],
      });
    });

    it('begins a new transaction after a refused start', async () => {
      const refusal = new Error('started failed');
      let transactionStarts = 0;
      const { runtime, events } = createSetup({
        middleware: [
          {
            name: 'refuse-first',
            familyId: 'sql',
            async activityStarted(activity) {
              if (activity.kind === 'transaction' && ++transactionStarts === 1) throw refusal;
            },
          },
        ],
      });
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await expect(call.transaction(async () => undefined)).rejects.toBe(refusal);
      await call.transaction(async () => undefined);
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit']);
    });

    it('rejects a second transaction while the first is open, leaving the connection held', async () => {
      const { runtime, events } = createSetup();
      const connection = await runtime.connection();
      const call = await startActivityOn(connection, testCall);

      await call.transaction(async () => {
        await expect(call.transaction(async () => undefined)).rejects.toMatchObject({
          code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
        });
      });
      await call.end({ outcome: 'succeeded' });
      const beforeRelease = driverCalls(events);
      await connection.release();

      expect(beforeRelease).toEqual(['begin', 'commit']);
    });
  });

  it('rejects on an ended handle without taking a connection', async () => {
    const { runtime, events } = createSetup();
    const call = await startActivityOn(runtime, testCall);
    await call.end({ outcome: 'succeeded' });

    await expect(call.transaction(async () => undefined)).rejects.toMatchObject({
      code: 'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    });
    expect(driverCalls(events)).toEqual([]);
  });

  describe('opened inside a transaction', () => {
    const startedBeneath = (events: readonly HookEvent[]) => {
      const calls: unknown[] = events
        .filter((event) => event.name === 'started:test-call')
        .map((event) => event.ctx);
      return events
        .filter((event) => event.name === 'started:transaction')
        .map((event) => calls.indexOf(event.ctx?.parent));
    };

    it('runs the callback in a savepoint beneath the activity, and beneath a nested activity', async () => {
      const { runtime, events } = createSetup();
      const connection = await runtime.connection();
      const transaction = await connection.transaction();
      const call = await startActivityOn(transaction, testCall);
      const nested = await call.startActivity(testCall);

      const results = [
        await call.transaction(async (sp) => {
          await sp.execute(rawPlan('insert a'));
          return 'a';
        }),
        await nested.transaction(async () => 'b'),
      ];
      await nested.end({ outcome: 'succeeded' });
      await call.end({ outcome: 'succeeded' });
      await transaction.commit();
      await connection.release();

      expect({
        results,
        sent: trace(events),
        beneath: startedBeneath(events),
        finalized: finalized(events),
      }).toEqual({
        results: ['a', 'b'],
        sent: 'begin, SAVEPOINT sp_1, insert a, RELEASE SAVEPOINT sp_1, SAVEPOINT sp_2, RELEASE SAVEPOINT sp_2, commit, release',
        beneath: [-1, 0, 1],
        finalized:
          'transaction:committed, test-call:committed, statement:committed, transaction:committed, test-call:committed, transaction:committed',
      });
    });

    it('rolls back to the savepoint and rethrows when the callback throws, leaving the transaction usable', async () => {
      const { runtime, events } = createSetup();
      const failure = new Error('callback failed');

      await withTransaction(runtime, async (tx) => {
        const call = await startActivityOn(tx, testCall);
        await expect(
          call.transaction(async (sp) => {
            await sp.execute(rawPlan('insert a'));
            throw failure;
          }),
        ).rejects.toBe(failure);
        await call.end({ outcome: 'failed' });
        await tx.execute(rawPlan('insert b'));
      });

      expect({ sent: trace(events), finalized: finalized(events) }).toEqual({
        sent: 'begin, SAVEPOINT sp_1, insert a, ROLLBACK TO SAVEPOINT sp_1, insert b, commit, release',
        finalized:
          'statement:rolled-back, transaction:rolled-back, test-call:committed, statement:committed, transaction:committed',
      });
    });

    it('rejects options with RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED without starting or sending anything', async () => {
      const { runtime, events } = createSetup();
      const connection = await runtime.connection();
      const transaction = await connection.transaction();
      const call = await startActivityOn(transaction, testCall);
      const fn = vi.fn(async () => undefined);

      await expect(call.transaction(fn, { isolationLevel: 'serializable' })).rejects.toMatchObject({
        code: 'RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED',
        details: { options: { isolationLevel: 'serializable' } },
      });
      await call.end({ outcome: 'failed' });
      await transaction.commit();
      await connection.release();

      expect({
        called: fn.mock.calls.length,
        starts: startedBeneath(events).length,
        sent: trace(events),
      }).toEqual({ called: 0, starts: 1, sent: 'begin, commit, release' });
    });

    it('opens a savepoint on the open transaction of the connection it was opened on', async () => {
      const { runtime, events } = createSetup();
      const connection = await runtime.connection();
      const transaction = await connection.transaction();
      const call = await startActivityOn(connection, testCall);

      await call.transaction(async (sp) => sp.execute(rawPlan('insert a')));
      await call.end({ outcome: 'succeeded' });
      await transaction.commit();
      await connection.release();

      expect(trace(events)).toBe(
        'begin, SAVEPOINT sp_1, insert a, RELEASE SAVEPOINT sp_1, commit, release',
      );
    });

    it('opens a savepoint through a withTransaction context, and rejects RUNTIME.TRANSACTION_CLOSED once the context is closed', async () => {
      const { runtime, events } = createSetup();

      const call = await withTransaction(runtime, async (tx) => {
        const handle = await startActivityOn(tx, testCall);
        await handle.transaction(async (sp) => sp.execute(rawPlan('insert a')));
        return handle;
      });
      const sentBeforeClosed = trace(events);
      await expect(call.transaction(async () => undefined)).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });

      expect({ sentBeforeClosed, sent: trace(events) }).toEqual({
        sentBeforeClosed:
          'begin, SAVEPOINT sp_1, insert a, RELEASE SAVEPOINT sp_1, commit, release',
        sent: sentBeforeClosed,
      });
    });
  });

  it('reports whether the handle is inside a transaction', async () => {
    const { runtime } = createSetup();
    const onRuntime = await startActivityOn(runtime, testCall);
    const connection = await runtime.connection();
    const onConnection = await startActivityOn(connection, testCall);
    const transaction = await connection.transaction();
    const onTransaction = await startActivityOn(transaction, testCall);
    const nested = await onTransaction.startActivity(testCall);
    const onOpenConnection = await startActivityOn(connection, testCall);
    const inContext = await withTransaction(runtime, async (tx) => {
      const handle = await startActivityOn(tx, testCall);
      const inside = handle.inTransaction();
      await handle.end({ outcome: 'succeeded' });
      return inside;
    });

    expect(onRuntime.inTransaction()).toBe(false);
    expect(onConnection.inTransaction()).toBe(false);
    expect(onTransaction.inTransaction()).toBe(true);
    expect(nested.inTransaction()).toBe(true);
    expect(onOpenConnection.inTransaction()).toBe(true);
    expect(inContext).toBe(true);
    for (const handle of [nested, onTransaction, onOpenConnection, onConnection, onRuntime]) {
      await handle.end({ outcome: 'succeeded' });
    }
    await transaction.commit();
    await connection.release();
  });
});
