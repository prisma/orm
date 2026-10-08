import { asNamespaceId } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIndex, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { expectDataLossMatchesDestructive } from '@repo/test-utils/data-loss-expectations';
import { describe, expect, it } from 'vitest';
import { keepDataByHand, MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';

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

function plan(fromContract: MongoContract | null) {
  const result = new MongoMigrationPlanner().plan({
    contract: contractWith({ User: 'users' }, 'to'),
    schema: new MongoSchemaIR([
      new MongoSchemaCollection({ name: 'users' }),
      new MongoSchemaCollection({
        name: 'events',
        indexes: [new MongoSchemaIndex({ keys: [{ field: 'at', direction: 1 }] })],
      }),
    ]),
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
    (result.plan as PlannerProducedMongoMigration).operations,
  );
  return {
    operations: (result.plan as PlannerProducedMongoMigration).operations.map(
      (operation) => operation.label,
    ),
    dataLoss: result.dataLoss,
    accessWidening: result.accessWidening,
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
        },
      ],
      accessWidening: [],
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
});

describe('keepDataByHand', () => {
  it('says to rename the collection a dropped model stores its documents in', () => {
    expect(
      keepDataByHand(
        { kind: 'model', namespaceId: asNamespaceId('__unbound__'), model: 'Event' },
        contractWith({ Event: 'events' }, 'from'),
      ),
    ).toBe(
      'If it was renamed, keep its documents instead: rename collection "events" by hand on each database before a plan that drops it is applied there, for example with db.getCollection("events").renameCollection("<new collection>") in mongosh. db update then drops nothing; a migration written by migration plan still drops "events", so remove that operation from its migration.ts, or do not apply it where the collection was renamed.',
    );
  });

  it('names a collection no model stores by its name', () => {
    expect(keepDataByHand({ kind: 'storage', name: 'audit' }, contractWith({}, 'from'))).toBe(
      'If it was renamed, keep its documents instead: rename collection "audit" by hand on each database before a plan that drops it is applied there, for example with db.getCollection("audit").renameCollection("<new collection>") in mongosh. db update then drops nothing; a migration written by migration plan still drops "audit", so remove that operation from its migration.ts, or do not apply it where the collection was renamed.',
    );
  });
});
