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
import { buildFabricatedMigrationEdges } from './fabricated-migration-edges';

const controlAdapter = new MongoControlAdapterImpl();

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

const EXT_SPACE = 'cipherstash';

type PerSpaceOptions = MigrationRunnerPerSpaceOptions<'mongo', 'mongo'> & {
  readonly strictVerification?: boolean;
};

function withSynthEdges(entry: Omit<PerSpaceOptions, 'migrationEdges'>): PerSpaceOptions {
  return { ...entry, migrationEdges: buildFabricatedMigrationEdges(entry.plan) };
}

function makeFamily(): ReturnType<typeof createMongoFamilyInstance> {
  return createMongoFamilyInstance(
    createControlStack({
      family: mongoFamilyDescriptor,
      target: mongoTargetDescriptor,
      adapter: mongoAdapterDescriptor,
    }),
  );
}

function makeRunner() {
  if (!hasMigrations(mongoTargetDescriptor)) throw new Error('expected migrations');
  return mongoTargetDescriptor.migrations.createRunner(makeFamily());
}

function buildAppContract(): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: { users: crossRef('User'), posts: crossRef('Post') },
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
        Post: {
          fields: {
            _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            slug: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
          },
          relations: {},
          storage: { collection: 'posts' },
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
              posts: {
                kind: 'mongo-collection' as const,
                indexes: [
                  {
                    kind: 'mongo-index' as const,
                    keys: [{ field: 'slug', direction: 1 as const }],
                    unique: true,
                  },
                ],
              },
            },
          },
        },
      },
      storageHash: coreHash('app-contract-multi-space'),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('app-profile'),
    meta: {},
  };
}

/**
 * Trimmed app contract claiming only `users` (no `posts`). Used to
 * manufacture a per-space verify violation: the runner applies a plan
 * generated against this trimmed contract, but the
 * `destinationContract` it verifies against is the full app contract
 * (which also claims `posts`). The post-apply live schema is missing
 * `posts`, so per-space verify fails.
 */
function buildAppContractMissingPosts(): MongoContract {
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
      storageHash: coreHash('app-contract-trimmed'),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('app-profile'),
    meta: {},
  };
}

function buildExtContract(): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    storage: {
      namespaces: {
        __unbound__: {
          id: '__unbound__' as const,
          kind: 'mongo-namespace' as const,
          entries: {
            collection: {
              cipherstash_state: {
                kind: 'mongo-collection' as const,
                indexes: [
                  {
                    kind: 'mongo-index' as const,
                    keys: [{ field: 'tenantId', direction: 1 as const }],
                    unique: true,
                  },
                ],
              },
            },
          },
        },
      },
      storageHash: coreHash('ext-contract-multi-space'),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('ext-profile'),
    meta: {},
  };
}

