import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import mysqlControlDriver, {
  createMysqlControlDriverDescriptor,
} from '../src/core/migrations/control-driver';
import mysqlRuntimeDriver, {
  createMysqlRuntimeDriverDescriptor,
} from '../src/core/runtime/runtime-driver';

class FakeConnection extends EventEmitter {
  readonly info = { status: 0, collation: { charset: 'utf8', maxLength: 4 } };
  async query(): Promise<unknown[]> {
    return [];
  }
  async end(): Promise<void> {}
}

vi.mock('mariadb', () => ({ createConnection: async () => new FakeConnection() }));

function fieldsOf(descriptor: { readonly targetId: string; readonly id: string }) {
  return { targetId: descriptor.targetId, id: descriptor.id };
}

describe('the driver descriptors of a target that extends MySQL', () => {
  it('build control and runtime drivers that carry its target id', async () => {
    const control = createMysqlControlDriverDescriptor('mariadb');
    const runtime = createMysqlRuntimeDriverDescriptor('mariadb');
    const driver = await control.create('mysql://root@localhost/db');
    expect({
      control: fieldsOf(control),
      runtime: fieldsOf(runtime),
      controlDriver: driver.targetId,
      runtimeDriver: runtime.create().targetId,
    }).toEqual({
      control: { targetId: 'mariadb', id: 'mariadb' },
      runtime: { targetId: 'mariadb', id: 'mariadb' },
      controlDriver: 'mariadb',
      runtimeDriver: 'mariadb',
    });
    await driver.close();
  });

  it('keep MySQL as the target of the default descriptors', async () => {
    const driver = await mysqlControlDriver.create('mysql://root@localhost/db');
    expect({
      control: fieldsOf(mysqlControlDriver),
      runtime: fieldsOf(mysqlRuntimeDriver),
      controlDriver: driver.targetId,
      runtimeDriver: mysqlRuntimeDriver.create().targetId,
    }).toEqual({
      control: { targetId: 'mysql', id: 'mysql' },
      runtime: { targetId: 'mysql', id: 'mysql' },
      controlDriver: 'mysql',
      runtimeDriver: 'mysql',
    });
    await driver.close();
  });
});
