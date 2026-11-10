import { introspectSchema, MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { asNamespaceId } from '@internal/contract/types';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();
export const NS = asNamespaceId('__unbound__');
const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

export function closedSchema(fields: readonly string[]) {
  return {
    bsonType: 'object',
    required: ['_id', ...fields],
    properties: Object.fromEntries([
      ['_id', { bsonType: 'objectId' }],
      ...fields.map((field) => [field, { bsonType: 'string' }]),
    ]),
    additionalProperties: false,
  };
}

export interface ModelSpec {
  readonly collection: string;
  readonly fields: readonly string[];
  readonly base?: string;
  readonly variants?: Readonly<Record<string, string>>;
}

export function contract(
  storageHash: string,
  models: Readonly<Record<string, ModelSpec>>,
  collections: Readonly<Record<string, MongoCollection>>,
): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'p1',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          models: Object.fromEntries(
            Object.entries(models).map(([name, spec]) => [
              name,
              {
                fields: Object.fromEntries(spec.fields.map((field) => [field, {}])),
                relations: {},
                storage: {
                  collection: spec.collection,
                  fields: Object.fromEntries(spec.fields.map((field) => [field, { field }])),
                },
                ...(spec.base === undefined
                  ? {}
                  : { base: { namespace: '__unbound__', model: spec.base } }),
                ...(spec.variants === undefined
                  ? {}
                  : {
                      discriminator: { field: 'type' },
                      variants: Object.fromEntries(
                        Object.entries(spec.variants).map(([variant, value]) => [
                          value,
                          { namespace: '__unbound__', model: variant },
                        ]),
                      ),
                    }),
              },
            ]),
          ),
        },
      },
    },
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: collections },
        },
      },
    },
  } as unknown as MongoContract;
}

export function closedCollection(fields: readonly string[], unique: readonly string[] = []) {
  return new MongoCollection({
    indexes: unique.map((field) => ({
      name: `${field}_1`,
      keys: [{ field, direction: 1 as const }],
      unique: true,
    })),
    validator: {
      jsonSchema: closedSchema(fields),
      validationLevel: 'strict',
      validationAction: 'error',
    },
  });
}

/**
 * Starts a MongoDB replica set for the file, empties the database before each test, and returns
 * the helpers that plan and run against it.
 */
export function useStatementsDatabase(dbName: string) {
  let replSet: MongoMemoryReplSet | undefined;
  let client: MongoClient | undefined;
  let database: Db | undefined;
  const live = (): Db => {
    if (database === undefined) throw new Error('The database is not started');
    return database;
  };
  const connected = (): MongoClient => {
    if (client === undefined) throw new Error('The database is not started');
    return client;
  };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    database = client.db(dbName);
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    const collections = await live().listCollections().toArray();
    for (const col of collections) {
      const name = col['name'] as string;
      if (!name.startsWith('system.')) await live().dropCollection(name);
    }
  });

  async function createClosed(
    name: string,
    fields: readonly string[],
    unique: readonly string[],
    documents: readonly Record<string, unknown>[],
  ) {
    await live().createCollection(name, {
      validator: { $jsonSchema: closedSchema(fields) },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    for (const field of unique) {
      await live()
        .collection(name)
        .createIndex({ [field]: 1 }, { unique: true, name: `${field}_1` });
    }
    await live()
      .collection(name)
      .insertMany(documents.map((document) => ({ ...document })));
  }

  async function planAndRun(
    from: MongoContract,
    to: MongoContract,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    await controlAdapter.initMarker(new MongoControlDriver(live(), connected()), 'app', {
      storageHash: from.storage.storageHash,
      profileHash: 'p1',
    });
    const planned = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(live()),
      policy,
      fromContract: from,
      origin: { storageHash: from.storage.storageHash },
      statements,
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts, null, 2));
    const operations = planned.plan.operations as readonly AnyMongoMigrationOperation[];
    const plan: MigrationPlan = {
      targetId: 'mongo',
      operations: JSON.parse(serializeMongoOps(operations)),
      origin: { storageHash: from.storage.storageHash },
      destination: { storageHash: to.storage.storageHash },
    };
    const result = await new MongoMigrationRunner(
      controlAdapter.createRunnerDependencies(new MongoControlDriver(live(), connected())),
    ).execute({
      plan,
      migrationEdges: [
        buildFabricatedMigrationEdge({
          currentMarkerStorageHash: from.storage.storageHash,
          destinationStorageHash: to.storage.storageHash,
          operationCount: operations.length,
        }),
      ],
      destinationContract: to,
      policy,
      frameworkComponents: [],
    });
    return { planned, result };
  }

  async function furtherPlanLabels(to: MongoContract): Promise<readonly string[]> {
    const planned = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(live()),
      policy,
      fromContract: to,
      origin: { storageHash: to.storage.storageHash },
      statements: [],
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
    return (planned.plan.operations as readonly AnyMongoMigrationOperation[]).map(
      (operation) => operation.label,
    );
  }

  async function documents(name: string) {
    return live()
      .collection(name)
      .find({}, { projection: { _id: 0 }, sort: { _id: 1 } })
      .toArray();
  }

  return { db: live, createClosed, planAndRun, furtherPlanLabels, documents };
}
