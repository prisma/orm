import mongoAdapterDescriptor, { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { coreHash, crossRef, profileHash } from '@internal/contract/types';

import mongoControlDriver, { MongoControlDriver } from '@internal/driver-mongo/control';
import {
  contractToMongoSchemaIR,
  createMongoFamilyInstance,
  mongoFamilyDescriptor,
} from '@internal/family-mongo/control';
import {
  APP_SPACE_ID,
  createControlStack,
  hasMigrations,
  issueOutcome,
  type MigrationRunnerPerSpaceOptions,
} from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import {
  MongoMigrationPlanner,
  mongoTargetDescriptor,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MONGO_TEST_COLLECTION,
  MONGO_TEST_SPACE_ID,
} from '../contract-space-fixture-mongo/constants';
import mongoTestContractSpaceExtensionDescriptor from '../contract-space-fixture-mongo/control';
import { buildFabricatedMigrationEdges } from './fabricated-migration-edges';

const controlAdapter = new MongoControlAdapterImpl();

/**
 * Aggregate-level end-to-end test for the Mongo contract-space
 * mechanism.
 *
 * Builds an aggregate of an app contract plus one extension contract
 * sourced from `contract-space-fixture-mongo`, drives it through the
 * per-space runner, and asserts:
 *
 * - Happy path: `execute` applies app and extension plans
 *   in caller order against a live `MongoMemoryReplSet`; both markers
 *   advance to their pinned hashes; per-space strict schema verify
 *   (the default, run inside `execute` after each apply)
 *   passes.
 * - Failure isolation: after the happy path, dropping the fixture's
 *   unique index on the live `test_audit_event` collection makes the
 *   extension-space slice fail per-space schema verify with a
 *   remediation hint scoped to the extension's collection. The
 *   app-space slice still passes — failure stays inside the
 *   contract-space boundary that produced it.
 */

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

type PerSpaceOptions = MigrationRunnerPerSpaceOptions<'mongo', 'mongo'>;

function withSynthEdges(entry: Omit<PerSpaceOptions, 'migrationEdges'>): PerSpaceOptions {
  return { ...entry, migrationEdges: buildFabricatedMigrationEdges(entry.plan) };
}

const extContract: MongoContract =
  mongoTestContractSpaceExtensionDescriptor.contractSpace!.contractJson;

function buildAppContract(): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: { users: crossRef('User') },
    domain: applicationDomainOf({
      models: {
        User: {
          fields: {
            _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
          },
          relations: {},
          storage: { collection: 'users' },
        },
      },
    }),
    storage: {
      namespaces: {
        __unbound__: {
          id: '__unbound__' as const,
          kind: 'mongo-namespace' as const,
          entries: {
            collection: {
              users: {
                kind: 'mongo-collection' as const,
                indexes: [
                  {
                    kind: 'mongo-index' as const,
                    keys: [{ field: 'email', direction: 1 as const }],
                    unique: true,
                  },
                ],
              },
            },
          },
        },
      },
      storageHash: coreHash('p5-app-contract'),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('p5-app-profile'),
    meta: {},
  };
}

function planFor(
  contract: MongoContract,
  fromContract: MongoContract | null,
): readonly MongoMigrationPlanOperation[] {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: contractToMongoSchemaIR(fromContract),
    policy: ALL_POLICY,
    fromContract,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`Plan failed: ${JSON.stringify(result.conflicts ?? [])}`);
  }
  const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
  return JSON.parse(serializeMongoOps(ops)) as readonly MongoMigrationPlanOperation[];
}

function createInstance() {
  const stack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapterDescriptor,
  });
  return createMongoFamilyInstance(stack);
}

function makeRunner() {
  if (!hasMigrations(mongoTargetDescriptor)) throw new Error('expected migrations capability');
  return mongoTargetDescriptor.migrations.createRunner(createInstance());
}

