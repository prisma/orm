import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import mariadbControlDriver from '../src/exports/control';
import mariadbRuntimeDriver from '../src/exports/runtime';

let failNextQuery: Error | undefined;

class FakeConnection extends EventEmitter {
  readonly info = { status: 0, collation: { charset: 'utf8', maxLength: 4 } };
  async query(): Promise<unknown[]> {
    const error = failNextQuery;
    failNextQuery = undefined;
    if (error !== undefined) throw error;
    return [];
  }
  async end(): Promise<void> {}
}

vi.mock('mariadb', () => ({ createConnection: async () => new FakeConnection() }));

describe('the MariaDB driver descriptors', () => {
  it('build control and runtime drivers that carry the MariaDB target id', async () => {
    const driver = await mariadbControlDriver.create('mysql://root@localhost/db');
    expect({
      control: { targetId: mariadbControlDriver.targetId, id: mariadbControlDriver.id },
      runtime: { targetId: mariadbRuntimeDriver.targetId, id: mariadbRuntimeDriver.id },
      controlDriver: driver.targetId,
      runtimeDriver: mariadbRuntimeDriver.create().targetId,
    }).toEqual({
      control: { targetId: 'mariadb', id: 'mariadb' },
      runtime: { targetId: 'mariadb', id: 'mariadb' },
      controlDriver: 'mariadb',
      runtimeDriver: 'mariadb',
    });
    await driver.close();
  });

  it("report MariaDB's CHECK error 4025 as a CHECK violation, and 3819, MySQL's number for one, as reported", async () => {
    const driver = await mariadbControlDriver.create('mysql://root@localhost/db');
    const reported = async (errno: number, sqlState: string) => {
      failNextQuery = Object.assign(new Error('failed'), { errno, sqlState, fatal: false });
      return Object(await driver.query('SELECT 1').catch((error: unknown) => error)).sqlState;
    };
    expect({ 4025: await reported(4025, '23000'), 3819: await reported(3819, 'HY000') }).toEqual({
      4025: '23514',
      3819: 'HY000',
    });
    await driver.close();
  });
});
