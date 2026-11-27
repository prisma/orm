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
  "This migration's ops.json was written before a creation had an after-check, so the runner cannot tell whether an earlier run of this migration made collection orders. If no other database has applied this migration, run its migration.ts with node, which writes its ops.json again with the after-check and changes the migration's hash, then run the command again: the creation is then skipped if orders has the options the createCollection call of this migration's migration.ts sets, and no validator, since that call sets none. If orders holds nothing you need, drop it, then run the command again; operations that already ran are skipped.";
const EXTENSION_FIRST_TWO_WAYS =
  "This migration's ops.json was written before a creation had an after-check, so the runner cannot tell whether an earlier run of this migration made collection orders. This migration belongs to an extension: its operations come from the extension's package, not from a migration.ts in this project, so its ops.json cannot be written again here. If orders holds nothing you need, drop it, then run the command again; operations that already ran are skipped.";
const SECTION =
  'Follow every step under "Moving a MongoDB collection aside" in the error reference for MIGRATION.PRECHECK_FAILED, which keep the documents until the copy back is checked.';
const MOVED_ASIDE = (to: string) =>
  `If orders holds documents you need, you can keep them by moving the collection aside: stop the application's writes to it, move it to orders_kept, run db migrate --to ${to} so this migration creates orders with its options, and copy the documents back. ${SECTION}`;
const EXTENSION_MOVED_ASIDE = `If orders holds documents you need, you can keep them by moving the collection aside: stop the application's writes to it, move it to orders_kept, run the command again so this migration creates orders with its options, and copy the documents back. Follow every step under "Moving a MongoDB collection aside" in the error reference for MIGRATION.PRECHECK_FAILED, with its part for an extension's migration, which keep the documents until the copy back is checked.`;
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
      why: `${FIRST_TWO_WAYS} ${MOVED_ASIDE(UNNAMED)} ${SIGNED_BY_HAND} The failed apply changed nothing.`,
      meta: { operationId: 'collection.orders.create', databaseUnchanged: true },
    });
  });

  it('gives the db sign way on a database whose change policy permits reconcile', async () => {
    const result = await executeUnderChange(['migrate', 'reconcile']);

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${FIRST_TWO_WAYS} ${MOVED_ASIDE('20261127T0000_orders')} ${SIGNED_BY_HAND} The failed apply changed nothing.`,
    );
  });

  it('gives the move-aside way and leaves out the db sign way on a database whose change policy permits only migrations', async () => {
    const result = await executeUnderChange(['migrate']);

    const { why } = failureFields(result.assertNotOk());
    expect(why).toBe(
      `${FIRST_TWO_WAYS} ${MOVED_ASIDE('20261127T0000_orders')} The failed apply changed nothing.`,
    );
    expect(why).not.toMatch(/db sign|permit-policy-change|reconcile|policy/);
  });

  it("leaves out writing ops.json again for an extension's migration, whose operations come from its package, and does not name --to", async () => {
    const result = await executeUnderChange(['migrate'], 'audit');

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${EXTENSION_FIRST_TWO_WAYS} ${EXTENSION_MOVED_ASIDE} The failed apply changed nothing.`,
    );
  });

  const unchecked = (name: string) => ({ ...createCollection(name), postcheck: [] });
  const OTHER_STOPS = (stops: string) =>
    `Whether you drop orders or move it aside, the next run would also stop at the create of ${stops}. Before that run, move each of them aside as below if it holds documents you need, or drop it if it holds nothing you need.`;

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

  it('names every other collection this migration creates that already exists, so the run does not stop again at the next one', async () => {
    const result = await executeMigrations(
      [[unchecked('orders'), unchecked('users'), unchecked('items')], [unchecked('archive')]],
      ['orders', 'items', 'archive'],
    );

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${FIRST_TWO_WAYS} ${OTHER_STOPS('collection items, which this migration also creates and which already exists')} ${MOVED_ASIDE('20261127T0000_m0')} The failed apply changed nothing.`,
    );
  });

  it('names the collections the run that stopped created, in this migration and an earlier one, since the next run starts again from the marker and stops at them too', async () => {
    const result = await executeMigrations(
      [
        [unchecked('users'), unchecked('tags')],
        [unchecked('notes'), unchecked('orders'), unchecked('items'), unchecked('logs')],
        [unchecked('archive')],
      ],
      ['orders', 'items', 'archive'],
    );

    expect(failureFields(result.assertNotOk()).why).toContain(
      `${OTHER_STOPS('collections users, tags, and notes, which the run that stopped created in this migration or an earlier one, so they hold only documents written since, and at the create of collection items, which this migration also creates and which already exists')} ${MOVED_ASIDE('20261127T0001_m1')}`,
    );
  });

  it("names the existing collections that a later migration of an extension's space creates, since the command run again goes on to the end of that space's plan", async () => {
    const result = await executeMigrations(
      [[unchecked('orders')], [unchecked('users'), unchecked('items')]],
      ['orders', 'items'],
      'audit',
    );

    expect(failureFields(result.assertNotOk()).why).toBe(
      `${EXTENSION_FIRST_TWO_WAYS} ${OTHER_STOPS('collection items, which this migration or a later one of the extension also creates and which already exists')} ${EXTENSION_MOVED_ASIDE} The failed apply changed nothing.`,
    );
  });
});
