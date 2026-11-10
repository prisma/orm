import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import mariadbControlDriver from '../src/exports/control';
import mariadbRuntimeDriver from '../src/exports/runtime';

class FakeConnection extends EventEmitter {
  readonly info = { status: 0, collation: { charset: 'utf8', maxLength: 4 } };
  async query(): Promise<unknown[]> {
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
});
