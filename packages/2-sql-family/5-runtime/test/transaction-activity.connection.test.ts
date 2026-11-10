import { describe, expect, it } from 'vitest';
import type { RuntimeQueryable, RuntimeTransaction } from '../src/sql-runtime';
import {
  afterHookNames,
  createSetup,
  type DriverFailures,
  rawPlan,
  type Setup,
  stages,
} from './transaction-activity-fixtures';

function held(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('a statement sent on the connection while its transaction is open', () => {
  async function beginOnConnection(setup: Setup) {
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();
    await connection.execute(rawPlan('update t set x = 1'));
    return { connection, transaction };
  }

  it.each([
    {
      end: 'commit',
      outcome: 'committed',
      run: (transaction: RuntimeTransaction) => transaction.commit(),
    },
    {
      end: 'rollback',
      outcome: 'rolled-back',
      run: (transaction: RuntimeTransaction) => transaction.rollback(),
    },
  ])(
    'is the transaction child and is finalized $outcome when it ends with $end',
    async ({ end, outcome, run }) => {
      const setup = createSetup();
      const { transaction } = await beginOnConnection(setup);

      expect(stages(setup.events)).toEqual([]);
      await run(transaction);

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:succeeded',
        end,
        'ended:transaction:succeeded',
        `finalized:statement:${outcome}`,
        `finalized:transaction:${outcome}`,
      ]);
      const transactionCtx = setup.events.find((e) => e.name === 'started:transaction')?.ctx;
      const statementCtx = setup.events.find((e) => e.name === 'started:statement')?.ctx;
      expect(statementCtx?.parent).toBe(transactionCtx);
      expect(statementCtx?.scope).toBe('connection');
    },
  );

  it('waits for a later transaction on the connection when an earlier one ends again', async () => {
    const setup = createSetup({ failures: { commit: new Error('commit failed') } });
    const connection = await setup.runtime.connection();
    const earlier = await connection.transaction();
    await expect(earlier.commit()).rejects.toThrow('commit failed');
    const later = await connection.transaction();

    await earlier.rollback();
    await connection.execute(rawPlan('update t set x = 1'));
    expect(stages(setup.events)).toEqual([]);
    await later.rollback();

    expect(stages(setup.events)).toEqual(['finalized:statement:rolled-back']);
  });

  it('finalizes committed right after it ends once the transaction has ended', async () => {
    const setup = createSetup();
    const { connection, transaction } = await beginOnConnection(setup);
    await transaction.commit();

    await connection.execute(rawPlan('update t set x = 2'));

    expect(afterHookNames(setup.events).slice(-2)).toEqual([
      'ended:statement:succeeded',
      'finalized:statement:committed',
    ]);
  });
});

describe('a statement sent while commit or rollback is pending', () => {
  const pendingEnds = [
    { end: 'commit', outcome: 'committed' },
    { end: 'rollback', outcome: 'rolled-back' },
  ] as const;
  const cases = pendingEnds.flatMap((pending) =>
    (['connection', 'transaction'] as const).map((sentOn) => ({ ...pending, sentOn })),
  );

  it.each(cases)(
    'is finalized committed right after it ends when sent on the $sentOn while $end is pending, and the earlier statement gets $outcome',
    async ({ end, outcome, sentOn }) => {
      const endHeld = held();
      const failures: DriverFailures =
        end === 'commit'
          ? { commitHeldUntil: endHeld.promise }
          : { rollbackHeldUntil: endHeld.promise };
      const setup = createSetup({ failures });
      const connection = await setup.runtime.connection();
      const transaction = await connection.transaction();
      await transaction.execute(rawPlan('update t set x = 1'));

      const ending = transaction[end]();
      const target: RuntimeQueryable = sentOn === 'connection' ? connection : transaction;
      await target.execute(rawPlan('update t set x = 2'));
      endHeld.release();
      await ending;

      const afterHooks = setup.events.filter(
        (event) =>
          event.name !== 'beforeEncode' &&
          event.name !== 'begin' &&
          !event.name.startsWith('started:'),
      );
      expect(afterHooks.map((event) => [event.name, event.sql])).toEqual([
        ['ended:statement:succeeded', 'update t set x = 1'],
        ['ended:statement:succeeded', 'update t set x = 2'],
        ['finalized:statement:committed', 'update t set x = 2'],
        [end, undefined],
        ['ended:transaction:succeeded', undefined],
        [`finalized:statement:${outcome}`, 'update t set x = 1'],
        [`finalized:transaction:${outcome}`, undefined],
      ]);
    },
  );
});