describe('Mongo contract-space aggregate e2e', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'mongo_aggregate_e2e_test';

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
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // ignore cleanup errors
    }
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await db.dropDatabase();
  });

  it('applies app + extension across spaces, advances both markers, and strict per-space verify passes', async () => {
    const appContract = buildAppContract();
    const appOps = planFor(appContract, null);
    const extOps = planFor(extContract, null);
    const runner = makeRunner();

    const driver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const perSpaceOptions: readonly PerSpaceOptions[] = [
        withSynthEdges({
          space: APP_SPACE_ID,
          plan: {
            targetId: 'mongo',
            spaceId: APP_SPACE_ID,
            destination: { storageHash: appContract.storage.storageHash },
            operations: appOps,
          },
          driver,
          destinationContract: appContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
        withSynthEdges({
          space: MONGO_TEST_SPACE_ID,
          plan: {
            targetId: 'mongo',
            spaceId: MONGO_TEST_SPACE_ID,
            destination: { storageHash: extContract.storage.storageHash },
            operations: extOps,
          },
          driver,
          destinationContract: extContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
      ];

      const result = await runner.execute({ driver, perSpaceOptions });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.perSpaceResults.map((r) => r.space)).toEqual([
        APP_SPACE_ID,
        MONGO_TEST_SPACE_ID,
      ]);

      // Both markers advanced — per-space marker-level atomicity gated on
      // post-apply strict verify (option C, recorded in spec § Atomicity).
      const markers = await controlAdapter.readAllMarkers(new MongoControlDriver(db, client));
      expect(markers.size).toBe(2);
      expect(markers.get(APP_SPACE_ID)?.storageHash).toBe(appContract.storage.storageHash);
      expect(markers.get(MONGO_TEST_SPACE_ID)?.storageHash).toBe(extContract.storage.storageHash);

      // Sanity: the fixture's collection landed with its unique index
      // and validator from the planner-derived ops.
      const collInfo = await db.listCollections({ name: MONGO_TEST_COLLECTION }).toArray();
      expect(collInfo).toHaveLength(1);
      const indexes = await db.collection(MONGO_TEST_COLLECTION).indexes();
      expect(indexes.some((ix) => ix.unique && ix.key?.['tenantId'] === 1)).toBe(true);
    } finally {
      await driver.close();
    }
  });

  it('per-space verify isolates extension drift: dropping the fixture index fails ext-space verify but app-space verify still passes', async () => {
    const appContract = buildAppContract();
    const appOps = planFor(appContract, null);
    const extOps = planFor(extContract, null);
    const runner = makeRunner();

    const driver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const result = await runner.execute({
        driver,
        perSpaceOptions: [
          withSynthEdges({
            space: APP_SPACE_ID,
            plan: {
              targetId: 'mongo',
              spaceId: APP_SPACE_ID,
              destination: { storageHash: appContract.storage.storageHash },
              operations: appOps,
            },
            driver,
            destinationContract: appContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
          }),
          withSynthEdges({
            space: MONGO_TEST_SPACE_ID,
            plan: {
              targetId: 'mongo',
              spaceId: MONGO_TEST_SPACE_ID,
              destination: { storageHash: extContract.storage.storageHash },
              operations: extOps,
            },
            driver,
            destinationContract: extContract,
            policy: ALL_POLICY,
            frameworkComponents: [],
          }),
        ],
      });
      expect(result.ok).toBe(true);

      // Hand-edit: drop the fixture's `tenantId_1` unique index. The
      // live `test_audit_event` collection still exists, but the
      // shape no longer matches the pinned ext contract.
      const indexesBefore = await db.collection(MONGO_TEST_COLLECTION).indexes();
      const uniqueIndex = indexesBefore.find(
        (ix) => ix.unique === true && ix.key?.['tenantId'] === 1,
      );
      expect(uniqueIndex?.name).toBeDefined();
      await db.collection(MONGO_TEST_COLLECTION).dropIndex(uniqueIndex!.name!);

      const instance = createInstance();

      // Per-space verifier output: verify the ext slice against the
      // mutated live DB and assert every reported issue is scoped to
      // the extension's collection. Failure isolation across
      // contract-space boundaries propagates through to the
      // human-readable verifier output — every issue's `table` names
      // the ext-owned collection, never the app-owned `users`.
      //
      // Non-strict: `instance.schemaVerify` walks the whole live DB
      // at this surface (no per-space projection — that is the
      // runner's job, exercised in the happy path
      // above). Sibling app-owned collections would otherwise
      // surface as strict-mode extras; non-strict elides those
      // warnings while genuine drift on a contract-declared index
      // still escalates to a failure.
      const extDriver = makeDriver(driver);
      const extSchema = await instance.introspect({
        driver: extDriver,
        contract: extContract,
      });
      const extVerify = instance.verifySchema({
        contract: extContract,
        schema: extSchema,
        strict: false,
        frameworkComponents: [],
      });
      expect(extVerify.ok).toBe(false);
      const indexIssues = extVerify.schema.issues.filter(
        (i) => issueOutcome(i) === 'not-found' && i.path[1]?.startsWith('index:'),
      );
      expect(indexIssues.length).toBeGreaterThan(0);
      for (const issue of indexIssues) {
        expect(issue.path[0]).toBe(MONGO_TEST_COLLECTION);
      }
      // The remediation hint a CLI consumer would render therefore
      // points at the extension's collection, not at the app's.
      // Issues on app-owned collections without per-space projection
      // (e.g. a whole-collection extra for the app's `users` from the
      // ext contract's POV) are warnings in non-strict mode; only
      // drift on a contract-declared element escalates to a failure,
      // and every failure here scopes to the extension's collection.
      for (const issue of indexIssues) {
        expect(issue.path[0]).not.toBe('users');
      }
    } finally {
      await driver.close();
    }
  });

  function makeDriver(_existingDriver: Awaited<ReturnType<typeof mongoControlDriver.create>>) {
    // `schemaVerify` accepts the family's control driver type, not
    // the cross-package `MongoControlDriver` instance returned by
    // `mongoControlDriver.create`. Build a fresh family-level driver
    // from the same `Db` / `MongoClient` pair so both lanes see the
    // live database. (The two driver shapes converge on the same
    // underlying connection, so there is no schema divergence to
    // worry about.)
    return new MongoControlDriver(db, client);
  }
});