function planFor(contract: MongoContract, fromContract: MongoContract | null) {
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

describe('mongoTargetDescriptor.execute (across spaces)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'mongo_multi_space_runner_test';

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

  it('runs both spaces in caller order under strict per-space verify', async () => {
    // With per-space verify projection in place, strict-mode
    // verify (the default) succeeds across the aggregate even though
    // the live database holds collections owned by sibling spaces:
    // each space's verify only sees the slice its contract claims.
    const runner = makeRunner();
    const appContract = buildAppContract();
    const extContract = buildExtContract();
    const appOps = planFor(appContract, null);
    const extOps = planFor(extContract, null);

    const driver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const perSpaceOptions: readonly PerSpaceOptions[] = [
        withSynthEdges({
          space: EXT_SPACE,
          plan: {
            targetId: 'mongo',
            spaceId: EXT_SPACE,
            destination: { storageHash: extContract.storage.storageHash },
            operations: extOps,
          },
          driver,
          destinationContract: extContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
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
      ];

      const result = await runner.execute({ driver, perSpaceOptions });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.perSpaceResults.map((r) => r.space)).toEqual([EXT_SPACE, APP_SPACE_ID]);

      const markers = await controlAdapter.readAllMarkers(new MongoControlDriver(db, client));
      expect(markers.size).toBe(2);
      expect(markers.get(APP_SPACE_ID)?.storageHash).toBe(appContract.storage.storageHash);
      expect(markers.get(EXT_SPACE)?.storageHash).toBe(extContract.storage.storageHash);
    } finally {
      await driver.close();
    }
  });

  it('degenerate one-space invocation succeeds', async () => {
    const runner = makeRunner();
    const appContract = buildAppContract();
    const appOps = planFor(appContract, null);

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
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.perSpaceResults).toHaveLength(1);
      expect(result.value.perSpaceResults[0]?.space).toBe(APP_SPACE_ID);
    } finally {
      await driver.close();
    }
  });

  it('empty perSpaceOptions returns ok with no results', async () => {
    const runner = makeRunner();
    const driver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const result = await runner.execute({ driver, perSpaceOptions: [] });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.perSpaceResults).toEqual([]);
    } finally {
      await driver.close();
    }
  });

  it('mid-run failure surfaces failingSpace and leaves earlier markers advanced; resume re-applies the failed space and skips already-at-head spaces', async () => {
    // The contract under test: per-space verify projects the live
    // schema to the slice the destination contract claims, then verifies.
    // We manufacture a per-space contract violation by applying a plan
    // generated from a *trimmed* app contract (claims only `users`) but
    // verifying against the *full* app contract (claims `users` + `posts`).
    // The trimmed plan creates `users`; per-space verify against the full
    // contract finds `posts` missing → SCHEMA_VERIFY_FAILED.
    const runner = makeRunner();
    const appContractFull = buildAppContract();
    const appContractTrimmed = buildAppContractMissingPosts();
    const extContract = buildExtContract();
    const extOps = planFor(extContract, null);
    const appOpsTrimmed = planFor(appContractTrimmed, null);

    const driver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const failingPerSpaceOptions: readonly PerSpaceOptions[] = [
        withSynthEdges({
          space: EXT_SPACE,
          plan: {
            targetId: 'mongo',
            spaceId: EXT_SPACE,
            destination: { storageHash: extContract.storage.storageHash },
            operations: extOps,
          },
          driver,
          destinationContract: extContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
        withSynthEdges({
          space: APP_SPACE_ID,
          plan: {
            targetId: 'mongo',
            spaceId: APP_SPACE_ID,
            destination: { storageHash: appContractFull.storage.storageHash },
            operations: appOpsTrimmed,
          },
          driver,
          destinationContract: appContractFull,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
      ];

      const failingResult = await runner.execute({
        driver,
        perSpaceOptions: failingPerSpaceOptions,
      });

      expect(failingResult.ok).toBe(false);
      if (failingResult.ok) throw new Error('unreachable');
      expect(failingResult.failure.failingSpace).toBe(APP_SPACE_ID);
      expect(failingResult.failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');

      const extMarkerAfterFail = await controlAdapter.readMarker(
        new MongoControlDriver(db, client),
        EXT_SPACE,
      );
      expect(extMarkerAfterFail?.storageHash).toBe(extContract.storage.storageHash);
      const appMarkerAfterFail = await controlAdapter.readMarker(
        new MongoControlDriver(db, client),
        APP_SPACE_ID,
      );
      expect(appMarkerAfterFail).toBeNull();

      // Re-run with the corrected app plan (covers both
      // collections). ext is already at head — the runner's no-op
      // path skips it. App applies its full plan: `users` is
      // postcheck-idempotent-skipped, `posts` is created. Per-space
      // verify against the full contract passes; app marker advances.
      const appOpsFull = planFor(appContractFull, null);
      const resumePerSpaceOptions: readonly PerSpaceOptions[] = [
        withSynthEdges({
          space: EXT_SPACE,
          plan: {
            targetId: 'mongo',
            spaceId: EXT_SPACE,
            destination: { storageHash: extContract.storage.storageHash },
            operations: extOps,
          },
          driver,
          destinationContract: extContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
        withSynthEdges({
          space: APP_SPACE_ID,
          plan: {
            targetId: 'mongo',
            spaceId: APP_SPACE_ID,
            destination: { storageHash: appContractFull.storage.storageHash },
            operations: appOpsFull,
          },
          driver,
          destinationContract: appContractFull,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
      ];

      const resumeResult = await runner.execute({
        driver,
        perSpaceOptions: resumePerSpaceOptions,
      });

      expect(resumeResult.ok).toBe(true);
      if (!resumeResult.ok) throw new Error('unreachable');
      expect(resumeResult.value.perSpaceResults.map((r) => r.space)).toEqual([
        EXT_SPACE,
        APP_SPACE_ID,
      ]);

      const markers = await controlAdapter.readAllMarkers(new MongoControlDriver(db, client));
      expect(markers.size).toBe(2);
      expect(markers.get(APP_SPACE_ID)?.storageHash).toBe(appContractFull.storage.storageHash);
      expect(markers.get(EXT_SPACE)?.storageHash).toBe(extContract.storage.storageHash);
    } finally {
      await driver.close();
    }
  });
});
