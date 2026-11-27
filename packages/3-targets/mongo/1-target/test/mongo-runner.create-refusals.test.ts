import { DEFAULT_DATABASE_POLICIES } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
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
  "This migration's ops.json was written before a creation had an after-check, so the runner cannot tell whether an earlier run of this migration made collection orders. If no other database has applied this migration, run its migration.ts with node, which writes its ops.json again with the after-check and changes the migration's hash, then run the command again: the creation is then skipped if orders has the options the createCollection call of this migration's migration.ts sets, and no validator, since that call sets none. If orders holds nothing you need, drop it, then run the command that stopped again, as you ran it; operations that already ran are skipped. This holds also if an earlier run of this command created orders: an operation of that run may have moved documents into it from a collection it then deleted them from, and those documents are only in orders.";
const EXTENSION_FIRST_TWO_WAYS =
  "This migration's ops.json was written before a creation had an after-check, so the runner cannot tell whether an earlier run of this migration made collection orders. This migration belongs to an extension: its operations come from the extension's package, not from a migration.ts in this project, so its ops.json cannot be written again here. If orders holds nothing you need, drop it, then run the command that stopped again, as you ran it; operations that already ran are skipped. This holds also if an earlier run of this command created orders: an operation of that run may have moved documents into it from a collection it then deleted them from, and those documents are only in orders.";
const SECTION =
  'Follow every step under "Moving a MongoDB collection aside" in the error reference for MIGRATION.PRECHECK_FAILED, which keep the documents until the copy back is checked.';
const MOVED_ASIDE = (to: string) =>
  `If orders holds documents you need, you can keep them by moving the collection aside: stop the application's writes to it until every step is done, move it to orders_kept, run db migrate --to ${to} so this migration creates orders with its options, apply to the documents in orders_kept the changes that the operations after the create make, and copy them back. ${SECTION}`;
const EXTENSION_MOVED_ASIDE = `If orders holds documents you need, you can keep them by moving the collection aside: stop the application's writes to it until every step is done, move it to orders_kept, run the command again so this migration creates orders with its options, apply to the documents in orders_kept the changes that the operations after the create make, and copy them back. Follow every step under "Moving a MongoDB collection aside" in the error reference for MIGRATION.PRECHECK_FAILED, with its part for an extension's migration, which keep the documents until the copy back is checked.`;
const NEXT_STOP =
  'The next run may stop at another create in the same state, in this migration or in another migration it applies; the same steps apply to it.';
const UNNAMED = "<the name of this migration's directory>";
const SIGNED_BY_HAND =
  "Or, without moving the documents, leave the migration as it is, apply the operations of this migration that did not run by hand, then run db sign with the name of this migration's directory. db sign checks the collections, their validators and their indexes against the contract this migration leads to, not the documents, so first check yourself that the documents are as the operations you applied leave them. It then records the database at that contract, so the next run starts after this migration. migration status then shows the database as up to date, but does not mark this migration as applied, since no run of it is recorded.";

async function executeUnderChange(change: readonly ('migrate' | 'reconcile')[], spaceId?: string) {
  const harness = makeHarness();
  harness.inspectionExecutor.collections = [{ name: 'orders' }];
  const plan = {
    ...makePlan([{ ...createCollection('orders'), postcheck: [] }]),
    ...ifDefined('spaceId', spaceId),
  };
  const [edge] = synthEdges(plan);
  if (edge === undefined) throw new Error('synthEdges made no edge');
  return harness.runner.execute({
    plan,
    migrationEdges: [
      { ...edge, dirName: '20261101T0000_empty', operationCount: 0 },
      { ...edge, dirName: '20261127T0000_orders', operationCount: 1 },
    ],
    destinationContract: makeContract('dest'),
    policy: ALL_POLICY,
    frameworkComponents: [],
    policiesInForce: { ...DEFAULT_DATABASE_POLICIES, change },
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
      why: `${FIRST_TWO_WAYS} ${MOVED_ASIDE(UNNAMED)} ${SIGNED_BY_HAND} ${NEXT_STOP} The failed apply changed nothing.`,
      meta: { operationId: 'collection.orders.create', databaseUnchanged: true },
    });
  });

  it('gives the db sign way on a database whose change policy permits reconcile', async () => {
    const result = await executeUnderChange(['migrate', 'reconcile']);

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${FIRST_TWO_WAYS} ${MOVED_ASIDE('20261127T0000_orders')} ${SIGNED_BY_HAND} ${NEXT_STOP} The failed apply changed nothing.`,
    );
  });

  it('gives the move-aside way and leaves out the db sign way on a database whose change policy permits only migrations', async () => {
    const result = await executeUnderChange(['migrate']);

    const { why } = failureFields(result.assertNotOk());
    expect(why).toBe(
      `${FIRST_TWO_WAYS} ${MOVED_ASIDE('20261127T0000_orders')} ${NEXT_STOP} The failed apply changed nothing.`,
    );
    expect(why).not.toMatch(/db sign|permit-policy-change|reconcile|policy/);
  });

  it("leaves out writing ops.json again for an extension's migration, whose operations come from its package, and does not name --to", async () => {
    const result = await executeUnderChange(['migrate'], 'audit');

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${EXTENSION_FIRST_TWO_WAYS} ${EXTENSION_MOVED_ASIDE} ${NEXT_STOP} The failed apply changed nothing.`,
    );
  });

  const unchecked = (name: string) => ({ ...createCollection(name), postcheck: [] });
  async function executeMigrations(
    migrations: readonly (readonly ReturnType<typeof unchecked>[])[],
    existing: readonly string[],
    spaceId?: string,
  ) {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = existing.map((name) => ({ name }));
    const plan = { ...makePlan(migrations.flat()), ...ifDefined('spaceId', spaceId) };
    const [edge] = synthEdges(plan);
    if (edge === undefined) throw new Error('synthEdges made no edge');
    return harness.runner.execute({
      plan,
      migrationEdges: migrations.map((operations, index) => ({
        ...edge,
        dirName: `20261127T000${index}_m${index}`,
        operationCount: operations.length,
      })),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
      policiesInForce: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
    });
  }

  it('names no other collection, however many other creates with no after-check the run made or will meet, and says the next run may stop at one the same way', async () => {
    const result = await executeMigrations(
      [
        [unchecked('users'), unchecked('tags')],
        [unchecked('notes'), unchecked('orders'), unchecked('items'), unchecked('logs')],
        [unchecked('archive')],
      ],
      ['orders', 'items', 'archive'],
    );

    const { why } = failureFields(result.assertNotOk());
    expect(why).toContain(
      `This holds also if an earlier run of this command created orders: an operation of that run may have moved documents into it from a collection it then deleted them from, and those documents are only in orders. ${MOVED_ASIDE('20261127T0001_m1')} ${NEXT_STOP} The operations that ran before the failure stay applied.`,
    );
    expect(why).not.toMatch(/users|tags|notes|items|logs|archive/);
  });

  it("names no other collection for an extension's migration either", async () => {
    const result = await executeMigrations(
      [[unchecked('orders')], [unchecked('users'), unchecked('items')]],
      ['orders', 'items'],
      'audit',
    );

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${EXTENSION_FIRST_TWO_WAYS} ${EXTENSION_MOVED_ASIDE} ${NEXT_STOP} The failed apply changed nothing.`,
    );
  });
});
