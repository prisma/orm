import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeConnection, RuntimeQueryable, RuntimeTransaction } from '../src/sql-runtime';
import { withTransaction } from '../src/sql-runtime';
import {
  afterHookNames,
  createSetup,
  type DriverFailures,
  failingDecodePlan,
  type HookEvent,
  meta,
  names,
  rawPlan,
  type Setup,
  stages,
  testContract,
  transactionCases,
} from './after-transaction-fixtures';
import { stubAst } from './utils';

function held(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('afterTransaction in withTransaction', () => {
  it.each(transactionCases)('fires $outcome once when $title', async (testCase) => {
    const { runtime, events } = createSetup({ failures: testCase.failures });

    const run = withTransaction(runtime, async (tx) => {
      await tx.execute(rawPlan('update t set x = 1'));
      if (testCase.callbackFails) throw new Error('callback failed');
    });

    if (testCase.error === undefined) {
      await run;
    } else {
      await expect(run).rejects.toThrow(testCase.error);
    }
    const stageAt = names(events).indexOf(`afterTransaction:${testCase.outcome}`);
    expect(stages(events)).toEqual([`afterTransaction:${testCase.outcome}`]);
    expect(stageAt).toBeGreaterThan(names(events).indexOf('afterExecute'));
    expect(stageAt).toBeLessThan(
      names(events).findIndex((n) => n === 'release' || n === 'destroy'),
    );
  });

  it('fires once per plan in execution order', async () => {
    const { runtime, events } = createSetup();

    await withTransaction(runtime, async (tx) => {
      await tx.query(rawPlan('select 1')).toArray();
      await tx.execute(rawPlan('update t set x = 1'));
    });

    const fired = events.filter((event) => event.name.startsWith('afterTransaction'));
    expect(fired.map((event) => event.plan?.sql)).toEqual(['select 1', 'update t set x = 1']);
  });

  it('fires nothing for a query whose before-hook throws before its plan is encoded', async () => {
    const { runtime, events } = createSetup({
      beforeHookFailure: new Error('before-hook failed'),
    });

    await expect(
      withTransaction(runtime, async (tx) => {
        await tx.execute(rawPlan('update t set x = 1'));
      }),
    ).rejects.toThrow('before-hook failed');

    expect(stages(events)).toEqual([]);
  });
});

describe('afterTransaction on a transaction driven by hand', () => {
  async function begin(setup: Setup) {
    const connection: RuntimeConnection = await setup.runtime.connection();
    const transaction = await connection.transaction();
    await transaction.execute(rawPlan('update t set x = 1'));
    return transaction;
  }

  it('fires committed once when commit resolves', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    expect(stages(setup.events)).toEqual([]);
    await transaction.commit();

    expect({ last: names(setup.events).slice(-2), stages: stages(setup.events) }).toEqual({
      last: ['commit', 'afterTransaction:committed'],
      stages: ['afterTransaction:committed'],
    });
  });

  it('fires rolled-back once when rollback resolves', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    await transaction.rollback();

    expect(names(setup.events).slice(-2)).toEqual(['rollback', 'afterTransaction:rolled-back']);
  });

  it('fires rolled-back once and rethrows when rollback rejects', async () => {
    const setup = createSetup({ failures: { rollback: new Error('rollback failed') } });
    const transaction = await begin(setup);

    await expect(transaction.rollback()).rejects.toThrow('rollback failed');

    expect(stages(setup.events)).toEqual(['afterTransaction:rolled-back']);
  });

  it.each([
    { title: 'resolves', failures: { commit: new Error('commit failed') } },
    {
      title: 'rejects',
      failures: { commit: new Error('commit failed'), rollback: new Error('rollback failed') },
    },
  ])(
    'fires unknown once when commit rejects and the following rollback $title',
    async ({ failures }) => {
      const setup = createSetup({ failures });
      const transaction = await begin(setup);

      await expect(transaction.commit()).rejects.toThrow('commit failed');
      expect(stages(setup.events)).toEqual(['afterTransaction:unknown']);

      await transaction.rollback().catch(() => undefined);
      expect(stages(setup.events)).toEqual(['afterTransaction:unknown']);
    },
  );

  it('fires unknown once when rollback settles while commit is still pending', async () => {
    const commitHeld = held();
    const setup = createSetup({ failures: { commitHeldUntil: commitHeld.promise } });
    const transaction = await begin(setup);

    const committing = transaction.commit();
    await transaction.rollback();
    expect(stages(setup.events)).toEqual(['afterTransaction:unknown']);

    commitHeld.release();
    await committing;
    expect(stages(setup.events)).toEqual(['afterTransaction:unknown']);
  });

  it('fires nothing more when commit or rollback settles again after the transaction ended', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    await transaction.commit();
    await transaction.rollback();
    await transaction.commit();

    expect(stages(setup.events)).toEqual(['afterTransaction:committed']);
  });

  it('fires committed right after the after-hook for a query run after the transaction ended', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);
    await transaction.commit();

    await transaction.execute(rawPlan('update t set x = 2'));

    const afterCommit = setup.events.slice(names(setup.events).indexOf('commit') + 2);
    expect(afterCommit.map((event: HookEvent) => [event.name, event.plan?.sql])).toEqual([
      ['beforeExecute', 'update t set x = 2'],
      ['afterExecute', 'update t set x = 2'],
      ['afterTransaction:committed', 'update t set x = 2'],
    ]);
  });

  it('fires once per plan in execution order with the plan and planExecutionId its other hooks saw', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();

    await transaction.query(rawPlan('select 1')).toArray();
    await transaction.execute(rawPlan('update t set x = 1'));
    await transaction.query(rawPlan('select 2')).toArray();
    await transaction.commit();

    const afterHooks = setup.events.filter(
      (event) => event.name === 'afterQuery' || event.name === 'afterExecute',
    );
    const fired = setup.events.filter((event) => event.name.startsWith('afterTransaction'));
    const identities = (events: readonly HookEvent[]) =>
      events.map(({ plan, planExecutionId }) => ({ plan, planExecutionId }));
    expect(fired.map((event) => event.plan?.sql)).toEqual([
      'select 1',
      'update t set x = 1',
      'select 2',
    ]);
    expect(identities(fired)).toEqual(identities(afterHooks));
  });

  it('fires committed at commit for a query whose row stream the caller abandoned', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();

    for await (const _row of transaction.query(rawPlan('select 1'))) {
      break;
    }
    expect(stages(setup.events)).toEqual([]);

    await transaction.commit();

    const [before] = setup.events.filter((event) => event.name === 'beforeQuery');
    const fired = setup.events.filter((event) => event.name.startsWith('afterTransaction'));
    expect(fired).toEqual([
      expect.objectContaining({
        name: 'afterTransaction:committed',
        planExecutionId: before?.planExecutionId,
      }),
    ]);
  });

  it('fires committed at commit for a query whose caller threw into its row stream after the first row', async () => {
    const setup = createSetup();
    const transaction = await (await setup.runtime.connection()).transaction();
    const iterator = transaction.query(rawPlan('select 1'))[Symbol.asyncIterator]();
    await iterator.next();
    const callerError = new Error('caller stopped');

    await expect(iterator.throw?.(callerError)).rejects.toBe(callerError);
    await transaction.commit();

    expect(stages(setup.events)).toEqual(['afterTransaction:committed']);
  });

  it('commit resolves when a hook throws, and the error is logged', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const failure = new Error('hook failed');
    const setup = createSetup({
      log,
      afterTransaction: async () => {
        throw failure;
      },
    });
    const transaction = await begin(setup);

    await expect(transaction.commit()).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'middleware.afterTransaction.error', error: failure }),
    );
  });

  it.each([
    {
      title: 'commit',
      end: (transaction: Awaited<ReturnType<typeof begin>>) => transaction.commit(),
    },
    {
      title: 'rollback',
      end: (transaction: Awaited<ReturnType<typeof begin>>) => transaction.rollback(),
    },
  ])('$title resolves only after the hooks have run', async ({ end }) => {
    const hookHeld = held();
    const setup = createSetup({ afterTransaction: () => hookHeld.promise });
    const transaction = await begin(setup);

    let ended = false;
    const ending = end(transaction).then(() => {
      ended = true;
    });
    await nextTurn();
    expect(ended).toBe(false);

    hookHeld.release();
    await ending;
    expect(ended).toBe(true);
  });
});

