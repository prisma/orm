import { describe, expect, it } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import { testCall } from './client-activity-kinds';
import {
  afterHookNames,
  createSetup,
  type HookEvent,
  names,
  rawPlan,
  type SetupOptions,
} from './transaction-activity-fixtures';

async function begin(options: SetupOptions = {}) {
  const setup = createSetup(options);
  const connection = await setup.runtime.connection();
  const transaction = await connection.transaction();
  return { ...setup, connection, transaction };
}

type SavepointOrTransaction = Awaited<ReturnType<typeof begin>>['transaction'];

const update = rawPlan('update t set x = 1');

const driverCalls = (events: readonly HookEvent[]) =>
  names(events)
    .filter((name) => /^(SAVEPOINT|RELEASE|ROLLBACK|begin|commit|rollback)/.test(name))
    .join(', ');

const finalized = (events: readonly HookEvent[]) =>
  names(events)
    .filter((name) => name.startsWith('finalized:'))
    .map((name) => name.slice('finalized:'.length))
    .join(', ');

const transactionIds = (events: readonly HookEvent[]) =>
  events.filter((event) => event.name === 'started:transaction').map((e) => e.activity?.id);

const rejectsWith = (work: Promise<unknown>, code: string) =>
  expect(work).rejects.toMatchObject({ code: `RUNTIME.${code}` });

