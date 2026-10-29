import { EventEmitter } from 'node:events';
import type { Connection } from 'mariadb';
import { describe, expect, it } from 'vitest';
import { MysqlControlDriver } from '../src/core/migrations/control-driver';

class FakeConnection extends EventEmitter {
  queries = 0;
  readonly info = { status: 0 };

  async query(): Promise<unknown[]> {
    this.queries += 1;
    return [];
  }
}

describe('MysqlControlDriver', () => {
  it('keeps an error its connection emits from crashing the process, and refuses queries after it', async () => {
    const connection = new FakeConnection();
    const driver = new MysqlControlDriver(connection as unknown as Connection);

    expect(() => connection.emit('error', new Error('Connection lost'))).not.toThrow();
    await expect(driver.query('SELECT 1')).rejects.toMatchObject({
      kind: 'sql_connection',
      transient: true,
      message: 'Connection lost',
    });
    expect(connection.queries).toBe(0);
  });

  it('refuses a statement with values while the server reports NO_BACKSLASH_ESCAPES, without sending it, and runs one without values', async () => {
    const connection = new FakeConnection();
    connection.info.status = 1 << 9;
    const driver = new MysqlControlDriver(connection as unknown as Connection);

    await expect(driver.query('SELECT ? AS v', ['x'])).rejects.toMatchObject({
      code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
      meta: { reason: 'no-backslash-escapes', params: 1 },
    });
    expect({ refused: connection.queries, ran: await driver.query('SELECT 1') }).toEqual({
      refused: 0,
      ran: { rows: [] },
    });
  });
});
