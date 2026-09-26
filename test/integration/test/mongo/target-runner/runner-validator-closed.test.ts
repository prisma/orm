import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type { MigrationPlan } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import {
  MongoSchemaCollection,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_validator_closed_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
}, timeouts.spinUpMongoMemoryServer);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
}, timeouts.spinUpMongoMemoryServer);

beforeEach(async () => {
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.dropCollection(col['name'] as string);
  }
});

function makeContractWithValidator(
  collectionName: string,
  jsonSchema: Record<string, unknown>,
  storageHash: string,
): MongoContract {
  const collection = new MongoCollection({
    validator: {
      jsonSchema,
      validationLevel: 'strict',
      validationAction: 'error',
    },
  });
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: { [collectionName]: collection } },
        },
      },
    },
  } as unknown as MongoContract;
}

function serializePlan(plan: MigrationPlan): MigrationPlan {
  const serialized = JSON.parse(serializeMongoOps(plan.operations as AnyMongoMigrationOperation[]));
  return {
    targetId: plan.targetId,
    operations: serialized,
    origin: plan.origin ?? null,
    destination: plan.destination,
  };
}

function makeRunner() {
  return new MongoMigrationRunner(
    controlAdapter.createRunnerDependencies(new MongoControlDriver(db, client)),
  );
}

// These CLOSED_* schemas are hand-mirrored to exercise live-Mongo behaviour of
// closed validators; they are not asserted against emitter output here. The
// emitter shape itself (incl. closed polymorphic `oneOf` branches) is covered
// end-to-end in `mongo-runner.polymorphism.integration.test.ts`, which derives
// the validator from PSL via the interpreter.
//
// Mirrors the emitter's closed top-level collection schema: `_id` plus the
// declared fields, with `additionalProperties: false`.
const CLOSED_USERS = {
  bsonType: 'object',
  required: ['_id', 'email'],
  properties: {
    _id: { bsonType: 'objectId' },
    email: { bsonType: 'string' },
  },
  additionalProperties: false,
} as const;

// The same schema widened with one optional field — still closed.
const CLOSED_USERS_WIDENED = {
  bsonType: 'object',
  required: ['_id', 'email'],
  properties: {
    _id: { bsonType: 'objectId' },
    email: { bsonType: 'string' },
    avatarUrl: { bsonType: ['null', 'string'] },
  },
  additionalProperties: false,
} as const;

// Mirrors the emitter's closed polymorphic schema: an open top-level object
// (so variant-only fields are permitted) whose `oneOf` branches each repeat the
// base properties and close with `additionalProperties: false`.
const CLOSED_POSTS_POLYMORPHIC = {
  bsonType: 'object',
  required: ['_id', 'kind', 'title'],
  properties: {
    _id: { bsonType: 'objectId' },
    title: { bsonType: 'string' },
    kind: { bsonType: 'string' },
  },
  oneOf: [
    {
      properties: {
        _id: { bsonType: 'objectId' },
        title: { bsonType: 'string' },
        kind: { enum: ['article'] },
        summary: { bsonType: 'string' },
      },
      required: ['kind', 'summary'],
      additionalProperties: false,
    },
    {
      properties: {
        _id: { bsonType: 'objectId' },
        title: { bsonType: 'string' },
        kind: { enum: ['tutorial'] },
        wordCount: { bsonType: 'int' },
      },
      required: ['kind', 'wordCount'],
      additionalProperties: false,
    },
  ],
} as const;

describe('MongoMigrationRunner - closed validators', () => {
  it('rejects a document with an undeclared field under a closed top-level validator', async () => {
    await db.createCollection('users', {
      validator: { $jsonSchema: CLOSED_USERS },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    await db.collection('users').insertOne({ email: 'declared@example.com' });

    await expect(
      db.collection('users').insertOne({ email: 'junk@example.com', undeclared: 'nope' }),
    ).rejects.toThrow();
  });

  it('applies an additive optional field as a widening collMod (no destructive gate)', async () => {
    await db.createCollection('users', {
      validator: { $jsonSchema: CLOSED_USERS },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
      storageHash: 'origin',
      profileHash: 'p1',
    });

    const originIR = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'users',
        validator: new MongoSchemaValidator({
          jsonSchema: { ...CLOSED_USERS },
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      }),
    ]);

    const destContract = makeContractWithValidator('users', { ...CLOSED_USERS_WIDENED }, 'dest');

    // The widening-only policy omits 'destructive'; if the additive field were
    // misclassified the planner would reject the plan as a policy violation.
    const wideningPolicy = { allowedOperationClasses: ['additive', 'widening'] as const };

    const planner = new MongoMigrationPlanner();
    const planResult = planner.plan({
      contract: destContract,
      schema: originIR,
      policy: wideningPolicy,
      fromContract: null,
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') throw new Error('Planner failed');
    expect(planResult.plan.operations).toHaveLength(1);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serializePlan(planResult.plan),
      migrationEdges: [
        buildFabricatedMigrationEdge({
          currentMarkerStorageHash: planResult.plan.origin?.storageHash,
          destinationStorageHash: planResult.plan.destination.storageHash,
          operationCount: planResult.plan.operations.length,
        }),
      ],
      destinationContract: destContract,
      policy: wideningPolicy,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Runner failed: ${result.failure.code} — ${result.failure.summary}`);
    }
    expect(result.value.operationsExecuted).toBe(1);

    // The widened, still-closed validator accepts the new field but keeps
    // rejecting undeclared ones.
    await db
      .collection('users')
      .insertOne({ email: 'with-avatar@example.com', avatarUrl: 'https://x/y.png' });
    await expect(
      db.collection('users').insertOne({ email: 'junk@example.com', undeclared: 'nope' }),
    ).rejects.toThrow();

    const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
    expect(marker?.storageHash).toBe('dest');
  });

  it('validates a closed polymorphic (oneOf) collection against live MongoDB', async () => {
    await db.createCollection('posts', {
      validator: { $jsonSchema: CLOSED_POSTS_POLYMORPHIC },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    // Each variant's well-formed document is accepted.
    await db.collection('posts').insertOne({ title: 'A', kind: 'article', summary: 'tldr' });
    await db.collection('posts').insertOne({ title: 'B', kind: 'tutorial', wordCount: 1200 });

    // An undeclared field is rejected for every branch.
    await expect(
      db
        .collection('posts')
        .insertOne({ title: 'C', kind: 'article', summary: 'tldr', undeclared: 'x' }),
    ).rejects.toThrow();

    // A field that belongs to a different variant is rejected: the matching
    // branch closes it out and the other branch fails the discriminator.
    await expect(
      db
        .collection('posts')
        .insertOne({ title: 'D', kind: 'article', summary: 'tldr', wordCount: 5 }),
    ).rejects.toThrow();

    // A discriminator value with no matching branch is rejected.
    await expect(
      db.collection('posts').insertOne({ title: 'E', kind: 'unknown' }),
    ).rejects.toThrow();
  });
});