describe('RuntimeTransaction.transaction()', () => {
  it.each([
    {
      title: 'releases',
      failures: {},
      settle: (savepoint: SavepointOrTransaction) => savepoint.commit(),
      sent: 'RELEASE SAVEPOINT sp_1',
      outcome: 'committed',
    },
    {
      title: 'rolls back',
      failures: {},
      settle: (savepoint: SavepointOrTransaction) => savepoint.rollback(),
      sent: 'ROLLBACK TO SAVEPOINT sp_1',
      outcome: 'rolled-back',
    },
    {
      title: 'rolls back after a failed RELEASE',
      failures: { releaseSavepoint: new Error('release failed') },
      settle: async (
        savepoint: SavepointOrTransaction,
        transaction: SavepointOrTransaction,
        events: HookEvent[],
      ) => {
        await expect(savepoint.commit()).rejects.toThrow('release failed');
        await rejectsWith(transaction.execute(update), 'TRANSACTION_SUSPENDED');
        expect(finalized(events)).toBe('');
        await savepoint.rollback();
      },
      sent: 'RELEASE SAVEPOINT sp_1, ROLLBACK TO SAVEPOINT sp_1',
      outcome: 'rolled-back',
    },
  ])(
    'runs statements on a savepoint beneath the outer transaction that $title, and commits the outer transaction',
    async ({ failures, settle, sent, outcome }) => {
      const savepointWork = `statement:${outcome}, transaction:${outcome}`;
      const { transaction, events } = await begin({ failures });
      const savepoint = await transaction.transaction();
      await savepoint.execute(update);

      await settle(savepoint, transaction, events);
      expect(finalized(events)).toBe(outcome === 'committed' ? '' : savepointWork);
      await transaction.execute(update);
      await transaction.commit();
      await rejectsWith(savepoint.execute(update), 'TRANSACTION_CLOSED');

      const [outer, inner, statement] = events.filter((e) => e.name.startsWith('started:'));
      expect(inner?.ctx?.parent).toBe(outer?.ctx);
      expect(statement?.ctx?.parent).toBe(inner?.ctx);
      expect(driverCalls(events)).toBe(`begin, SAVEPOINT sp_1, ${sent}, commit`);
      expect(finalized(events)).toBe(
        `${savepointWork}, statement:committed, transaction:committed`,
      );
    },
  );

  it('rejects a second savepoint while one is open, naming the top of the stack and sending nothing', async () => {
    const { transaction, events } = await begin();
    const [opened, concurrent] = await Promise.allSettled([
      transaction.transaction(),
      transaction.transaction(),
    ]);
    const before = events.length;

    expect(concurrent).toMatchObject({ reason: { code: 'RUNTIME.TRANSACTION_ALREADY_OPEN' } });
    await expect(transaction.transaction()).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
      message: expect.stringContaining('sp_1'),
    });
    expect(events.slice(before)).toEqual([]);

    if (opened?.status !== 'fulfilled') throw new Error('the first savepoint did not open');
    const nested = await opened.value.transaction();
    await expect(transaction.transaction()).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
      message: expect.stringContaining('sp_2'),
      details: { savepointId: transactionIds(events)[2] },
    });

    await nested.commit();
    await opened.value.commit();
    await expect(transaction.transaction()).resolves.toBeDefined();
  });

  it.each([
    { title: 'a statement', run: (target: SavepointOrTransaction) => target.execute(update) },
    {
      title: 'a query',
      run: (target: SavepointOrTransaction) => target.query(rawPlan('select 1')).toArray(),
    },
    { title: 'commit()', run: (target: SavepointOrTransaction) => target.commit() },
    { title: 'rollback()', run: (target: SavepointOrTransaction) => target.rollback() },
  ])(
    'suspends $title below the top of the stack until the savepoints above settle, naming the top',
    async ({ run }) => {
      const { transaction, events } = await begin();
      const outerChild = await transaction.transaction();
      const innerChild = await outerChild.transaction();
      const before = events.length;

      for (const below of [outerChild, transaction]) {
        await expect(run(below)).rejects.toMatchObject({
          code: 'RUNTIME.TRANSACTION_SUSPENDED',
          message: expect.stringContaining('sp_2'),
          details: { savepointId: transactionIds(events)[2] },
        });
      }
      expect(events.slice(before)).toEqual([]);

      await innerChild.commit();
      await run(outerChild);
    },
  );

  it('suspends statements on the connection while a savepoint is open on its transaction', async () => {
    const { connection, transaction, events } = await begin();
    const savepoint = await transaction.transaction();
    const before = events.length;

    await rejectsWith(connection.execute(update), 'TRANSACTION_SUSPENDED');
    await rejectsWith(connection.query(rawPlan('select 1')).toArray(), 'TRANSACTION_SUSPENDED');
    expect(events.slice(before)).toEqual([]);
    await savepoint.commit();
    await connection.execute(update);
    await transaction.commit();
    await connection.execute(update);

    const [outer, , inTransaction, after] = events.filter((e) => e.name.startsWith('started:'));
    expect(inTransaction?.ctx?.parent).toBe(outer?.ctx);
    expect(after?.ctx?.parent).toBeUndefined();
  });

  it('rolls back only the outer transaction after its timeout, and the open savepoint refuses work and closes on its own rollback', async () => {
    const { runtime, events } = createSetup();
    const connection = await runtime.connection();
    const transaction = await connection.transaction({ timeout: 1 });
    const savepoint = await transaction.transaction();
    await savepoint.execute(update);
    const [outerId, savepointId] = transactionIds(events);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await transaction.rollback();
    const ends = events.filter((event) => event.name.startsWith('ended:transaction'));
    expect(ends.map((event) => [event.name, event.activity?.id])).toEqual([
      ['ended:transaction:succeeded', outerId],
    ]);
    const before = events.length;
    for (const refused of [
      savepoint.execute(update),
      savepoint.query(rawPlan('select 1')).toArray(),
      savepoint.transaction(),
      savepoint.commit(),
      transaction.transaction(),
    ]) {
      await rejectsWith(refused, 'TRANSACTION_CLOSED');
    }
    expect(events.slice(before)).toEqual([]);

    await rejectsWith(savepoint.rollback(), 'TRANSACTION_CLOSED');
    expect(
      events
        .filter((event) => event.name.startsWith('ended:transaction'))
        .map((event) => [event.name, event.activity?.id]),
    ).toEqual([
      ['ended:transaction:succeeded', outerId],
      ['ended:transaction:failed', savepointId],
    ]);
    expect(finalized(events).endsWith('statement:rolled-back, transaction:rolled-back')).toBe(true);

    await (await connection.transaction()).transaction();
    expect(driverCalls(events)).toBe('begin, SAVEPOINT sp_1, rollback, begin, SAVEPOINT sp_1');
  });

  it('refuses work on an open savepoint after the outer transaction timed out, and reports the outer timeout ahead of the savepoint', async () => {
    const connection = await createSetup().runtime.connection();
    const transaction = await connection.transaction({ timeout: 1 });
    const savepoint = await transaction.transaction();

    await new Promise((resolve) => setTimeout(resolve, 5));

    await rejectsWith(savepoint.execute(update), 'TRANSACTION_CLOSED');
    await rejectsWith(transaction.execute(update), 'ACTIVITY_NOT_ACCEPTING_CHILDREN');
    await rejectsWith(transaction.commit(), 'TRANSACTION_TIMEOUT');
    expect(savepoint.signal).toBe(transaction.signal);
  });

  it('closes the transaction and every savepoint when ROLLBACK TO fails, and destroys an owned connection on the outer rollback', async () => {
    const setup = createSetup({
      failures: { rollbackToSavepoint: new Error('rollback to failed') },
    });
    const transaction = await (await startActivityOn(setup.runtime, testCall)).transaction?.();
    if (transaction === undefined) throw new Error('the runtime handle has no transaction');
    const outerChild = await transaction.transaction();
    const innerChild = await outerChild.transaction();

    await expect(innerChild.rollback()).rejects.toThrow('rollback to failed');
    const before = setup.events.length;
    for (const closed of [outerChild, transaction]) {
      await rejectsWith(closed.execute(update), 'TRANSACTION_CLOSED');
      await rejectsWith(closed.transaction(), 'TRANSACTION_CLOSED');
      await rejectsWith(closed.commit(), 'TRANSACTION_CLOSED');
    }
    expect(setup.events.slice(before)).toEqual([]);

    await rejectsWith(transaction.rollback(), 'TRANSACTION_CLOSED');
    expect(afterHookNames(setup.events).slice(-3).join(', ')).toBe(
      'ended:transaction:failed, finalized:transaction:rolled-back, destroy',
    );
    expect(driverCalls(setup.events)).toBe(
      'begin, SAVEPOINT sp_1, SAVEPOINT sp_2, ROLLBACK TO SAVEPOINT sp_2',
    );
  });

  it.each<{ title: string; options: SetupOptions; sent: string }>([
    {
      title: 'an activityStarted hook refuses the savepoint',
      options: {
        middleware: [
          {
            name: 'refuse-savepoint',
            familyId: 'sql',
            async activityStarted(activity, ctx) {
              if (activity.kind === 'transaction' && ctx.inTransaction())
                throw new Error('refused');
            },
          },
        ],
      },
      sent: 'begin, commit',
    },
    {
      title: 'SAVEPOINT fails',
      options: { failures: { savepoint: new Error('refused') } },
      sent: 'begin, SAVEPOINT sp_1, commit',
    },
  ])(
    'rejects transaction() and leaves the parent usable when $title',
    async ({ options, sent }) => {
      const { transaction, events } = await begin(options);

      await expect(transaction.transaction()).rejects.toThrow('refused');
      await transaction.execute(update);
      await transaction.commit();

      expect(driverCalls(events)).toBe(sent);
      expect(finalized(events)).toBe(
        'transaction:rolled-back, statement:committed, transaction:committed',
      );
    },
  );
});
