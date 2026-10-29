import { EventEmitter } from 'node:events';
import type { Connection } from 'mariadb';
import { describe, expect, it } from 'vitest';
import { MysqlControlDriver } from '../src/core/migrations/control-driver';

class FakeConnection extends EventEmitter {
  queries = 0;

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
});
