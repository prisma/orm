import type { SqlTransactionOptions } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import { withTransaction } from '../src/sql-runtime';
import { testCall } from './client-activity-kinds';
import { createSetup, names, type Setup } from './transaction-activity-fixtures';

const starts: (SqlTransactionOptions | undefined)[] = [
  undefined,
  {},
  { isolationLevel: undefined },
  { isolationLevel: 'Serializable' },
];

async function acquiredConnection(setup: Setup) {
  const connection = await vi.mocked(setup.driver.acquireConnection).mock.results.at(-1)?.value;
  expect(connection).toBeDefined();
  if (!connection) throw new Error('Expected an acquired connection');
  return connection;
}

describe.each(starts)('transaction start %j', (start) => {
  it('forwards the request on a held connection without retaining it for the next start', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction(start);
    await transaction.commit();
    const next = await connection.transaction();
    await next.rollback();
    await connection.release();

    expect(vi.mocked((await acquiredConnection(setup)).beginTransaction).mock.calls).toEqual([
      [start],
      [undefined],
    ]);
  });

  it.each(['runtime', 'connection'] as const)(
    'forwards the request through nested activities on the %s route',
    async (route) => {
      const setup = createSetup();
      const connection = route === 'connection' ? await setup.runtime.connection() : undefined;
      const outer = await startActivityOn(connection ?? setup.runtime, testCall);
      const inner = await outer.startActivity(testCall);
      expect(inner.transaction).toBeTypeOf('function');
      const transaction = await inner.transaction?.(start);
      expect(transaction).toBeDefined();
      if (!transaction) throw new Error('Expected a transaction');
      const child = await startActivityOn(transaction, testCall);
      expect(child.transaction).toBeUndefined();
      await child.end({ outcome: 'succeeded' });
      await transaction.commit();
      await inner.end({ outcome: 'succeeded' });
      await outer.end({ outcome: 'succeeded' });

      const driverConnection = await acquiredConnection(setup);
      expect(vi.mocked(driverConnection.beginTransaction).mock.calls).toEqual([[start]]);
      expect(setup.driver.acquireConnection).toHaveBeenCalledTimes(1);
      expect(driverConnection.release).toHaveBeenCalledTimes(route === 'runtime' ? 1 : 0);
      expect(driverConnection.destroy).not.toHaveBeenCalled();
      const activities = setup.events.filter((event) => event.name === 'started:test-call');
      expect(setup.events.find((event) => event.name === 'started:transaction')?.ctx?.parent).toBe(
        activities[1]?.ctx,
      );
      await connection?.release();
    },
  );
});

describe('callback transaction options', () => {
  it.each([undefined, {}, { isolationLevel: undefined }, { isolationLevel: 'Serializable' }])(
    'forwards resolved options %j without an ORM discriminator',
    async (options) => {
      const setup = createSetup();
      const result = await withTransaction(
        setup.runtime,
        async (tx) => {
          const activity = await startActivityOn(tx, testCall);
          expect(activity.transaction).toBeUndefined();
          await activity.end({ outcome: 'succeeded' });
          return 42;
        },
        options,
      );
      expect(result).toBe(42);
      expect(vi.mocked((await acquiredConnection(setup)).beginTransaction).mock.calls).toEqual([
        [options],
      ]);
      const manual = await setup.runtime.connection();
      await (await manual.transaction()).rollback();
      expect((await acquiredConnection(setup)).beginTransaction).toHaveBeenLastCalledWith(
        undefined,
      );
      await manual.release();
    },
  );
});

describe.each(['callback', 'activity'] as const)('%s start failure ownership', (route) => {
  it.each(['refused', 'attempted'] as const)(
    'preserves the %s start failure across end-hook and disposal failures',
    async (failure) => {
      const original = new Error('start failed');
      const hookError = new Error('end failed');
      const callback = vi.fn(async () => undefined);
      const setup = createSetup({
        failures: {
          ...(failure === 'attempted' ? { begin: original } : {}),
          release: new Error('release failed'),
          destroy: new Error('destroy failed'),
        },
        middleware: [
          {
            name: 'failing-transaction-hooks',
            familyId: 'sql',
            async activityStarted(activity) {
              if (activity.kind === 'transaction' && failure === 'refused') throw original;
            },
            async activityEnded(activity) {
              if (activity.kind === 'transaction') throw hookError;
            },
          },
        ],
      });
      const activity =
        route === 'activity' ? await startActivityOn(setup.runtime, testCall) : undefined;
      const run = activity
        ? activity.transaction?.(undefined)
        : withTransaction(setup.runtime, callback, { isolationLevel: 'Serializable' });
      await expect(run).rejects.toBe(original);
      await activity?.end({ outcome: 'failed' });

      const connection = await acquiredConnection(setup);
      expect(callback).not.toHaveBeenCalled();
      expect(vi.mocked(connection.beginTransaction).mock.calls).toEqual(
        failure === 'refused'
          ? []
          : [[route === 'activity' ? undefined : { isolationLevel: 'Serializable' }]],
      );
      expect(connection.release).toHaveBeenCalledTimes(failure === 'refused' ? 1 : 0);
      expect(connection.destroy).toHaveBeenCalledTimes(failure === 'attempted' ? 1 : 0);
      if (failure === 'attempted') expect(connection.destroy).toHaveBeenCalledWith(original);
      expect(names(setup.events).filter((name) => name.startsWith('ended:transaction:'))).toEqual([
        'ended:transaction:failed',
      ]);
      expect(
        names(setup.events).filter((name) => name.startsWith('finalized:transaction:')),
      ).toEqual(['finalized:transaction:rolled-back']);
      await setup.runtime.close();
    },
  );
});