interface FailedQueryCase {
  readonly title: string;
  readonly failures: DriverFailures;
  readonly run: (tx: RuntimeQueryable) => Promise<void>;
}

const failedQueryCases: ReadonlyArray<FailedQueryCase> = [
  {
    title: 'the driver fails an execute',
    failures: { execute: new Error('execute failed') },
    run: async (tx) => {
      await tx.query(rawPlan('select 1')).toArray();
      await expect(tx.execute(rawPlan('update t set x = 1'))).rejects.toThrow('execute failed');
    },
  },
  {
    title: 'the driver fails a row stream',
    failures: { query: new Error('query failed') },
    run: async (tx) => {
      await tx.execute(rawPlan('update t set x = 1'));
      await expect(tx.query(rawPlan('select 1')).toArray()).rejects.toThrow('query failed');
    },
  },
  {
    title: 'a row fails to decode',
    failures: {},
    run: async (tx) => {
      await tx.execute(rawPlan('update t set x = 1'));
      await expect(tx.query(failingDecodePlan()).toArray()).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
      });
    },
  },
  {
    title: 'the caller stops reading one row stream and the driver fails an execute',
    failures: { execute: new Error('execute failed') },
    run: async (tx) => {
      for await (const _row of tx.query(rawPlan('select 1'))) {
        break;
      }
      await expect(tx.execute(rawPlan('update t set x = 1'))).rejects.toThrow('execute failed');
    },
  },
];

