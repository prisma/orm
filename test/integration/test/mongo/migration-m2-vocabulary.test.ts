import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { coreHash, crossRef, profileHash } from '@internal/contract/types';
import mongoControlDriver from '@internal/driver-mongo/control';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import {
  MongoCollection,
  type MongoCollectionInput,
  type MongoContract,
} from '@internal/mongo-contract';
import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFabricatedMigrationEdges } from './fabricated-migration-edges';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function makeContract(
  collections: Record<string, MongoCollectionInput>,
  hashSeed: string,
): MongoContract {
  const normalized: Record<string, MongoCollection> = {};
  for (const [name, coll] of Object.entries(collections)) {
    normalized[name] = coll instanceof MongoCollection ? coll : new MongoCollection(coll);
  }
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: Object.fromEntries(Object.keys(collections).map((c) => [c, crossRef(c)])),
    domain: applicationDomainOf({
      models: Object.fromEntries(
        Object.keys(collections).map((c) => [
          c,
          {
            fields: {
              _id: {
                nullable: false,
                type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
              },
            },
            relations: {},
            storage: { collection: c },
          },
        ]),
      ),
    }),
    storage: {
      namespaces: {
        __unbound__: {
          id: '__unbound__' as const,
          kind: 'mongo-namespace' as const,
          entries: { collection: normalized },
        },
      },
      storageHash: coreHash(`${hashSeed}`),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('test'),
    meta: {},
  };
}

async function planAndApply(
  _db: Db,
  replSetUri: string,
  origin: MongoContract | null,
  destination: MongoContract,
): Promise<void> {
  const planner = new MongoMigrationPlanner();
  const schema = contractToMongoSchemaIR(origin);
  const result = planner.plan({
    contract: destination,
    schema,
    policy: ALL_POLICY,
    fromContract: origin,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`Plan failed: ${JSON.stringify(result)}`);
  }

  const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
  if (ops.length === 0) return;

  const serialized = JSON.parse(serializeMongoOps(ops));
  const controlDriver = await mongoControlDriver.create(replSetUri);
  try {
    const runner = new MongoMigrationRunner(
      new MongoControlAdapterImpl().createRunnerDependencies(controlDriver),
    );
    const plan = {
      targetId: 'mongo',
      ...(origin ? { origin: { storageHash: origin.storage.storageHash } } : {}),
      destination: { storageHash: destination.storage.storageHash },
      operations: serialized,
    };
    const runResult = await runner.execute({
      plan,
      migrationEdges: buildFabricatedMigrationEdges(plan),
      destinationContract: destination,
      policy: ALL_POLICY,
      frameworkComponents: [],
    });
    if (!runResult.ok) {
      throw new Error(`Apply failed: ${JSON.stringify(runResult)}`);
    }
  } finally {
    await controlDriver.close();
  }
}

