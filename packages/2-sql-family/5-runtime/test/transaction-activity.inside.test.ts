import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeConnection } from '../src/sql-runtime';
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
  transactionStages,
} from './transaction-activity-fixtures';
import { stubAst } from './utils';

function held(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a transaction activity in withTransaction', () => {
  it.each(transactionCases)(
    'finalizes the statement and then the transaction $outcome once when $title',
    async (testCase) => {
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
      const finalized = names(events).filter((name) => name.startsWith('finalized:'));
      expect(finalized).toEqual([
        `finalized:statement:${testCase.outcome}`,
        `finalized:transaction:${testCase.outcome}`,
      ]);
      const finalizedAt = names(events).indexOf(`finalized:transaction:${testCase.outcome}`);
      expect(finalizedAt).toBeLessThan(
        names(events).findIndex((n) => n === 'release' || n === 'destroy'),
      );
    },
  );

  it('starts the transaction, then its statements, and finalizes them in start order before the transaction', async () => {
    const { runtime, events } = createSetup();

    await withTransaction(runtime, async (tx) => {
      await tx.query(rawPlan('select 1')).toArray();
      await tx.execute(rawPlan('update t set x = 1'));
    });

    expect(
      events
        .filter((event) => /^(started|ended|finalized):/.test(event.name))
        .map((event) => [event.name, event.sql]),
    ).toEqual([
      ['started:transaction', undefined],
      ['started:statement', 'select 1'],
      ['ended:statement:succeeded', 'select 1'],
      ['started:statement', 'update t set x = 1'],
      ['ended:statement:succeeded', 'update t set x = 1'],
      ['ended:transaction:succeeded', undefined],
      ['finalized:statement:committed', 'select 1'],
      ['finalized:statement:committed', 'update t set x = 1'],
      ['finalized:transaction:committed', undefined],
    ]);
  });

  it('finalizes a statement whose beforeEncode throws when the transaction rolls back', async () => {
    const { runtime, events } = createSetup({
      beforeHookFailure: new Error('before-hook failed'),
    });

    await expect(
      withTransaction(runtime, async (tx) => {
        await tx.execute(rawPlan('update t set x = 1'));
      }),
    ).rejects.toThrow('before-hook failed');

    expect(afterHookNames(events)).toEqual([
      'ended:statement:failed',
      'rollback',
      'ended:transaction:succeeded',
      'finalized:statement:rolled-back',
      'finalized:transaction:rolled-back',
      'release',
    ]);
  });
});