describe.each(failedQueryCases)('a transaction in which $title', ({ failures, run }) => {
  it('fires nothing before it ends, then unknown for every query when commit resolves', async () => {
    const setup = createSetup({ failures });
    const transaction = await (await setup.runtime.connection()).transaction();

    await run(transaction);
    expect(stages(setup.events)).toEqual([]);
    await transaction.commit();

    expect(stages(setup.events)).toEqual(['afterTransaction:unknown', 'afterTransaction:unknown']);
  });

  it('fires rolled-back for every query when rollback resolves', async () => {
    const setup = createSetup({ failures });
    const transaction = await (await setup.runtime.connection()).transaction();

    await run(transaction);
    await transaction.rollback();

    expect(stages(setup.events)).toEqual([
      'afterTransaction:rolled-back',
      'afterTransaction:rolled-back',
    ]);
  });

  it('fires unknown for every query when withTransaction commits', async () => {
    const setup = createSetup({ failures });

    await withTransaction(setup.runtime, run);

    expect(stages(setup.events)).toEqual(['afterTransaction:unknown', 'afterTransaction:unknown']);
  });
});

describe('a query sent on the connection while its transaction is open', () => {
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
  ])('fires $outcome when the transaction ends with $end', async ({ end, outcome, run }) => {
    const setup = createSetup();
    const { transaction } = await beginOnConnection(setup);

    expect(stages(setup.events)).toEqual([]);
    await run(transaction);

    expect(afterHookNames(setup.events)).toEqual([
      'afterExecute',
      end,
      `afterTransaction:${outcome}`,
    ]);
  });

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

    expect(stages(setup.events)).toEqual(['afterTransaction:rolled-back']);
  });

  it('fires committed right after the after-hook once the transaction has ended', async () => {
    const setup = createSetup();
    const { connection, transaction } = await beginOnConnection(setup);
    await transaction.commit();

    await connection.execute(rawPlan('update t set x = 2'));

    expect(afterHookNames(setup.events).slice(-2)).toEqual([
      'afterExecute',
      'afterTransaction:committed',
    ]);
  });
});

describe('a query sent while commit or rollback is pending', () => {
  const pendingEnds = [
    { end: 'commit', outcome: 'committed' },
    { end: 'rollback', outcome: 'rolled-back' },
  ] as const;
  const cases = pendingEnds.flatMap((pending) =>
    (['connection', 'transaction'] as const).map((sentOn) => ({ ...pending, sentOn })),
  );

  it.each(cases)(
    'fires committed right after its after-hook when sent on the $sentOn while $end is pending, and the earlier query gets $outcome',
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

      const afterHooks = setup.events.filter((event) => !event.name.startsWith('before'));
      expect(afterHooks.map((event) => [event.name, event.plan?.sql])).toEqual([
        ['afterExecute', 'update t set x = 1'],
        ['afterExecute', 'update t set x = 2'],
        ['afterTransaction:committed', 'update t set x = 2'],
        [end, undefined],
        [`afterTransaction:${outcome}`, 'update t set x = 1'],
      ]);
    },
  );
});

describe('prepared statements in a transaction', () => {
  it('fire committed for a prepared query and a prepared execute once commit resolves', async () => {
    const setup = createSetup();
    const rows = await setup.runtime.prepare({}, () => ({ ast: stubAst(), params: [], meta }));
    const count = await setup.runtime.prepare({}, () =>
      planFromAst<AffectedCount>(RawQueryAst.affectedCount(['update t set x = 1']), testContract),
    );
    const transaction = await (await setup.runtime.connection()).transaction();

    await rows.query(transaction, {}).toArray();
    await count.execute(transaction, {});
    expect(stages(setup.events)).toEqual([]);
    await transaction.commit();

    expect(stages(setup.events)).toEqual([
      'afterTransaction:committed',
      'afterTransaction:committed',
    ]);
  });
});
