import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationRunner, serializeMongoOps } from '@internal/target-mongo/control';
import { collMod } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();
const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

/** A closed validator of a `users` collection whose documents require every one of `properties`. */
export function usersSchema(properties: Record<string, Record<string, unknown>>) {
  return {
    bsonType: 'object',
    required: ['_id', ...Object.keys(properties)],
    properties: { _id: { bsonType: 'objectId' }, ...properties },
    additionalProperties: false,
  };
}

/** A contract with one model, `User`, in a `users` collection with the validator `usersSchema` gives. */
export function usersContract(properties: Record<string, Record<string, unknown>>): MongoContract {
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
          models: {
            User: {
              fields: Object.fromEntries(Object.keys(properties).map((field) => [field, {}])),
              relations: {},
              storage: {
                collection: 'users',
                fields: Object.fromEntries(
                  Object.keys(properties).map((field) => [field, { field }]),
                ),
              },
            },
          },
        },
      },
    },
    storage: {
      storageHash: 'dest',
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: {
              users: new MongoCollection({
                validator: {
                  jsonSchema: usersSchema(properties),
                  validationLevel: 'strict',
                  validationAction: 'error',
                },
              }),
            },
          },
        },
      },
    },
  } as unknown as MongoContract;
}

/** The validator change `migration plan` writes for `users`, checking the documents first. */
export function usersValidatorChange(properties: Record<string, Record<string, unknown>>) {
  return collMod(
    'users',
    {
      validator: { $jsonSchema: usersSchema(properties) },
      validationLevel: 'strict',
      validationAction: 'error',
    },
    {
      id: 'validator.users.update',
      label: 'Update validator on users',
      operationClass: 'widening',
      checkDocuments: true,
    },
  );
}

/**
 * Starts a MongoDB replica set for the file, empties the database and sets the marker before each
 * test, and returns the database and a function that runs operations against it.
 */
export function useUsersDatabase(dbName: string) {
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
    for (const collection of await live().listCollections().toArray()) {
      await live().dropCollection(collection.name);
    }
    await controlAdapter.initMarker(new MongoControlDriver(live(), connected()), 'app', {
      storageHash: 'origin',
      profileHash: 'p1',
    });
  });

  async function run(operations: readonly AnyMongoMigrationOperation[], contract: MongoContract) {
    const plan: MigrationPlan = {
      targetId: 'mongo',
      operations: JSON.parse(serializeMongoOps(operations)),
      destination: { storageHash: 'dest' },
    };
    return new MongoMigrationRunner(
      controlAdapter.createRunnerDependencies(new MongoControlDriver(live(), connected())),
    ).execute({
      plan,
      migrationEdges: [
        buildFabricatedMigrationEdge({
          currentMarkerStorageHash: 'origin',
          destinationStorageHash: 'dest',
          operationCount: operations.length,
        }),
      ],
      destinationContract: contract,
      policy,
      frameworkComponents: [],
    });
  }

  return { db: live, run };
}
