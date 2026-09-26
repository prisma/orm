import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type { MigrationPlan } from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
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
const dbName = 'runner_validator_widen_test';

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

function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

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

const ORIGIN_SCHEMA = {
  bsonType: 'object',
  required: ['email'],
  properties: {
    email: { bsonType: 'string' },
  },
} as const;

const WIDENED_SCHEMA = {
  bsonType: 'object',
  required: ['email'],
  properties: {
    email: { bsonType: 'string' },
    avatarUrl: { bsonType: ['null', 'string'] },
  },
} as const;

describe('MongoMigrationRunner - validator widen', () => {
  it('executes validator-widen collMod and updates the live $jsonSchema', async () => {
    // Create the collection with the initial (narrower) validator.
    await db.createCollection('users', {
      validator: { $jsonSchema: ORIGIN_SCHEMA },
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
          jsonSchema: { ...ORIGIN_SCHEMA },
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      }),
    ]);

    const destContract = makeContractWithValidator('users', { ...WIDENED_SCHEMA }, 'dest');

    const planner = new MongoMigrationPlanner();
    const planResult = planner.plan({
      contract: destContract,
      schema: originIR,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') throw new Error('Planner failed');

    const serialized = serializePlan(planResult.plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(serialized),
      destinationContract: destContract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Runner failed: ${result.failure.code} — ${result.failure.summary}`);
    }

    // The collMod must have executed — not been skipped by the idempotency probe.
    expect(result.value.operationsExecuted).toBe(1);

    // The live validator must now include avatarUrl.
    const collections = await db.listCollections({ name: 'users' }, { nameOnly: false }).toArray();
    const liveValidator = collections[0]?.['options']?.['validator'] as
      | Record<string, unknown>
      | undefined;
    expect(liveValidator).toBeDefined();
    const liveSchema = liveValidator?.['$jsonSchema'] as Record<string, unknown> | undefined;
    expect(liveSchema).toBeDefined();
    const liveProperties = liveSchema?.['properties'] as Record<string, unknown> | undefined;
    expect(liveProperties).toBeDefined();
    expect(liveProperties).toHaveProperty('avatarUrl');

    // Marker must have advanced to the destination hash.
    const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
    expect(marker?.storageHash).toBe('dest');
  });

  it('emits no operations when origin and destination validators are identical', async () => {
    // Collection already has the widened schema — re-running should be skipped.
    await db.createCollection('users', {
      validator: { $jsonSchema: WIDENED_SCHEMA },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    const destContract = makeContractWithValidator('users', { ...WIDENED_SCHEMA }, 'dest');

    // Origin IR also matches the widened schema (simulating a retry / re-apply).
    const originIR = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'users',
        validator: new MongoSchemaValidator({
          jsonSchema: { ...WIDENED_SCHEMA },
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      }),
    ]);

    const planner = new MongoMigrationPlanner();
    const planResult = planner.plan({
      contract: destContract,
      schema: originIR,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') throw new Error('Planner failed');
    // Planner should emit no operations (validators are identical).
    expect(planResult.plan.operations).toHaveLength(0);
  });

  it('runner skips a validator collMod via the postcheck idempotency probe when the live schema already matches', async () => {
    // The live collection already carries the widened validator.
    await db.createCollection('users', {
      validator: { $jsonSchema: WIDENED_SCHEMA },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
      storageHash: 'origin',
      profileHash: 'p1',
    });

    // Build a plan that STILL contains the widening collMod by feeding the planner
    // a stale (narrower) origin IR — this simulates a re-apply where the planner's
    // origin assumption lags the live database. The op targets the same widened
    // schema the live collection already has, so the runner's postcheck idempotency
    // probe must skip it rather than re-executing.
    const staleOriginIR = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'users',
        validator: new MongoSchemaValidator({
          jsonSchema: { ...ORIGIN_SCHEMA },
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      }),
    ]);

    const destContract = makeContractWithValidator('users', { ...WIDENED_SCHEMA }, 'dest');

    const planner = new MongoMigrationPlanner();
    const planResult = planner.plan({
      contract: destContract,
      schema: staleOriginIR,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') throw new Error('Planner failed');

    // Sanity: the plan really does contain the validator collMod we want skipped.
    const collModOps = planResult.plan.operations.filter((op) => {
      const execute = (op as { execute?: { command: { kind: string } }[] }).execute;
      return execute?.[0]?.command.kind === 'collMod';
    });
    expect(collModOps).toHaveLength(1);

    const serialized = serializePlan(planResult.plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(serialized),
      destinationContract: destContract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Runner failed: ${result.failure.code} — ${result.failure.summary}`);
    }

    // The collMod was skipped by the postcheck idempotency probe (live === target).
    expect(result.value.operationsExecuted).toBe(0);

    // The apply still succeeds: live schema already satisfies the contract, so verify
    // passes and the marker advances to the destination hash.
    const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
    expect(marker?.storageHash).toBe('dest');
  });
});
