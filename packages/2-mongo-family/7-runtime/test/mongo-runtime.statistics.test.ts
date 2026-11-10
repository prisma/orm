import {
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@internal/mongo-wire';
import { describe, expect, it } from 'vitest';
import { createMongoRuntime } from '../src/mongo-runtime';
import {
  createMockAdapter,
  createMockDriver,
  createPlan,
  makeExecution,
} from './mongo-middleware-fixtures';

describe('MongoRuntime statement statistics', () => {
  it('maps updateOne modifiedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(
        adapter,
        new UpdateOneWireCommand('users', { id: 1 }, { $set: { active: true } }),
      ),
      driver: createMockDriver([{ matchedCount: 1, modifiedCount: 1 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 1 });
  });

  it('maps update modifiedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter, new UpdateManyWireCommand('users', {}, { $set: { active: true } })),
      driver: createMockDriver([{ matchedCount: 6, modifiedCount: 4 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 4 });
  });

  it('maps deleteOne deletedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter, new DeleteOneWireCommand('users', { id: 1 })),
      driver: createMockDriver([{ deletedCount: 1 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 1 });
  });

  it('maps delete deletedCount to affectedRows', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter, new DeleteManyWireCommand('users', {})),
      driver: createMockDriver([{ deletedCount: 3 }]),
    });

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 3 });
  });

  it('rejects unsupported statistics commands without a default count', async () => {
    const adapter = createMockAdapter();
    const driver = createMockDriver([{ count: 5 }]);
    const runtime = createMongoRuntime({
      ...makeExecution(adapter),
      driver,
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_UNSUPPORTED',
    });
  });

  it('rejects zero statistics results', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter, new DeleteOneWireCommand('users', { id: 1 })),
      driver: createMockDriver([]),
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_RESULT_INVALID',
    });
  });

  it('rejects multiple statistics results', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(
        adapter,
        new UpdateOneWireCommand('users', { id: 1 }, { $set: { active: true } }),
      ),
      driver: createMockDriver([{ modifiedCount: 1 }, { modifiedCount: 2 }]),
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_RESULT_INVALID',
    });
  });

  it('rejects update statistics without modifiedCount', async () => {
    const adapter = createMockAdapter();
    const runtime = createMongoRuntime({
      ...makeExecution(adapter, new UpdateManyWireCommand('users', {}, { $set: { active: true } })),
      driver: createMockDriver([{ matchedCount: 2 }]),
    });

    await expect(runtime.execute(createPlan())).rejects.toMatchObject({
      code: 'RUNTIME.MONGO_STATISTICS_RESULT_INVALID',
    });
  });
});