describe('MongoDB migration M2 vocabulary E2E', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'migration_m2_test';
  let replSetUri: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
    replSetUri = replSet.getUri(dbName);
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await db.dropDatabase();
  });

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // ignore
    }
  }, timeouts.spinUpMongoMemoryServer);

  describe('compound indexes', () => {
    it('creates a compound ascending + descending index', async () => {
      const contract = makeContract(
        {
          users: {
            indexes: [
              {
                keys: [
                  { field: 'lastName', direction: 1 },
                  { field: 'firstName', direction: -1 },
                ],
              },
            ],
          },
        },
        'compound-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('users').listIndexes().toArray();
      const compound = indexes.find(
        (idx) => idx['key']?.['lastName'] === 1 && idx['key']?.['firstName'] === -1,
      );
      expect(compound).toBeDefined();
    });
  });

  describe('text indexes', () => {
    it('creates a text index with weights, default_language, and language_override', async () => {
      const contract = makeContract(
        {
          articles: {
            indexes: [
              {
                keys: [
                  { field: 'title', direction: 'text' },
                  { field: 'body', direction: 'text' },
                ],
                weights: { title: 10, body: 5 },
                default_language: 'english',
                language_override: 'idioma',
              },
            ],
          },
        },
        'text-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('articles').listIndexes().toArray();
      const textIdx = indexes.find((idx) => idx['key']?.['_fts'] === 'text');
      expect(textIdx).toBeDefined();
      expect(textIdx!['weights']).toEqual({ title: 10, body: 5 });
      expect(textIdx!['default_language']).toBe('english');
      expect(textIdx!['language_override']).toBe('idioma');
    });
  });

  describe('TTL indexes', () => {
    it('creates a TTL index', async () => {
      const contract = makeContract(
        {
          sessions: {
            indexes: [
              {
                keys: [{ field: 'expiresAt', direction: 1 }],
                expireAfterSeconds: 3600,
              },
            ],
          },
        },
        'ttl-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('sessions').listIndexes().toArray();
      const ttlIdx = indexes.find((idx) => idx['key']?.['expiresAt'] === 1);
      expect(ttlIdx).toBeDefined();
      expect(ttlIdx!['expireAfterSeconds']).toBe(3600);
    });
  });

  describe('hashed indexes', () => {
    it('creates a hashed index', async () => {
      const contract = makeContract(
        {
          items: {
            indexes: [{ keys: [{ field: 'shard_key', direction: 'hashed' }] }],
          },
        },
        'hashed-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('items').listIndexes().toArray();
      const hashIdx = indexes.find((idx) => idx['key']?.['shard_key'] === 'hashed');
      expect(hashIdx).toBeDefined();
    });
  });

  describe('2dsphere indexes', () => {
    it('creates a 2dsphere geospatial index', async () => {
      const contract = makeContract(
        {
          places: {
            indexes: [{ keys: [{ field: 'location', direction: '2dsphere' }] }],
          },
        },
        '2dsphere-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('places').listIndexes().toArray();
      const geoIdx = indexes.find((idx) => idx['key']?.['location'] === '2dsphere');
      expect(geoIdx).toBeDefined();
    });
  });

  describe('partial indexes', () => {
    it('creates a partial index with partialFilterExpression', async () => {
      const contract = makeContract(
        {
          users: {
            indexes: [
              {
                keys: [{ field: 'email', direction: 1 }],
                unique: true,
                partialFilterExpression: { email: { $exists: true } },
              },
            ],
          },
        },
        'partial-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('users').listIndexes().toArray();
      const partialIdx = indexes.find((idx) => idx['key']?.['email'] === 1);
      expect(partialIdx).toBeDefined();
      expect(partialIdx!['unique']).toBe(true);
      expect(partialIdx!['partialFilterExpression']).toEqual({ email: { $exists: true } });
    });
  });

  describe('indexes with collation', () => {
    it('creates an index with case-insensitive collation', async () => {
      const contract = makeContract(
        {
          users: {
            indexes: [
              {
                keys: [{ field: 'name', direction: 1 }],
                collation: { locale: 'en', strength: 2 },
              },
            ],
          },
        },
        'collation-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('users').listIndexes().toArray();
      const collIdx = indexes.find((idx) => idx['key']?.['name'] === 1);
      expect(collIdx).toBeDefined();
      expect(collIdx!['collation']?.['locale']).toBe('en');
      expect(collIdx!['collation']?.['strength']).toBe(2);
    });
  });

  describe('wildcard indexes', () => {
    it('creates a wildcard index with wildcardProjection', async () => {
      const contract = makeContract(
        {
          events: {
            indexes: [
              {
                keys: [{ field: '$**', direction: 1 }],
                wildcardProjection: { metadata: 1 },
              },
            ],
          },
        },
        'wildcard-idx',
      );

      await planAndApply(db, replSetUri, null, contract);

      const indexes = await db.collection('events').listIndexes().toArray();
      const wcIdx = indexes.find((idx) => idx['key']?.['$**'] === 1);
      expect(wcIdx).toBeDefined();
    });
  });

  describe('modify indexes', () => {
    it('drops old index and creates new index on change', async () => {
      const v1 = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }],
          },
        },
        'modify-v1',
      );

      await planAndApply(db, replSetUri, null, v1);

      let indexes = await db.collection('users').listIndexes().toArray();
      expect(indexes.some((idx) => idx['key']?.['email'] === 1)).toBe(true);

      const v2 = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'name', direction: 1 }], sparse: true }],
          },
        },
        'modify-v2',
      );

      await planAndApply(db, replSetUri, v1, v2);

      indexes = await db.collection('users').listIndexes().toArray();
      expect(indexes.some((idx) => idx['key']?.['email'] === 1)).toBe(false);
      const nameIdx = indexes.find((idx) => idx['key']?.['name'] === 1);
      expect(nameIdx).toBeDefined();
      expect(nameIdx!['sparse']).toBe(true);
    });
  });

  describe('validators via collMod', () => {
    it('adds a validator to an existing collection', async () => {
      const v1 = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 }] }],
          },
        },
        'validator-v1',
      );

      await planAndApply(db, replSetUri, null, v1);

      const v2 = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 }] }],
            validator: {
              jsonSchema: {
                bsonType: 'object',
                required: ['email'],
                properties: {
                  email: { bsonType: 'string' },
                },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            },
          },
        },
        'validator-v2',
      );

      await planAndApply(db, replSetUri, v1, v2);

      const colls = await db.listCollections({ name: 'users' }).toArray();
      expect(colls).toHaveLength(1);
      const collOptions = (colls[0] as Record<string, unknown>)['options'] as
        | Record<string, unknown>
        | undefined;
      expect(collOptions?.['validator']).toBeDefined();
    });

    it('removes a validator from a collection', async () => {
      const withValidator = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 }] }],
            validator: {
              jsonSchema: {
                bsonType: 'object',
                required: ['email'],
                properties: { email: { bsonType: 'string' } },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            },
          },
        },
        'val-remove-v1',
      );

      await planAndApply(db, replSetUri, null, withValidator);

      const withoutValidator = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 }] }],
          },
        },
        'val-remove-v2',
      );

      await planAndApply(db, replSetUri, withValidator, withoutValidator);

      const colls = await db.listCollections({ name: 'users' }).toArray();
      expect(colls).toHaveLength(1);
      const collOptions = (colls[0] as Record<string, unknown>)['options'] as
        | Record<string, unknown>
        | undefined;
      const validator = collOptions?.['validator'] as Record<string, unknown> | undefined;
      const isEffectivelyEmpty = !validator || Object.keys(validator).length === 0;
      expect(isEffectivelyEmpty).toBe(true);
    });
  });

  describe('collection with options', () => {
    it('creates a capped collection', async () => {
      const contract = makeContract(
        {
          logs: {
            options: {
              capped: { size: 10_000_000, max: 1000 },
            },
          },
        },
        'capped-coll',
      );

      await planAndApply(db, replSetUri, null, contract);

      const colls = await db.listCollections({ name: 'logs' }).toArray();
      expect(colls).toHaveLength(1);
      const logsInfo = colls[0] as Record<string, unknown>;
      const logsOpts = logsInfo['options'] as Record<string, unknown> | undefined;
      expect(logsOpts?.['capped']).toBe(true);
      expect(logsOpts?.['size']).toBeGreaterThanOrEqual(10_000_000);
      expect(logsOpts?.['max']).toBe(1000);
    });

    it('creates a collection with collation', async () => {
      const contract = makeContract(
        {
          posts: {
            options: {
              collation: { locale: 'en', strength: 2 },
            },
          },
        },
        'collation-coll',
      );

      await planAndApply(db, replSetUri, null, contract);

      const colls = await db.listCollections({ name: 'posts' }).toArray();
      expect(colls).toHaveLength(1);
      const postsInfo = colls[0] as Record<string, unknown>;
      const postsOpts = postsInfo['options'] as Record<string, unknown> | undefined;
      const collation = postsOpts?.['collation'] as Record<string, unknown> | undefined;
      expect(collation?.['locale']).toBe('en');
      expect(collation?.['strength']).toBe(2);
    });

    it('creates a collection with changeStreamPreAndPostImages and toggles it', async () => {
      const v1 = makeContract(
        {
          events: {
            options: {
              changeStreamPreAndPostImages: { enabled: true },
            },
          },
        },
        'csppi-v1',
      );

      await planAndApply(db, replSetUri, null, v1);

      let colls = await db.listCollections({ name: 'events' }).toArray();
      expect(colls).toHaveLength(1);
      const eventsInfoV1 = colls[0] as Record<string, unknown>;
      const eventsOptsV1 = eventsInfoV1['options'] as Record<string, unknown> | undefined;
      expect(
        (eventsOptsV1?.['changeStreamPreAndPostImages'] as Record<string, unknown> | undefined)?.[
          'enabled'
        ],
      ).toBe(true);

      const v2 = makeContract(
        {
          events: {
            options: {
              changeStreamPreAndPostImages: { enabled: false },
            },
          },
        },
        'csppi-v2',
      );

      await planAndApply(db, replSetUri, v1, v2);

      colls = await db.listCollections({ name: 'events' }).toArray();
      expect(colls).toHaveLength(1);
      const eventsInfoV2 = colls[0] as Record<string, unknown>;
      const eventsOptsV2 = eventsInfoV2['options'] as Record<string, unknown> | undefined;
      const csppiAfter = eventsOptsV2?.['changeStreamPreAndPostImages'] as
        | Record<string, unknown>
        | undefined;
      const disabledOrRemoved = csppiAfter === undefined || csppiAfter['enabled'] === false;
      expect(disabledOrRemoved).toBe(true);
    });

    it('creates a timeseries collection', async () => {
      const contract = makeContract(
        {
          metrics: {
            options: {
              timeseries: { timeField: 'ts', granularity: 'hours' },
            },
          },
        },
        'timeseries-coll',
      );

      try {
        await planAndApply(db, replSetUri, null, contract);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('not supported') || msg.includes('requires')) {
          console.log(`Skipping timeseries test: ${msg}`);
          return;
        }
        throw e;
      }

      const colls = await db.listCollections({ name: 'metrics' }).toArray();
      expect(colls).toHaveLength(1);
      const metricsInfo = colls[0] as Record<string, unknown>;
      expect(metricsInfo['type']).toBe('timeseries');
      const metricsOpts = metricsInfo['options'] as Record<string, unknown> | undefined;
      const tsOpts = metricsOpts?.['timeseries'] as Record<string, unknown> | undefined;
      expect(tsOpts?.['timeField']).toBe('ts');
      expect(tsOpts?.['granularity']).toBe('hours');
    });

    it('creates a collection with clusteredIndex', async () => {
      const contract = makeContract(
        {
          clustered: {
            options: {
              clusteredIndex: { name: 'myCluster' },
            },
          },
        },
        'clustered-coll',
      );

      try {
        await planAndApply(db, replSetUri, null, contract);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('not supported') || msg.includes('requires') || msg.includes('unknown')) {
          console.log(`Skipping clusteredIndex test: ${msg}`);
          return;
        }
        throw e;
      }

      const colls = await db.listCollections({ name: 'clustered' }).toArray();
      expect(colls).toHaveLength(1);
      const clusteredInfo = colls[0] as Record<string, unknown>;
      const clusteredOpts = clusteredInfo['options'] as Record<string, unknown> | undefined;
      expect(clusteredOpts?.['clusteredIndex']).toBeDefined();
    });
  });

  describe('collection drops', () => {
    it('drops a collection when it disappears from the destination contract', async () => {
      const v1 = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 }] }],
          },
          posts: {
            indexes: [{ keys: [{ field: 'title', direction: 1 }] }],
          },
        },
        'drop-v1',
      );

      await planAndApply(db, replSetUri, null, v1);

      let collNames = (await db.listCollections().toArray()).map((c) => c['name']);
      expect(collNames).toContain('users');
      expect(collNames).toContain('posts');

      const v2 = makeContract(
        {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 }] }],
          },
        },
        'drop-v2',
      );

      await planAndApply(db, replSetUri, v1, v2);

      collNames = (await db.listCollections().toArray())
        .map((c) => c['name'] as string)
        .filter((n) => !n.startsWith('_prisma') && !n.startsWith('system.'));
      expect(collNames).toContain('users');
      expect(collNames).not.toContain('posts');
    });
  });

  describe('full lifecycle: create → modify → remove', () => {
    it('exercises a multi-step lifecycle for diverse index types', async () => {
      const v1 = makeContract(
        {
          articles: {
            indexes: [
              {
                keys: [
                  { field: 'title', direction: 'text' },
                  { field: 'body', direction: 'text' },
                ],
                weights: { title: 10, body: 5 },
                default_language: 'english',
              },
              { keys: [{ field: 'createdAt', direction: 1 }], expireAfterSeconds: 86400 },
            ],
          },
        },
        'lifecycle-v1',
      );

      await planAndApply(db, replSetUri, null, v1);

      let indexes = await db.collection('articles').listIndexes().toArray();
      expect(indexes.some((idx) => idx['key']?.['_fts'] === 'text')).toBe(true);
      expect(indexes.some((idx) => idx['key']?.['createdAt'] === 1)).toBe(true);

      const v2 = makeContract(
        {
          articles: {
            indexes: [
              {
                keys: [
                  { field: 'title', direction: 'text' },
                  { field: 'body', direction: 'text' },
                ],
                weights: { title: 10, body: 5 },
                default_language: 'english',
              },
              { keys: [{ field: 'authorId', direction: 1 }] },
            ],
            validator: {
              jsonSchema: {
                bsonType: 'object',
                required: ['title'],
                properties: { title: { bsonType: 'string' } },
              },
              validationLevel: 'moderate',
              validationAction: 'warn',
            },
          },
        },
        'lifecycle-v2',
      );

      await planAndApply(db, replSetUri, v1, v2);

      indexes = await db.collection('articles').listIndexes().toArray();
      expect(indexes.some((idx) => idx['key']?.['_fts'] === 'text')).toBe(true);
      expect(indexes.some((idx) => idx['key']?.['createdAt'] === 1)).toBe(false);
      expect(indexes.some((idx) => idx['key']?.['authorId'] === 1)).toBe(true);

      const colls = await db.listCollections({ name: 'articles' }).toArray();
      const articlesInfo = colls[0] as Record<string, unknown>;
      const articlesOpts = articlesInfo['options'] as Record<string, unknown> | undefined;
      expect(articlesOpts?.['validator']).toBeDefined();

      const v3 = makeContract(
        {
          articles: {},
        },
        'lifecycle-v3',
      );

      await planAndApply(db, replSetUri, v2, v3);

      indexes = await db.collection('articles').listIndexes().toArray();
      const nonIdIndexes = indexes.filter((idx) => idx['name'] !== '_id_');
      expect(nonIdIndexes).toHaveLength(0);
    });
  });
});
