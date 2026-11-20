import { describe, expect, it } from 'vitest';
import type { RuntimeTransactionOptions } from '../src/sql-runtime';
import { createSetup, names } from './transaction-activity-fixtures';

const transactionClosed = { code: 'RUNTIME.TRANSACTION_CLOSED' };

const driverCommit = (events: Parameters<typeof names>[0]) =>
  names(events).filter((name) => name === 'commit' || name.startsWith('RELEASE'));

const ended = (events: Parameters<typeof names>[0]) =>
  names(events).filter((name) => name.startsWith('ended:'));

describe('commit() after rollback()', () => {
  it.each<{ title: string; options: RuntimeTransactionOptions | undefined }>([
    { title: 'no timeout', options: undefined },
    { title: 'a timeout', options: { timeout: 5_000 } },
  ])(
    'rejects with TRANSACTION_CLOSED and sends no COMMIT when the transaction has $title',
    async ({ options }) => {
      const { runtime, events } = createSetup();
      const transaction = await (await runtime.connection()).transaction(options);
      await transaction.rollback();
      const endedBeforeCommit = ended(events);

      await expect(transaction.commit()).rejects.toMatchObject(transactionClosed);

      expect(driverCommit(events)).toEqual([]);
      expect(ended(events)).toEqual(endedBeforeCommit);
    },
  );

  describe('a savepoint', () => {
    it('rejects commit() after rollback() and sends no RELEASE', async () => {
      const { runtime, events } = createSetup();
      const transaction = await (await runtime.connection()).transaction();
      const savepoint = await transaction.transaction();
      await savepoint.rollback();
      const endedBeforeCommit = ended(events);

      await expect(savepoint.commit()).rejects.toMatchObject(transactionClosed);

      expect(driverCommit(events)).toEqual([]);
      expect(ended(events)).toEqual(endedBeforeCommit);
    });
  });
});
