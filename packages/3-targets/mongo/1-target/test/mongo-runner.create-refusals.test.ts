import { DEFAULT_DATABASE_POLICIES } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { createCollection } from '../src/core/migrations/migration-factories';
import {
  ALL_POLICY,
  execute,
  failureFields,
  makeContract,
  makeHarness,
  makePlan,
  synthEdges,
} from './mongo-runner-harness';

const FIRST_TWO_WAYS =
  "This migration's ops.json was written before a creation had an after-check, so the runner cannot tell whether an earlier run of this migration made collection orders. If no other database has applied this migration, run its migration.ts with node, which writes its ops.json again with the after-check and changes the migration's hash, then run the command again: the creation is then skipped if orders has the options the createCollection call of this migration's migration.ts sets, and no validator, since that call sets none. If orders holds nothing you need, drop it, then run the command again; operations that already ran are skipped.";
const SIGNED_BY_HAND =
  "Otherwise leave the migration as it is, apply the operations of this migration that did not run by hand, then run db sign with the name of this migration's directory. db sign checks the collections, their validators and their indexes against the contract this migration leads to, not the documents, so first check yourself that the documents are as the operations you applied leave them. It then records the database at that contract, so the next run starts after this migration. migration status then shows the database as up to date, but does not mark this migration as applied, since no run of it is recorded.";

async function executeUnderChange(change: readonly ('migrate' | 'reconcile')[]) {
  const harness = makeHarness();
  harness.inspectionExecutor.collections = [{ name: 'orders' }];
  const plan = makePlan([{ ...createCollection('orders'), postcheck: [] }]);
  return harness.runner.execute({
    plan,
    migrationEdges: synthEdges(plan),
    destinationContract: makeContract('dest'),
    policy: ALL_POLICY,
    frameworkComponents: [],
    checkedPolicies: { ...DEFAULT_DATABASE_POLICIES, change },
  });
}

describe('MongoMigrationRunner, a create whose collection already exists', () => {
  it('names the two ways out, and that only postchecks and idempotency checks skip the create, when they are off', async () => {
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
      why: "If orders holds nothing you need, drop it, then run the command again. With postchecks or idempotency checks turned off, a run skips no operation, so each operation that already ran runs again. Otherwise give it the options the createCollection call of this migration's migration.ts sets, and no validator, since that call sets none, and run the command again with postchecks and idempotency checks on: only they skip the creation. The failed apply changed nothing.",
      meta: { operationId: 'collection.orders.create', databaseUnchanged: true },
    });
  });

  it('names the validator among the options when the create sets one, and that the create is then skipped', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'orders' }];

    const result = await execute(harness, [
      createCollection('orders', { validator: { $jsonSchema: { bsonType: 'object' } } }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toBe(
      "If orders holds nothing you need, drop it, then run the command again; operations that already ran are skipped. Otherwise give it the options the createCollection call of this migration's migration.ts sets, its validator among them, and run the command again: the creation is then skipped. The failed apply changed nothing.",
    );
  });

  it('says the runner cannot tell who made the collection when the create has no after-check, and gives the three ways on', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'orders' }];

    const result = await execute(harness, [{ ...createCollection('orders'), postcheck: [] }]);

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        "Operation collection.orders.create stopped: collection orders already exists, and this migration's create has no after-check that lets a run skip it",
      why: `${FIRST_TWO_WAYS} ${SIGNED_BY_HAND} The failed apply changed nothing.`,
      meta: { operationId: 'collection.orders.create', databaseUnchanged: true },
    });
  });

  it('gives the db sign way on a database whose change policy permits reconcile', async () => {
    const result = await executeUnderChange(['migrate', 'reconcile']);

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${FIRST_TWO_WAYS} ${SIGNED_BY_HAND} The failed apply changed nothing.`,
    );
  });

  it('says no way past the create remains on a database whose change policy permits only migrations, when the first two do not apply', async () => {
    const result = await executeUnderChange(['migrate']);

    const { why } = failureFields(result.assertNotOk());
    expect(why).toBe(
      `${FIRST_TWO_WAYS} This database's change policy permits only migrations, so it cannot be signed past this create by hand. When neither of those two ways applies, this database's change policy permits no recovery for this create. The failed apply changed nothing.`,
    );
    expect(why).not.toMatch(/db sign|permit-policy-change|reconcile/);
  });
});
