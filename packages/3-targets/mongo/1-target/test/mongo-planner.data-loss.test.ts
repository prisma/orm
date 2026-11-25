import { asNamespaceId } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIndex, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { expectDataLossMatchesDestructive } from '@repo/test-utils/data-loss-expectations';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  contract,
  planned,
  plan as planStatementsFixture,
  schemaCollection,
  settledOperations,
} from './mongo-statement-fixtures';

const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

/** A contract whose models each store their documents in the named collection. */
function contractWith(
  models: Readonly<Record<string, string>>,
  seed: string,
  bases: Readonly<Record<string, string>> = {},
): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          models: Object.fromEntries(
            Object.entries(models).map(([model, collection]) => [
              model,
              {
                fields: {},
                relations: {},
                storage: { collection },
                ...(bases[model] === undefined
                  ? {}
                  : { base: { namespace: '__unbound__', model: bases[model] } }),
              },
            ]),
          ),
        },
      },
    },
    storage: {
      storageHash: `storage-${seed}`,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: Object.fromEntries(
              Object.values(models).map((collection) => [collection, new MongoCollection({})]),
            ),
          },
        },
      },
    },
  } as unknown as MongoContract;
}

function plan(
  fromContract: MongoContract | null,
  contract: MongoContract = contractWith({ User: 'users' }, 'to'),
) {
  const result = new MongoMigrationPlanner().plan({
    contract,
    schema: new MongoSchemaIR(
      [
        new MongoSchemaCollection({ name: 'users' }),
        new MongoSchemaCollection({
          name: 'events',
          indexes: [new MongoSchemaIndex({ name: 'at_1', keys: [{ field: 'at', direction: 1 }] })],
        }),
      ],
      { fromDatabase: false },
    ),
    policy: ALL_CLASSES_POLICY,
    fromContract,
    origin: null,
    statements: [],
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  expectDataLossMatchesDestructive(
    result,
    settledOperations(result.plan as PlannerProducedMongoMigration),
  );
  return {
    operations: settledOperations(result.plan as PlannerProducedMongoMigration).map(
      (operation) => operation.label,
    ),
    dataLoss: result.dataLoss,
    accessChanges: result.accessChanges,
  };
}

describe('MongoDB planner, data loss', () => {
  it('names the model whose collection a drop loses, and only the collection drop', () => {
    const planned = plan(contractWith({ User: 'users', Event: 'events' }, 'from'));
    const dropIndex = planned.operations.findIndex((label) => label.startsWith('Drop index'));
    const dropCollection = planned.operations.indexOf('Drop collection events');

    expect({ dropIndex: dropIndex >= 0, ...planned }).toMatchObject({
      dropIndex: true,
      dataLoss: [
        {
          operationIndex: dropCollection,
          subject: { kind: 'model', namespaceId: asNamespaceId('__unbound__'), model: 'Event' },
          loss: 'drop',
          label: 'Drop collection events',
        },
      ],
      accessChanges: [],
    });
  });

  it('names the collection by its name when the plan has no origin contract', () => {
    const planned = plan(null);
    expect(
      planned.dataLoss.map(({ operationIndex, subject }) => ({
        operation: planned.operations[operationIndex],
        subject,
      })),
    ).toEqual([
      { operation: 'Drop collection events', subject: { kind: 'storage', name: 'events' } },
    ]);
  });

  it('names the root model when a variant shares the dropped collection', () => {
    const fromContract = contractWith(
      { Meeting: 'events', User: 'users', Event: 'events' },
      'from',
      { Meeting: 'Event' },
    );
    const planned = plan(fromContract);

    expect(
      planned.dataLoss.map(({ operationIndex, subject }) => ({
        operation: planned.operations[operationIndex],
        subject,
      })),
    ).toEqual([
      {
        operation: 'Drop collection events',
        subject: { kind: 'model', namespaceId: asNamespaceId('__unbound__'), model: 'Event' },
      },
    ]);
  });

  it('renames the collection of a model that keeps its name, which loses nothing, and drops the index the contract leaves out on the renamed collection', () => {
    const planned = plan(
      contractWith({ User: 'users', Event: 'events' }, 'from'),
      contractWith({ User: 'users', Event: 'occasions' }, 'to'),
    );

    expect(planned).toEqual({
      operations: ['Rename collection events to occasions', 'Drop index at_1 on occasions (at:1)'],
      dataLoss: [],
      accessChanges: [],
    });
  });

  it('gives no advice when the model of the dropped collection is gone', () => {
    const planned = plan(contractWith({ User: 'users', Event: 'events' }, 'from'));
    expect(planned.dataLoss.map(({ keepDataAdvice }) => keepDataAdvice)).toEqual([undefined]);
  });

  it('advises renaming the collection by hand when the plan does not rename it, because the new collection is not managed', () => {
    const result = planStatementsFixture({
      from: contract(
        'from',
        { Event: { collection: 'events', fields: ['_id', 'name'] } },
        { events: { unique: ['name'] } },
      ),
      to: contract(
        'to',
        { Event: { collection: 'occasions', fields: ['_id', 'name'] } },
        { occasions: { unique: ['name'], control: 'tolerated' } },
      ),
      schema: [schemaCollection('events', { unique: ['name'] })],
    });

    expect(planned(result)).toEqual({
      labels: [
        'Drop index name_1 on events (name:1)',
        'Create index name_1 on occasions (name:1)',
        'Drop collection events',
      ],
      classes: ['widening', 'additive', 'destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 2,
          subject: { kind: 'model', namespaceId: asNamespaceId('__unbound__'), model: 'Event' },
          loss: 'drop',
          label: 'Drop collection events',
          keepDataAdvice:
            'To keep its documents, rename collection "events" to "occasions" instead. The plan does not rename it: a plan renames the collection of a model that keeps its name only when the control policy of the collection is "managed" in both contracts. With db update, rename the collection in the database yourself, for example db.getCollection("events").renameCollection("occasions") in mongosh, then run db update. With migration plan, plan it, passing --delete Event to answer its question; in its migration.ts put renameCollection("events", "occasions") right after the drops of indexes on "events", if there are any, and before every other operation, imported with the other operations, delete the drop of "events", and delete the create of "occasions" if there is one; run node on that migration.ts so it writes ops.json again; then apply it with prisma db migrate.',
        },
      ],
    });
  });
});
