import mongoAdapterDescriptor, { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { coreHash, crossRef, profileHash } from '@internal/contract/types';
import mongoControlDriver, { MongoControlDriver } from '@internal/driver-mongo/control';
import { contractToMongoSchemaIR, createMongoFamilyInstance } from '@internal/family-mongo/control';
import {
  APP_SPACE_ID,
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

/**
 * Codec-rehydration guardrail.
 *
 * Plans an aggregate (app + cipherstash extension) whose contracts
 * reference codec IDs (`mongo/objectId@1`, `mongo/string@1`,
 * `cipherstash/cs_text@1`), serialises every op to disk shape via
 * `serializeMongoOps`, rehydrates by re-parsing JSON, and executes
 * the rehydrated plans against `mongodb-memory-server` through a
 * `MongoFamilyInstance` whose stack has **no codec runtime
 * instances loaded** (no `extensions`, no `controlStack`).
 *
 * Both markers advance because rehydrated ops carry every byte they
 * need to execute — JSON Schema fragments, index keys, collection
 * options — inline. Apply-time never consults a codec runtime.
 *
 * If a future change introduces a codec instance lookup at apply
 * time (e.g. re-deriving a validator from a registered codec or
 * looking up a codec instance by `codecId`), this test must turn
 * red — the lookup will return `undefined` (no codecs registered)
 * and the runner will throw or surface a missing-codec failure.
 *
 * The executable boundary that enforces "rehydrated ops carry no
 * codec dependency".
 */

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

const EXT_SPACE = 'cipherstash';

type PerSpaceOptions = MigrationRunnerPerSpaceOptions<'mongo', 'mongo'>;

function withSynthEdges(entry: Omit<PerSpaceOptions, 'migrationEdges'>): PerSpaceOptions {
  return { ...entry, migrationEdges: buildFabricatedMigrationEdges(entry.plan) };
}

function appContract(): MongoContract {
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
      storageHash: coreHash('tc18-app-contract'),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('tc18-app-profile'),
    meta: {},
  };
}

function extContract(): MongoContract {
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
      storageHash: coreHash('tc18-ext-contract'),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('tc18-ext-profile'),
    meta: {},
  };
}

/**
 * Plan a contract, then round-trip its operations through the
 * disk-shape JSON serializer. The runner deserialises again on
 * its way to apply; this is the rehydrated shape `migration apply`
 * sees after `loadContractSpaceAggregate` returns.
 */
function planAndRehydrate(contract: MongoContract): readonly MongoMigrationPlanOperation[] {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: contractToMongoSchemaIR(null),
    policy: ALL_POLICY,
    fromContract: null,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`Plan failed: ${JSON.stringify(result.conflicts ?? [])}`);
  }
  return JSON.parse(
    serializeMongoOps(result.plan.operations as readonly MongoMigrationPlanOperation[]),
  ) as readonly MongoMigrationPlanOperation[];
}

describe('codec-rehydration guardrail', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'mongo_codec_rehydration_guardrail_test';

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

  it('runs a rehydrated aggregate across spaces without consulting codec runtime instances', async () => {
    // Family stack carries NO codec runtime instances — the stack holds
    // only the control adapter the runner reaches the database through: no
    // `extensions`, no codec descriptors, nothing for the runner to
    // consult. If the runner ever needed to resolve a codec instance at
    // apply time, this call would surface a missing-codec failure (or throw).
    const family = createMongoFamilyInstance({
      adapter: mongoAdapterDescriptor,
    } as unknown as Parameters<typeof createMongoFamilyInstance>[0]);
    if (!hasMigrations(mongoTargetDescriptor)) throw new Error('expected migrations capability');
    const runner = mongoTargetDescriptor.migrations.createRunner(family);

    const app = appContract();
    const ext = extContract();
    const appOps = planAndRehydrate(app);
    const extOps = planAndRehydrate(ext);

    const driver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const perSpaceOptions: readonly PerSpaceOptions[] = [
        withSynthEdges({
          space: EXT_SPACE,
          plan: {
            targetId: 'mongo',
            spaceId: EXT_SPACE,
            destination: { storageHash: ext.storage.storageHash },
            operations: extOps,
          },
          driver,
          destinationContract: ext,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
        withSynthEdges({
          space: APP_SPACE_ID,
          plan: {
            targetId: 'mongo',
            spaceId: APP_SPACE_ID,
            destination: { storageHash: app.storage.storageHash },
            operations: appOps,
          },
          driver,
          destinationContract: app,
          policy: ALL_POLICY,
          frameworkComponents: [],
        }),
      ];

      const result = await runner.execute({ driver, perSpaceOptions });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');

      const markers = await controlAdapter.readAllMarkers(new MongoControlDriver(db, client));
      expect(markers.size).toBe(2);
      expect(markers.get(APP_SPACE_ID)?.storageHash).toBe(app.storage.storageHash);
      expect(markers.get(EXT_SPACE)?.storageHash).toBe(ext.storage.storageHash);
    } finally {
      await driver.close();
    }
  });
});