describe('a transaction activity driven by hand', () => {
  async function begin(setup: Setup) {
    const connection: RuntimeConnection = await setup.runtime.connection();
    const transaction = await connection.transaction();
    await transaction.execute(rawPlan('update t set x = 1'));
    return transaction;
  }

  it('finalizes committed once when commit resolves', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    expect(stages(setup.events)).toEqual([]);
    await transaction.commit();

    expect(names(setup.events).slice(-4)).toEqual([
      'commit',
      'ended:transaction:succeeded',
      'finalized:statement:committed',
      'finalized:transaction:committed',
    ]);
  });

  it('finalizes rolled-back once when rollback resolves', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    await transaction.rollback();

    expect(names(setup.events).slice(-4)).toEqual([
      'rollback',
      'ended:transaction:succeeded',
      'finalized:statement:rolled-back',
      'finalized:transaction:rolled-back',
    ]);
  });

  it('ends failed, finalizes rolled-back once and rethrows when rollback rejects', async () => {
    const setup = createSetup({ failures: { rollback: new Error('rollback failed') } });
    const transaction = await begin(setup);

    await expect(transaction.rollback()).rejects.toThrow('rollback failed');

    expect(afterHookNames(setup.events).slice(-3)).toEqual([
      'ended:transaction:failed',
      'finalized:statement:rolled-back',
      'finalized:transaction:rolled-back',
    ]);
  });

  it.each([
    { title: 'resolves', failures: { commit: new Error('commit failed') } },
    {
      title: 'rejects',
      failures: { commit: new Error('commit failed'), rollback: new Error('rollback failed') },
    },
  ])(
    'ends failed and finalizes unknown once when commit rejects and the following rollback $title',
    async ({ failures }) => {
      const setup = createSetup({ failures });
      const transaction = await begin(setup);

      await expect(transaction.commit()).rejects.toThrow('commit failed');
      expect(names(setup.events)).toContain('ended:transaction:failed');
      expect(stages(setup.events)).toEqual(['finalized:statement:unknown']);

      await transaction.rollback().catch(() => undefined);
      expect(stages(setup.events)).toEqual(['finalized:statement:unknown']);
      expect(transactionStages(setup.events)).toEqual(['finalized:transaction:unknown']);
    },
  );

  it('finalizes unknown once when rollback settles while commit is still pending', async () => {
    const commitHeld = held();
    const setup = createSetup({ failures: { commitHeldUntil: commitHeld.promise } });
    const transaction = await begin(setup);

    const committing = transaction.commit();
    await transaction.rollback();
    expect(stages(setup.events)).toEqual(['finalized:statement:unknown']);

    commitHeld.release();
    await committing;
    expect(transactionStages(setup.events)).toEqual(['finalized:transaction:unknown']);
  });

  it('finalizes nothing more when commit or rollback settles again after the transaction ended', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    await transaction.commit();
    await transaction.rollback();
    await transaction.commit();

    expect([...stages(setup.events), ...transactionStages(setup.events)]).toEqual([
      'finalized:statement:committed',
      'finalized:transaction:committed',
    ]);
  });

  it('finalizes a statement sent after the transaction ended committed right after it ends, with no parent', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);
    await transaction.commit();
    const before = setup.events.length;

    await transaction.execute(rawPlan('update t set x = 2'));

    const after = setup.events.slice(before);
    expect(after.map((event) => [event.name, event.sql])).toEqual([
      ['started:statement', 'update t set x = 2'],
      ['beforeEncode', 'update t set x = 2'],
      ['ended:statement:succeeded', 'update t set x = 2'],
      ['finalized:statement:committed', 'update t set x = 2'],
    ]);
    expect(after[0]?.ctx?.parent).toBeUndefined();
  });

  it('finalizes each statement with the activity and context its other hooks saw', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();

    await transaction.query(rawPlan('select 1')).toArray();
    await transaction.execute(rawPlan('update t set x = 1'));
    await transaction.query(rawPlan('select 2')).toArray();
    await transaction.commit();

    const statementEvents = setup.events.filter((event) => event.sql !== undefined);
    const bySql = new Map<string | undefined, HookEvent[]>();
    for (const event of statementEvents) {
      bySql.set(event.sql, [...(bySql.get(event.sql) ?? []), event]);
    }
    expect([...bySql.keys()]).toEqual(['select 1', 'update t set x = 1', 'select 2']);
    for (const group of bySql.values()) {
      expect(new Set(group.map((event) => event.ctx)).size).toBe(1);
      expect(new Set(group.flatMap((event) => event.activity ?? [])).size).toBe(1);
    }
    expect(stages(setup.events)).toEqual([
      'finalized:statement:committed',
      'finalized:statement:committed',
      'finalized:statement:committed',
    ]);
  });

  it('gives a statement in the transaction the transaction context as parent', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);
    await transaction.commit();

    const transactionCtx = setup.events.find((event) => event.name === 'started:transaction')?.ctx;
    const statementCtx = setup.events.find((event) => event.name === 'started:statement')?.ctx;
    expect(statementCtx?.parent).toBe(transactionCtx);
    expect(statementCtx?.inTransaction()).toBe(true);
    expect(statementCtx?.scope).toBe('transaction');
    expect(transactionCtx?.parent).toBeUndefined();
    expect(transactionCtx?.inTransaction()).toBe(false);
  });

  it('finalizes committed at commit a statement whose row stream the caller abandoned', async () => {
    const setup = createSetup();
    const transaction = await (await setup.runtime.connection()).transaction();

    for await (const _row of transaction.query(rawPlan('select 1'))) {
      break;
    }
    expect(names(setup.events)).toContain('ended:statement:stopped');
    expect(stages(setup.events)).toEqual([]);

    await transaction.commit();

    expect(stages(setup.events)).toEqual(['finalized:statement:committed']);
  });

  it('finalizes committed at commit a statement whose caller threw into its row stream after the first row', async () => {
    const setup = createSetup();
    const transaction = await (await setup.runtime.connection()).transaction();
    const iterator = transaction.query(rawPlan('select 1'))[Symbol.asyncIterator]();
    await iterator.next();
    const callerError = new Error('caller stopped');

    await expect(iterator.throw?.(callerError)).rejects.toBe(callerError);
    await transaction.commit();

    expect(stages(setup.events)).toEqual(['finalized:statement:committed']);
  });

  it('commit resolves when a finalized hook throws, and the error is logged', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const failure = new Error('hook failed');
    const setup = createSetup({
      log,
      activityFinalized: async () => {
        throw failure;
      },
    });
    const transaction = await begin(setup);

    await expect(transaction.commit()).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'middleware.activityFinalized.error', error: failure }),
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
  ])('$title resolves only after the finalized hooks have run', async ({ end }) => {
    const hookHeld = held();
    const setup = createSetup({ activityFinalized: () => hookHeld.promise });
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
  readonly run: (tx: RuntimeScope) => Promise<void>;
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
  it('finalizes nothing before it ends, then every statement and itself unknown when commit resolves', async () => {
    const setup = createSetup({ failures });
    const transaction = await (await setup.runtime.connection()).transaction();

    await run(transaction);
    expect(stages(setup.events)).toEqual([]);
    await transaction.commit();

    expect(stages(setup.events)).toEqual([
      'finalized:statement:unknown',
      'finalized:statement:unknown',
    ]);
    expect(transactionStages(setup.events)).toEqual(['finalized:transaction:unknown']);
  });

  it('finalizes every statement rolled-back when rollback resolves', async () => {
    const setup = createSetup({ failures });
    const transaction = await (await setup.runtime.connection()).transaction();

    await run(transaction);
    await transaction.rollback();

    expect(stages(setup.events)).toEqual([
      'finalized:statement:rolled-back',
      'finalized:statement:rolled-back',
    ]);
  });

  it('finalizes every statement unknown when withTransaction commits', async () => {
    const setup = createSetup({ failures });

    await withTransaction(setup.runtime, run);

    expect(stages(setup.events)).toEqual([
      'finalized:statement:unknown',
      'finalized:statement:unknown',
    ]);
  });
});

describe('prepared statements in a transaction', () => {
  it('finalize a prepared query and a prepared execute committed once commit resolves', async () => {
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
      'finalized:statement:committed',
      'finalized:statement:committed',
    ]);
  });
});
