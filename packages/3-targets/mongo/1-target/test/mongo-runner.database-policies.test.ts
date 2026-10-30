import type { ContractMarkerRecord } from '@internal/contract/types';
import type {
  MarkerOperations,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import type {
  DatabasePolicies,
  MigrationOperationPolicy,
  MigrationPlan,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
import type {
  AnyMongoInspectionCommand,
  AnyMongoMigrationOperation,
  MongoInspectionCommandVisitor,
} from '@internal/mongo-query-ast/control';
import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { createCollection } from '../src/core/migrations/migration-factories';
import { serializeMongoOps } from '../src/core/migrations/mongo-ops-serializer';
import { MongoMigrationRunner } from '../src/core/migrations/mongo-runner';

const ALL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const MIGRATE_ONLY: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-forbidden',
  },
};

const RECONCILE_ONLY: DatabasePolicies = {
  change: ['reconcile'],
  dataProtection: {
    dataLoss: 'data-loss-permitted',
    accessWidening: 'access-widening-permitted',
  },
};

const DEST = 'dest';

class StubInspectionExecutor
  implements MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>
{
  collections: Record<string, unknown>[] = [];

  async listIndexes(_command: AnyMongoInspectionCommand): Promise<Record<string, unknown>[]> {
    return [];
  }

  async listCollections(_command: AnyMongoInspectionCommand): Promise<Record<string, unknown>[]> {
    return this.collections;
  }
}

/** A marker store that writes what the runner asks for, the way the Mongo control adapter does. */
function markerAt(storageHash: string, meta: Record<string, unknown>): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: DEST,
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta,
    invariants: [],
  };
}

class MarkerStore {
  readonly ledger: string[] = [];

  constructor(public marker: ContractMarkerRecord | null = null) {}

  readonly ops: MarkerOperations = {
    readMarker: async () => this.marker,
    initMarker: async (_space, destination) => {
      this.marker = {
        storageHash: destination.storageHash,
        profileHash: destination.profileHash,
        contractJson: null,
        canonicalVersion: null,
        updatedAt: new Date(0),
        appTag: null,
        meta: destination.databasePolicies ? { policies: destination.databasePolicies } : {},
        invariants: [...(destination.invariants ?? [])],
      };
    },
    updateMarker: async (_space, expectedFrom, destination) => {
      if (this.marker?.storageHash !== expectedFrom) return false;
      this.marker = {
        ...this.marker,
        storageHash: destination.storageHash,
        profileHash: destination.profileHash,
        meta: destination.databasePolicies
          ? { ...this.marker.meta, policies: destination.databasePolicies }
          : this.marker.meta,
      };
      return true;
    },
    writeLedgerEntry: async (_space, entry) => {
      this.ledger.push(entry.migrationName);
    },
  };
}

function makeRunner(store: MarkerStore, inspection = new StubInspectionExecutor()) {
  const deps: MongoRunnerDependencies = {
    inspectionExecutor: inspection,
    adapter: {} as MongoAdapter,
    driver: {} as MongoDriver,
    executeDdl: async () => {},
    markerOps: store.ops,
    introspectSchema: async () => new MongoSchemaIR([]),
  };
  return new MongoMigrationRunner(deps);
}

function makeContract(): MongoContract {
  return {
    profileHash: DEST,
    storage: {
      storageHash: DEST,
      namespaces: {
        __unbound__: { id: '__unbound__', kind: 'mongo-namespace', entries: { collection: {} } },
      },
    },
  } as unknown as MongoContract;
}

function makePlan(
  ops: readonly AnyMongoMigrationOperation[],
  origin: string | null,
): MigrationPlan {
  return {
    targetId: 'mongo',
    origin: origin === null ? null : { storageHash: origin },
    destination: { storageHash: DEST },
    operations: JSON.parse(serializeMongoOps(ops)) as MigrationPlan['operations'],
  };
}

function edge(from: string, to: string, name: string): AggregateMigrationEdgeRef {
  return { migrationHash: name, dirName: name, from, to, operationCount: 1 };
}

function run(
  runner: MongoMigrationRunner,
  plan: MigrationPlan,
  migrationEdges: readonly AggregateMigrationEdgeRef[],
  databasePolicies?: DatabasePolicies,
) {
  return runner.execute({
    plan,
    migrationEdges,
    destinationContract: makeContract(),
    policy: ALL_POLICY,
    frameworkComponents: [],
    strictVerification: false,
    executionChecks: { prechecks: true, postchecks: false, idempotencyChecks: false },
    ...ifDefined('databasePolicies', databasePolicies),
  });
}

describe('MongoMigrationRunner database policies', () => {
  it('records the policies with the marker of a first run', async () => {
    const store = new MarkerStore();

    const result = await run(
      makeRunner(store),
      makePlan([createCollection('orders')], null),
      [edge(EMPTY_CONTRACT_HASH, DEST, '001_orders')],
      MIGRATE_ONLY,
    );

    result.assertOk();
    expect(store.marker?.meta).toEqual({ policies: MIGRATE_ONLY });
  });

  it('leaves the policies when a later run does not set them', async () => {
    const store = new MarkerStore(markerAt('mid', { policies: MIGRATE_ONLY }));

    const result = await run(makeRunner(store), makePlan([createCollection('items')], 'mid'), [
      edge('mid', DEST, '002_items'),
    ]);

    result.assertOk();
    expect({ storageHash: store.marker?.storageHash, meta: store.marker?.meta }).toEqual({
      storageHash: DEST,
      meta: { policies: MIGRATE_ONLY },
    });
  });

  it('writes the marker and no ledger entry for a run with no migrations', async () => {
    const store = new MarkerStore(markerAt(DEST, {}));

    const result = await run(makeRunner(store), makePlan([], DEST), [], MIGRATE_ONLY);

    result.assertOk();
    expect({ meta: store.marker?.meta, ledger: store.ledger }).toEqual({
      meta: { policies: MIGRATE_ONLY },
      ledger: [],
    });
  });

  it('leaves the policies unchanged when the second of two migrations fails', async () => {
    const store = new MarkerStore(markerAt('start', { policies: MIGRATE_ONLY }));
    const inspection = new StubInspectionExecutor();
    inspection.collections = [{ name: 'orders' }];

    const result = await run(
      makeRunner(store, inspection),
      makePlan([createCollection('items'), createCollection('orders')], 'start'),
      [edge('start', 'mid', '002_items'), edge('mid', DEST, '003_orders')],
      RECONCILE_ONLY,
    );

    expect(result.assertNotOk().code).toBe('MIGRATION.PRECHECK_FAILED');
    expect({ storageHash: store.marker?.storageHash, meta: store.marker?.meta }).toEqual({
      storageHash: 'start',
      meta: { policies: MIGRATE_ONLY },
    });
  });
});
