import type { SqlTransactionStart } from '@internal/sql-relational-core/ast';
import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import driverDescriptor from '../src/exports/runtime';

async function setup() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const client = {
    query,
    connect: vi.fn(async () => undefined),
    on: vi.fn(),
    end: vi.fn(async () => undefined),
  } as unknown as Client;
  const driver = driverDescriptor.create({ cursor: { disabled: true } });
  await driver.connect({ kind: 'pgClient', client, ownedByDriver: true });
  return { driver, query };
}

describe('transaction isolation', () => {
  it.each([
    [undefined, 'BEGIN'],
    [{ kind: 'implicit' }, 'BEGIN'],
    [{ kind: 'explicit' }, 'BEGIN'],
    [{ kind: 'explicit', isolationLevel: undefined }, 'BEGIN'],
    [
      { kind: 'explicit', isolationLevel: 'ReadUncommitted' },
      'BEGIN ISOLATION LEVEL READ UNCOMMITTED',
    ],
    [{ kind: 'explicit', isolationLevel: 'ReadCommitted' }, 'BEGIN ISOLATION LEVEL READ COMMITTED'],
    [
      { kind: 'explicit', isolationLevel: 'RepeatableRead' },
      'BEGIN ISOLATION LEVEL REPEATABLE READ',
    ],
    [{ kind: 'explicit', isolationLevel: 'Serializable' }, 'BEGIN ISOLATION LEVEL SERIALIZABLE'],
  ] as const)('maps %j through the unbound wrapper', async (start, sql) => {
    const { driver, query } = await setup();
    const connection = await driver.acquireConnection();
    const tx = await connection.beginTransaction(start);
    await tx.rollback();
    expect(query.mock.calls).toEqual([[sql], ['ROLLBACK']]);
    await connection.release();
    await driver.close();
  });

  it.each([null, 42, 'invalid', 'Serializable; SELECT 1'])(
    'rejects invalid isolation %j before SQL',
    async (isolationLevel) => {
      const { driver, query } = await setup();
      const connection = await driver.acquireConnection();
      await expect(
        connection.beginTransaction({ kind: 'explicit', isolationLevel } as SqlTransactionStart),
      ).rejects.toMatchObject({ code: 'RUNTIME.ARGUMENT_INVALID' });
      expect(query).not.toHaveBeenCalled();
      await connection.destroy();
      await driver.close();
    },
  );
});
