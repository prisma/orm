import { DeleteOneWireCommand } from '@internal/mongo-wire';
import { describe, expect, it } from 'vitest';
import { createMongoRuntime } from '../src/mongo-runtime';
import {
  createMockAdapter,
  createMockDriver,
  createPlan,
  makeExecution,
} from './mongo-middleware-fixtures';

const runtimeClosed = {
  code: 'DRIVER.NOT_CONNECTED',
  message: 'Runtime is closed',
  why: 'close() was called on this runtime, or on the client or connection that owns it. An await using scope calls close() when it ends.',
};

describe('a closed Mongo runtime', () => {
  it('closes its driver', async () => {
    const driver = createMockDriver();
    const runtime = createMongoRuntime({ ...makeExecution(createMockAdapter()), driver });

    await runtime.close();

    expect(driver.close).toHaveBeenCalledTimes(1);
  });

  it('refuses a query without reaching the driver', async () => {
    const driver = createMockDriver([{ _id: '1' }]);
    const runtime = createMongoRuntime({ ...makeExecution(createMockAdapter()), driver });
    await runtime.close();

    await expect(runtime.query(createPlan()).toArray()).rejects.toMatchObject(runtimeClosed);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('refuses an execute without reaching the driver', async () => {
    const driver = createMockDriver([{ deletedCount: 1 }]);
    const runtime = createMongoRuntime({
      ...makeExecution(createMockAdapter(), new DeleteOneWireCommand('users', {})),
      driver,
    });
    await runtime.close();

    await expect(runtime.execute(createPlan())).rejects.toMatchObject(runtimeClosed);
    expect(driver.execute).not.toHaveBeenCalled();
  });
});
