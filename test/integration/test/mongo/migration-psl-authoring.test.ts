import { createMongoRunnerDeps, extractDb } from '@internal/adapter-mongo/control';
import type { JsonValue } from '@internal/contract/types';
import { MongoDriverImpl } from '@internal/driver-mongo';
import mongoControlDriver from '@internal/driver-mongo/control';
import { contractToMongoSchemaIR, createMongoFamilyInstance } from '@internal/family-mongo/control';
import type { CodecLookup } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { MongoContract } from '@internal/mongo-contract';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFabricatedMigrationEdges } from './fabricated-migration-edges';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function makeFamily(): ReturnType<typeof createMongoFamilyInstance> {
  // ControlStack arg is unused by the mongo factory; an empty object suffices for these integration tests.
  return createMongoFamilyInstance(
    {} as unknown as Parameters<typeof createMongoFamilyInstance>[0],
  );
}

const bsonTypesByCodecId: Record<string, string> = {
  'mongo/string@1': 'string',
  'mongo/int32@1': 'int',
  'mongo/bool@1': 'bool',
  'mongo/date@1': 'date',
  'mongo/objectId@1': 'objectId',
  'mongo/double@1': 'double',
};

const mongoCodecLookup: CodecLookup = {
  get(id: string) {
    const bsonType = bsonTypesByCodecId[id];
    if (!bsonType) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (v: unknown) => v,
      encodeJson: (v: unknown) => v as JsonValue,
      decodeJson: (v: JsonValue) => v,
    };
  },
  targetTypesFor(id: string) {
    const bsonType = bsonTypesByCodecId[id];
    return bsonType ? [bsonType] : undefined;
  },
  renderOutputTypeFor: () => undefined,
};

function pslToContract(schema: string): MongoContract {
  const scalarTypeCodecIds = new Map([
    ['String', 'mongo/string@1'],
    ['Int', 'mongo/int32@1'],
    ['Boolean', 'mongo/bool@1'],
    ['DateTime', 'mongo/date@1'],
    ['ObjectId', 'mongo/objectId@1'],
    ['Float', 'mongo/double@1'],
  ]);
  const { document, sourceFile } = parse(schema);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: {},
  });
  const result = interpretPslDocumentToMongoContract({
    symbolTable,
    sourceFile,
    sourceId: 'test.prisma',
    scalarTypeCodecIds,
    codecLookup: mongoCodecLookup,
  });
  if (!result.ok) {
    throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  }
  return result.value as MongoContract;
}

