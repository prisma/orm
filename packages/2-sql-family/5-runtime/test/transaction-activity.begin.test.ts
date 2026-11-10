import { describe, expect, it } from 'vitest';
import { withTransaction } from '../src/sql-runtime';
import { createSetup, names, rawPlan } from './transaction-activity-fixtures';

describe('beginning a transaction activity', () => {
  it('starts the transaction activity before BEGIN', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();

    const transaction = await connection.transaction();

    expect(names(setup.events)).toEqual(['started:transaction', 'begin']);
    await transaction.rollback();
  });

  it('ends failed, finalizes rolled-back and rethrows when BEGIN fails', async () => {
    const setup = createSetup({ failures: { begin: new Error('begin failed') } });
    const connection = await setup.runtime.connection();

    await expect(connection.transaction()).rejects.toThrow('begin failed');

    expect(names(setup.events)).toEqual([
      'started:transaction',
      'begin',
      'ended:transaction:failed',
      'finalized:transaction:rolled-back',
    ]);
  });

  it('runs a statement sent on the connection after a failed BEGIN outside any transaction', async () => {
    const setup = createSetup({ failures: { begin: new Error('begin failed') } });
    const connection = await setup.runtime.connection();
    await expect(connection.transaction()).rejects.toThrow('begin failed');

    await connection.execute(rawPlan('update t set x = 1'));

    const statement = setup.events.find((event) => event.name === 'started:statement');
    expect(statement?.ctx?.parent).toBeUndefined();
    expect(names(setup.events).slice(-2)).toEqual([
      'ended:statement:succeeded',
      'finalized:statement:committed',
    ]);
  });

  it('rejects withTransaction with the BEGIN error', async () => {
    const setup = createSetup({ failures: { begin: new Error('begin failed') } });

    await expect(withTransaction(setup.runtime, async () => undefined)).rejects.toThrow(
      'begin failed',
    );
  });
});
