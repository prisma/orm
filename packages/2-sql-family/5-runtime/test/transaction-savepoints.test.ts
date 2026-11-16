import { describe, expect, it } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import { withTransaction } from '../src/sql-runtime';
import { testCall } from './client-activity-kinds';
import {
  afterHookNames,
  createSetup,
  type DriverFailures,
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

const update = rawPlan('update t set x = 1');

const driverCalls = (events: readonly HookEvent[]) =>
  names(events).filter((name) => /^(SAVEPOINT|RELEASE|ROLLBACK|begin|commit|rollback)/.test(name));

const transactionStarts = (events: readonly HookEvent[]) =>
  events.filter((event) => event.name === 'started:transaction');

describe('RuntimeTransaction.savepoint()', () => {
  it('runs statements on a released savepoint, a transaction activity beneath the outer one', async () => {
    const { transaction, events } = await begin();

    const savepoint = await transaction.savepoint();
    await savepoint.execute(update);
    await savepoint.commit();
    await transaction.commit();

    expect(driverCalls(events)).toEqual([
      'begin',
      'SAVEPOINT sp_1',
      'RELEASE SAVEPOINT sp_1',
      'commit',
    ]);
    const [outer, inner] = transactionStarts(events);
    expect(inner?.ctx?.parent).toBe(outer?.ctx);
    const statement = events.find((event) => event.name === 'started:statement');
    expect(statement?.ctx?.parent).toBe(inner?.ctx);
    expect(names(events).filter((name) => name.startsWith('finalized:'))).toEqual([
      'finalized:statement:committed',
      'finalized:transaction:committed',
      'finalized:transaction:committed',
    ]);
  });

  it('finalizes a rolled-back savepoint before rollback() resolves, and the outer commit committed', async () => {
    const { transaction, events } = await begin();

    const savepoint = await transaction.savepoint();
    await savepoint.execute(update);
    await savepoint.rollback();
    expect(names(events).filter((name) => name.startsWith('finalized:'))).toEqual([
      'finalized:statement:rolled-back',
      'finalized:transaction:rolled-back',
    ]);

    await transaction.execute(rawPlan('update t set x = 2'));
    await transaction.commit();

    expect(driverCalls(events)).toEqual([
      'begin',
      'SAVEPOINT sp_1',
      'ROLLBACK TO SAVEPOINT sp_1',
      'commit',
    ]);
    expect(
      names(events)
        .filter((name) => name.startsWith('finalized:'))
        .slice(2),
    ).toEqual(['finalized:statement:committed', 'finalized:transaction:committed']);
  });

  it('names a savepoint inside a savepoint next, with one counter per connection', async () => {
    const { connection, transaction, events } = await begin();

    const first = await transaction.savepoint();
    const second = await first.savepoint();
    await second.commit();
    await first.commit();
    await transaction.commit();
    const next = await connection.transaction();
    await (await next.savepoint()).rollback();
    await next.commit();

    expect(driverCalls(events)).toEqual([
      'begin',
      'SAVEPOINT sp_1',
      'SAVEPOINT sp_2',
      'RELEASE SAVEPOINT sp_2',
      'RELEASE SAVEPOINT sp_1',
      'commit',
      'begin',
      'SAVEPOINT sp_3',
      'ROLLBACK TO SAVEPOINT sp_3',
      'commit',
    ]);
  });

  it('rejects a second savepoint while one is open on the level, naming it and sending nothing', async () => {
    const { transaction, events } = await begin();
    const open = await transaction.savepoint();
    const before = events.length;

    await expect(transaction.savepoint()).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_ALREADY_OPEN',
      message: expect.stringContaining('sp_1'),
    });
    expect(events.slice(before)).toEqual([]);

    await open.commit();
    await expect(transaction.savepoint()).resolves.toBeDefined();
  });

  it('rejects a second savepoint started at once with the first', async () => {
    const { transaction } = await begin();

    const results = await Promise.allSettled([transaction.savepoint(), transaction.savepoint()]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  });

  it.each([
    { title: 'a statement', run: (level: RuntimeLevel) => level.execute(update) },
    {
      title: 'a query',
      run: (level: RuntimeLevel) => level.query(rawPlan('select 1')).toArray(),
    },
    { title: 'commit()', run: (level: RuntimeLevel) => level.commit() },
  ])('suspends $title on a level with an open child until the child settles', async ({ run }) => {
    const { transaction, events } = await begin();
    const outerChild = await transaction.savepoint();
    const innerChild = await outerChild.savepoint();
    const childId = transactionStarts(events)[2]?.activity?.id;
    const before = events.length;

    await expect(run(outerChild)).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_SUSPENDED',
      details: { savepointId: childId },
    });
    await expect(run(transaction)).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_SUSPENDED',
    });
    expect(events.slice(before)).toEqual([]);

    await innerChild.commit();
    await run(outerChild);
  });

  it('closes the open savepoints when an enclosing level rolls back, innermost first', async () => {
    const { transaction, events } = await begin();
    const outerChild = await transaction.savepoint();
    const innerChild = await outerChild.savepoint();
    const [, outerChildStart, innerChildStart] = transactionStarts(events);

    await transaction.rollback();

    const ends = events.filter((event) => event.name.startsWith('ended:transaction'));
    expect(ends.map((event) => [event.name, event.activity?.id])).toEqual([
      ['ended:transaction:succeeded', innerChildStart?.activity?.id],
      ['ended:transaction:succeeded', outerChildStart?.activity?.id],
      ['ended:transaction:succeeded', transactionStarts(events)[0]?.activity?.id],
    ]);
    expect(driverCalls(events)).toEqual(['begin', 'SAVEPOINT sp_1', 'SAVEPOINT sp_2', 'rollback']);
    for (const closed of [innerChild, outerChild]) {
      await expect(closed.execute(update)).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
      await expect(closed.savepoint()).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
    }
  });

  it.each([
    {
      title: 'commits after the savepoint released',
      settle: async (transaction: RuntimeLevel, savepoint: RuntimeLevel) => {
        await savepoint.commit();
        await transaction.commit();
      },
    },
    {
      title: 'rolls back with the savepoint open',
      settle: (transaction: RuntimeLevel) => transaction.rollback(),
    },
  ])('refuses work on a savepoint after the outer transaction $title', async ({ settle }) => {
    const { transaction, events } = await begin();
    const savepoint = await transaction.savepoint();
    const handle = await startActivityOn(savepoint, testCall);
    await handle.end({ outcome: 'succeeded' });
    await settle(transaction, savepoint);
    const before = events.length;

    for (const refused of [
      savepoint.execute(update),
      savepoint.query(rawPlan('select 1')).toArray(),
      savepoint.savepoint(),
      savepoint.commit(),
      startActivityOn(savepoint, testCall),
      transaction.savepoint(),
    ]) {
      await expect(refused).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
    }
    await savepoint.rollback();
    expect(events.slice(before)).toEqual([]);
  });

  it('refuses work on an open savepoint after the outer transaction timed out', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction({ timeout: 1 });
    const savepoint = await transaction.savepoint();

    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(savepoint.execute(update)).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_CLOSED',
    });
    expect(savepoint.signal).toBe(transaction.signal);
  });

  it('invalidates every level when ROLLBACK TO fails, and destroys an owned connection on the outer rollback', async () => {
    const setup = createSetup({
      failures: { rollbackToSavepoint: new Error('rollback to failed') },
    });
    const handle = await startActivityOn(setup.runtime, testCall);
    const transaction = await handle.transaction?.();
    if (transaction === undefined) throw new Error('the runtime handle has no transaction');
    const outerChild = await transaction.savepoint();
    const innerChild = await outerChild.savepoint();

    await expect(innerChild.rollback()).rejects.toThrow('rollback to failed');
    const before = setup.events.length;
    for (const level of [outerChild, transaction]) {
      await expect(level.execute(update)).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
      await expect(level.savepoint()).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
      await expect(level.commit()).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
    }
    expect(setup.events.slice(before)).toEqual([]);

    await expect(transaction.rollback()).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_CLOSED',
    });
    expect(afterHookNames(setup.events).slice(-3)).toEqual([
      'ended:transaction:failed',
      'finalized:transaction:rolled-back',
      'destroy',
    ]);
    expect(driverCalls(setup.events)).not.toContain('rollback');
  });

  it('leaves the parent usable and its commit committed when RELEASE fails and the rollback succeeds', async () => {
    const { transaction, events } = await begin({
      failures: { releaseSavepoint: new Error('release failed') },
    });
    const savepoint = await transaction.savepoint();

    await expect(savepoint.commit()).rejects.toThrow('release failed');
    await expect(transaction.execute(update)).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_SUSPENDED',
    });
    await savepoint.rollback();
    await transaction.execute(update);
    await transaction.commit();

    expect(driverCalls(events)).toEqual([
      'begin',
      'SAVEPOINT sp_1',
      'RELEASE SAVEPOINT sp_1',
      'ROLLBACK TO SAVEPOINT sp_1',
      'commit',
    ]);
    expect(names(events).slice(-1)).toEqual(['finalized:transaction:committed']);
  });

  it.each<{ title: string; options: SetupOptions; sent: string[] }>([
    {
      title: 'an activityStarted hook refuses the savepoint',
      options: {
        middleware: [
          {
            name: 'refuse-savepoint',
            familyId: 'sql',
            async activityStarted(activity, ctx) {
              if (activity.kind === 'transaction' && ctx.inTransaction()) {
                throw new Error('refused');
              }
            },
          },
        ],
      },
      sent: ['begin', 'commit'],
    },
    {
      title: 'SAVEPOINT fails',
      options: { failures: { savepoint: new Error('refused') } satisfies DriverFailures },
      sent: ['begin', 'SAVEPOINT sp_1', 'commit'],
    },
  ])('rejects savepoint() and leaves the parent usable when $title', async ({ options, sent }) => {
    const { transaction, events } = await begin(options);

    await expect(transaction.savepoint()).rejects.toThrow('refused');
    await transaction.execute(update);
    await transaction.commit();

    expect(driverCalls(events)).toEqual(sent);
    expect(names(events).filter((name) => name.startsWith('finalized:transaction'))).toEqual([
      'finalized:transaction:rolled-back',
      'finalized:transaction:committed',
    ]);
  });
});