async function planAndApply(
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
      createMongoRunnerDeps(
        controlDriver,
        MongoDriverImpl.fromDb(extractDb(controlDriver)),
        makeFamily(),
      ),
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

describe('PSL authoring → migration E2E', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'psl_authoring_e2e_test';
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

  it('PSL with @@index produces indexes on MongoDB', async () => {
    const contract = pslToContract(`
      model User {
        id    ObjectId @id @map("_id")
        email String
        name  String
        @@index([email])
        @@unique([name])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('user').listIndexes().toArray();
    const emailIdx = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIdx).toBeDefined();

    const nameIdx = indexes.find((idx) => idx['key']?.['name'] === 1);
    expect(nameIdx).toBeDefined();
    expect(nameIdx!['unique']).toBe(true);
  });

  it('PSL with @unique on field produces single-field unique index', async () => {
    const contract = pslToContract(`
      model User {
        id    ObjectId @id @map("_id")
        email String   @unique
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('user').listIndexes().toArray();
    const emailIdx = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIdx).toBeDefined();
    expect(emailIdx!['unique']).toBe(true);
  });

  it('PSL with model fields produces $jsonSchema validator on MongoDB', async () => {
    const contract = pslToContract(`
      model User {
        id    ObjectId @id @map("_id")
        name  String
        age   Int
        bio   String?
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const colls = await db.listCollections({ name: 'user' }).toArray();
    expect(colls).toHaveLength(1);
    const options = (colls[0] as Record<string, unknown>)['options'] as
      | Record<string, unknown>
      | undefined;
    expect(options?.['validator']).toBeDefined();
    const validator = options!['validator'] as Record<string, unknown>;
    const schema = validator['$jsonSchema'] as Record<string, unknown>;
    expect(schema['bsonType']).toBe('object');

    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['name']?.['bsonType']).toBe('string');
    expect(props['age']?.['bsonType']).toBe('int');
    expect(props['bio']?.['bsonType']).toEqual(['null', 'string']);
  });

  it('PSL with @@index + model fields produces both indexes and validator', async () => {
    const contract = pslToContract(`
      model Post {
        id        ObjectId @id @map("_id")
        title     String
        createdAt DateTime
        @@index([createdAt])
      }
    `);

    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    const postColl = ns ? ns.entries.collection?.['post'] : undefined;
    expect(postColl?.indexes).toBeDefined();
    expect(postColl?.validator).toBeDefined();

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('post').listIndexes().toArray();
    const createdAtIdx = indexes.find((idx) => idx['key']?.['createdAt'] === 1);
    expect(createdAtIdx).toBeDefined();

    const colls = await db.listCollections({ name: 'post' }).toArray();
    const options = (colls[0] as Record<string, unknown>)['options'] as
      | Record<string, unknown>
      | undefined;
    expect(options?.['validator']).toBeDefined();
  });

  it('PSL with @map respects mapped names in indexes and validators', async () => {
    const contract = pslToContract(`
      model User {
        id        ObjectId @id @map("_id")
        firstName String   @map("first_name")
        @@index([firstName])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('user').listIndexes().toArray();
    const idx = indexes.find((i) => i['key']?.['first_name'] === 1);
    expect(idx).toBeDefined();

    const colls = await db.listCollections({ name: 'user' }).toArray();
    const mapUserInfo = colls[0] as Record<string, unknown>;
    const mapUserOpts = mapUserInfo['options'] as Record<string, unknown> | undefined;
    const validator = mapUserOpts?.['validator'] as Record<string, unknown> | undefined;
    const schema = validator!['$jsonSchema'] as Record<string, unknown>;
    const props = schema['properties'] as Record<string, unknown>;
    expect(props['first_name']).toBeDefined();
    expect(props['firstName']).toBeUndefined();
  });

  it('PSL with wildcard() produces wildcard index on MongoDB', async () => {
    const contract = pslToContract(`
      model Events {
        id       ObjectId @id @map("_id")
        metadata String
        @@index([wildcard()])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('events').listIndexes().toArray();
    const wildcardIdx = indexes.find((idx) => idx['key']?.['$**'] === 1);
    expect(wildcardIdx).toBeDefined();
  });

  it('PSL with scoped wildcard() produces scoped wildcard index', async () => {
    const contract = pslToContract(`
      model Events {
        id       ObjectId @id @map("_id")
        metadata String
        @@index([wildcard(metadata)])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('events').listIndexes().toArray();
    const wildcardIdx = indexes.find((idx) => idx['key']?.['metadata.$**'] === 1);
    expect(wildcardIdx).toBeDefined();
  });

  it('PSL with sort: Desc produces mixed-direction compound index', async () => {
    const contract = pslToContract(`
      model Events {
        id        ObjectId @id @map("_id")
        status    String
        createdAt DateTime
        @@index([status, createdAt(sort: Desc)])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('events').listIndexes().toArray();
    const compoundIdx = indexes.find(
      (idx) => idx['key']?.['status'] === 1 && idx['key']?.['createdAt'] === -1,
    );
    expect(compoundIdx).toBeDefined();
  });

  it('PSL with filter produces partial filter expression index', async () => {
    const contract = pslToContract(`
      model Events {
        id     ObjectId @id @map("_id")
        status String
        @@index([status], filter: "{\\"status\\": \\"active\\"}")
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('events').listIndexes().toArray();
    const partialIdx = indexes.find(
      (idx) => idx['key']?.['status'] === 1 && idx['partialFilterExpression'],
    );
    expect(partialIdx).toBeDefined();
    expect(partialIdx!['partialFilterExpression']).toEqual({ status: 'active' });
  });

  it('PSL with collation produces collated index', async () => {
    const contract = pslToContract(`
      model User {
        id    ObjectId @id @map("_id")
        email String
        @@index([email], collationLocale: "en", collationStrength: 2)
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('user').listIndexes().toArray();
    const collatedIdx = indexes.find((idx) => idx['key']?.['email'] === 1 && idx['collation']);
    expect(collatedIdx).toBeDefined();
    expect(collatedIdx!['collation']?.['locale']).toBe('en');
    expect(collatedIdx!['collation']?.['strength']).toBe(2);
  });

  it('PSL with wildcard + include produces wildcardProjection', async () => {
    const contract = pslToContract(`
      model Events {
        id       ObjectId @id @map("_id")
        metadata String
        tags     String
        @@index([wildcard()], include: ["metadata", "tags"])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('events').listIndexes().toArray();
    const wcIdx = indexes.find((idx) => idx['key']?.['$**'] === 1);
    expect(wcIdx).toBeDefined();
    expect(wcIdx!['wildcardProjection']).toEqual({ metadata: 1, tags: 1 });
  });

  it('PSL with wildcard + exclude produces wildcardProjection', async () => {
    const contract = pslToContract(`
      model Events {
        id       ObjectId @id @map("_id")
        internal String
        @@index([wildcard()], exclude: ["internal"])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('events').listIndexes().toArray();
    const wcIdx = indexes.find((idx) => idx['key']?.['$**'] === 1);
    expect(wcIdx).toBeDefined();
    expect(wcIdx!['wildcardProjection']).toEqual({ internal: 0 });
  });

  it('PSL with @@textIndex produces text index on MongoDB', async () => {
    const contract = pslToContract(`
      model Article {
        id    ObjectId @id @map("_id")
        title String
        body  String
        @@textIndex([title, body])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('article').listIndexes().toArray();
    const textIdx = indexes.find((idx) => idx['key']?.['_fts'] === 'text');
    expect(textIdx).toBeDefined();
    expect(textIdx!['weights']?.['title']).toBeDefined();
    expect(textIdx!['weights']?.['body']).toBeDefined();
  });

  it('PSL with @@textIndex + weights produces weighted text index', async () => {
    const contract = pslToContract(`
      model Article {
        id    ObjectId @id @map("_id")
        title String
        body  String
        @@textIndex([title, body], weights: { title: 10, body: 5 }, language: "english")
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('article').listIndexes().toArray();
    const textIdx = indexes.find((idx) => idx['key']?.['_fts'] === 'text');
    expect(textIdx).toBeDefined();
    expect(textIdx!['weights']?.['title']).toBe(10);
    expect(textIdx!['weights']?.['body']).toBe(5);
    expect(textIdx!['default_language']).toBe('english');
  });

  it('PSL with type: "hashed" produces hashed index', async () => {
    const contract = pslToContract(`
      model Events {
        id       ObjectId @id @map("_id")
        tenantId String
        @@index([tenantId], type: "hashed")
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('events').listIndexes().toArray();
    const hashedIdx = indexes.find((idx) => idx['key']?.['tenantId'] === 'hashed');
    expect(hashedIdx).toBeDefined();
  });

  it('PSL with type: "2dsphere" produces 2dsphere index', async () => {
    const contract = pslToContract(`
      model Places {
        id       ObjectId @id @map("_id")
        location String
        @@index([location], type: "2dsphere")
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('places').listIndexes().toArray();
    const geoIdx = indexes.find((idx) => idx['key']?.['location'] === '2dsphere');
    expect(geoIdx).toBeDefined();
  });

  it('PSL with value objects produces nested $jsonSchema', async () => {
    const contract = pslToContract(`
      type Address {
        street String
        city   String
      }

      model User {
        id      ObjectId @id @map("_id")
        address Address
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const colls = await db.listCollections({ name: 'user' }).toArray();
    const voUserInfo = colls[0] as Record<string, unknown>;
    const voUserOpts = voUserInfo['options'] as Record<string, unknown> | undefined;
    const validator = voUserOpts?.['validator'] as Record<string, unknown> | undefined;
    const schema = validator!['$jsonSchema'] as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['address']?.['bsonType']).toBe('object');
    const addressProps = props['address']?.['properties'] as Record<string, unknown>;
    expect(addressProps['street']).toBeDefined();
    expect(addressProps['city']).toBeDefined();
  });
});
