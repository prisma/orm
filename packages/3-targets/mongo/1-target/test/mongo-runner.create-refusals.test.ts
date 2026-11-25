import { describe, expect, it } from 'vitest';
import { createCollection } from '../src/core/migrations/migration-factories';
import { execute, failureFields, makeHarness } from './mongo-runner-harness';

describe('MongoMigrationRunner, a create whose collection already exists', () => {
  it('names the two ways out: drop it, or give it the options of the create', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'orders' }];

    const result = await execute(harness, [createCollection('orders')], {
      prechecks: true,
      postchecks: false,
      idempotencyChecks: false,
    });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation collection.orders.create stopped: collection orders already exists without the options this migration creates it with',
      why: "If orders holds nothing you need, drop it, then run the command again; operations that already ran are skipped. Otherwise give it the options the createCollection call of this migration's migration.ts sets, and no validator, since that call sets none, and run the command again: the creation is then skipped. The failed apply changed nothing.",
      meta: { operationId: 'collection.orders.create', databaseUnchanged: true },
    });
  });

  it('names the validator among the options when the create sets one', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'orders' }];

    const result = await execute(
      harness,
      [createCollection('orders', { validator: { $jsonSchema: { bsonType: 'object' } } })],
      { prechecks: true, postchecks: false, idempotencyChecks: false },
    );

    expect(failureFields(result.assertNotOk()).why).toBe(
      "If orders holds nothing you need, drop it, then run the command again; operations that already ran are skipped. Otherwise give it the options the createCollection call of this migration's migration.ts sets, its validator among them, and run the command again: the creation is then skipped. The failed apply changed nothing.",
    );
  });
});