describe('ActivityHandle.savepoint', () => {
  it('opens a savepoint beneath a handle on a transaction and on a savepoint', async () => {
    const { transaction, events } = await begin();
    const onTransaction = await startActivityOn(transaction, testCall);

    const savepoint = await onTransaction.savepoint?.();
    if (savepoint === undefined) throw new Error('the transaction handle has no savepoint');
    const onSavepoint = await startActivityOn(savepoint, testCall);
    const nested = await onSavepoint.savepoint?.();
    await nested?.commit();
    await onSavepoint.end({ outcome: 'succeeded' });
    await savepoint.commit();
    await onTransaction.end({ outcome: 'succeeded' });
    await transaction.commit();

    const [, first, second] = transactionStarts(events);
    const orm = events.filter((event) => event.name === 'started:test-call');
    expect(first?.ctx?.parent).toBe(orm[0]?.ctx);
    expect(second?.ctx?.parent).toBe(orm[1]?.ctx);
    expect(driverCalls(events)).toContain('RELEASE SAVEPOINT sp_2');
  });

  it('is absent on handles opened on the runtime, a connection and in withTransaction', async () => {
    const { runtime } = createSetup();
    const connection = await runtime.connection();

    const onRuntime = await startActivityOn(runtime, testCall);
    const onConnection = await startActivityOn(connection, testCall);
    const inWithTransaction = await withTransaction(runtime, (tx) => startActivityOn(tx, testCall));

    expect(onRuntime.savepoint).toBeUndefined();
    expect(onConnection.savepoint).toBeUndefined();
    expect(inWithTransaction.savepoint).toBeUndefined();
  });
});

type RuntimeLevel = Awaited<ReturnType<typeof begin>>['transaction'];
