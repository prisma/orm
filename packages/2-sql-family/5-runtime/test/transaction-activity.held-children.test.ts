import { describe, expect, it } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { createSetup, names, rawPlan } from './transaction-activity-fixtures';

describe('a runtime whose middleware implement no activityFinalized', () => {
  it('holds no finished statement of a transaction, decided when the runtime is created', async () => {
    const finalized: string[] = [];
    const late: SqlMiddleware = { name: 'late', familyId: 'sql' };
    const setup = createSetup({ recordFinalized: false, middleware: [late] });
    late.activityFinalized = async (activity, result) => {
      finalized.push(`${activity.kind}:${result.outcome}`);
    };
    const transaction = await (await setup.runtime.connection()).transaction();

    await transaction.execute(rawPlan('update t set x = 1'));
    await transaction.query(rawPlan('select 1')).toArray();
    await transaction.commit();

    expect(finalized).toEqual(['transaction:committed']);
    expect(names(setup.events).filter((name) => name.startsWith('ended:'))).toEqual([
      'ended:statement:succeeded',
      'ended:statement:succeeded',
      'ended:transaction:succeeded',
    ]);
  });

  it('still counts a failed statement, so a resolved commit is unknown', async () => {
    const finalized: string[] = [];
    const late: SqlMiddleware = { name: 'late', familyId: 'sql' };
    const setup = createSetup({
      recordFinalized: false,
      middleware: [late],
      failures: { execute: new Error('execute failed') },
    });
    late.activityFinalized = async (activity, result) => {
      finalized.push(`${activity.kind}:${result.outcome}`);
    };
    const transaction = await (await setup.runtime.connection()).transaction();

    await expect(transaction.execute(rawPlan('update t set x = 1'))).rejects.toThrow(
      'execute failed',
    );
    await transaction.commit();

    expect(finalized).toEqual(['transaction:unknown']);
  });

  it('gives the statements the transaction as parent', async () => {
    const setup = createSetup({ recordFinalized: false });
    const transaction = await (await setup.runtime.connection()).transaction();

    await transaction.execute(rawPlan('update t set x = 1'));
    await transaction.commit();

    const transactionCtx = setup.events.find((e) => e.name === 'started:transaction')?.ctx;
    const statementCtx = setup.events.find((e) => e.name === 'started:statement')?.ctx;
    expect(statementCtx?.parent).toBe(transactionCtx);
    expect(statementCtx?.inTransaction()).toBe(true);
  });
});

describe('a runtime with an activityFinalized middleware', () => {
  it('finalizes the finished statements of a transaction when it ends', async () => {
    const setup = createSetup();
    const transaction = await (await setup.runtime.connection()).transaction();

    await transaction.execute(rawPlan('update t set x = 1'));
    await transaction.commit();

    expect(names(setup.events).filter((name) => name.startsWith('finalized:'))).toEqual([
      'finalized:statement:committed',
      'finalized:transaction:committed',
    ]);
  });
});
