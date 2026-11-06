import { describe, expect, it } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { createSetup, names, rawPlan, stages } from './transaction-activity-fixtures';

const key = Symbol('count');

function counter(name: string, seen: unknown[]): SqlMiddleware {
  return {
    name,
    familyId: 'sql',
    async activityStarted(activity, ctx) {
      if (activity.kind !== 'statement') return;
      const state = ctx.state(key);
      seen.push({ name, before: state['count'] });
      state['count'] = (typeof state['count'] === 'number' ? state['count'] : 0) + 1;
    },
  };
}

describe('ctx.state through the SQL runtime', () => {
  it('starts empty for each statement and is shared by middleware that use the same key', async () => {
    const seen: unknown[] = [];
    const { runtime } = createSetup({
      middleware: [counter('first', seen), counter('second', seen)],
    });

    await runtime.query(rawPlan('select 1')).toArray();
    await runtime.execute(rawPlan('update t set x = 1'));

    expect(seen).toEqual([
      { name: 'first', before: undefined },
      { name: 'second', before: 1 },
      { name: 'first', before: undefined },
      { name: 'second', before: 1 },
    ]);
  });
});

describe('statements in flight inside one transaction', () => {
  it('finalizes two overlapping statements in start order when the transaction commits', async () => {
    const setup = createSetup();
    const transaction = await (await setup.runtime.connection()).transaction();
    const iterator = transaction.query(rawPlan('select 1'))[Symbol.asyncIterator]();
    await iterator.next();

    await transaction.execute(rawPlan('update t set x = 1'));
    while (!(await iterator.next()).done) {}
    await transaction.commit();

    const finalized = setup.events
      .filter((event) => event.name.startsWith('finalized:'))
      .map((event) => [event.name, event.sql]);
    expect(finalized).toEqual([
      ['finalized:statement:committed', 'select 1'],
      ['finalized:statement:committed', 'update t set x = 1'],
      ['finalized:transaction:committed', undefined],
    ]);
  });

  it('ends a statement still streaming at commit later, then finalizes it with the transaction outcome and its state intact', async () => {
    const kept: unknown[] = [];
    const stateKey = Symbol('kept');
    const keeper: SqlMiddleware = {
      name: 'keeper',
      familyId: 'sql',
      async activityStarted(activity, ctx) {
        if (activity.kind === 'statement') ctx.state(stateKey)['value'] = 'kept';
      },
      async activityFinalized(activity, _result, ctx) {
        if (activity.kind === 'statement') kept.push(ctx.state(stateKey)['value']);
      },
    };
    const setup = createSetup({ middleware: [keeper] });
    const transaction = await (await setup.runtime.connection()).transaction();
    const iterator = transaction.query(rawPlan('select 1'))[Symbol.asyncIterator]();
    await iterator.next();

    await transaction.commit();
    expect(stages(setup.events)).toEqual([]);
    expect(names(setup.events)).toContain('finalized:transaction:committed');

    while (!(await iterator.next()).done) {}

    expect(names(setup.events).slice(-2)).toEqual([
      'ended:statement:succeeded',
      'finalized:statement:committed',
    ]);
    expect(kept).toEqual(['kept']);
  });
});

describe('a transaction whose activityStarted throws', () => {
  it('rejects connection.transaction() without BEGIN, ends failed and finalizes rolled-back', async () => {
    const refused = new Error('started failed');
    const failingStart: SqlMiddleware = {
      name: 'failing-start',
      familyId: 'sql',
      async activityStarted(activity) {
        if (activity.kind === 'transaction') throw refused;
      },
    };
    const setup = createSetup({ middleware: [failingStart] });
    const connection = await setup.runtime.connection();

    await expect(connection.transaction()).rejects.toBe(refused);

    expect(names(setup.events)).toEqual([
      'started:transaction',
      'ended:transaction:failed',
      'finalized:transaction:rolled-back',
    ]);
  });
});
