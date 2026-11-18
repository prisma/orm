import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract as appContract,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const extensionContract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('ext-test'),
  storage: new SqlStorage({
    storageHash: coreHash('ext-contract'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: {} },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {},
  extensions: {},
  meta: {},
};

function buildSuccessfulExtensionPlan() {
  return createMigrationPlan<SqlitePlanTargetDetails>({
    targetId: 'sqlite',
    spaceId: 'ext',
    origin: null,
    destination: toPlanContractInfo(extensionContract),
    operations: [
      {
        id: 'ext.create-helper',
        label: 'Create extension helper table',
        operationClass: 'additive',
        target: {
          id: 'sqlite',
          details: { objectType: 'table', name: '_ext_helper' },
        },
        precheck: [],
        execute: [
          {
            description: 'create helper',
            sql: 'CREATE TABLE _ext_helper (id INTEGER PRIMARY KEY)',
          },
        ],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

function buildFailingExtensionPlan() {
  return createMigrationPlan<SqlitePlanTargetDetails>({
    targetId: 'sqlite',
    spaceId: 'app',
    origin: null,
    destination: toPlanContractInfo(extensionContract),
    operations: [
      {
        id: 'ext.create-helper',
        label: 'Create extension helper table',
        operationClass: 'additive',
        target: {
          id: 'sqlite',
          details: { objectType: 'table', name: '_ext_helper' },
        },
        // Idempotency check passes (postcheck reports the table exists),
        // so we have to fail at execute time. Use SQL that always raises
        // a runtime error.
        precheck: [],
        execute: [
          {
            description: 'always fails',
            sql: "SELECT raise(ABORT, 'forced failure')",
          },
        ],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

function buildAppPlan() {
  return createMigrationPlan<SqlitePlanTargetDetails>({
    targetId: 'sqlite',
    spaceId: 'app',
    origin: null,
    destination: toPlanContractInfo(appContract),
    operations: [
      {
        id: 'table.user',
        label: 'Create user table',
        operationClass: 'additive',
        target: {
          id: 'sqlite',
          details: { objectType: 'table', name: 'user' },
        },
        precheck: [],
        execute: [
          {
            description: 'create user',
            sql: 'CREATE TABLE user (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE)',
          },
          {
            description: 'create email index',
            sql: 'CREATE INDEX user_email_idx ON user (email)',
          },
        ],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

describe('SqliteMigrationRunner.execute', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('applies plans for multiple spaces inside one transaction and writes per-space markers', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: 'ext',
          plan: buildSuccessfulExtensionPlan(),
          migrationEdges: synthEdges(buildSuccessfulExtensionPlan()),
          driver,
          destinationContract: extensionContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
        {
          space: 'app',
          plan: buildAppPlan(),
          migrationEdges: synthEdges(buildAppPlan()),
          driver,
          destinationContract: appContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });

    if (!result.ok) {
      throw new Error(formatRunnerFailure(result.failure));
    }

    const markers = await driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );
    expect(markers.rows.map((r) => r.space)).toEqual(['app', 'ext']);
    expect(markers.rows.find((r) => r.space === 'app')!.core_hash).toBe(
      appContract.storage.storageHash,
    );
    expect(markers.rows.find((r) => r.space === 'ext')!.core_hash).toBe(
      extensionContract.storage.storageHash,
    );

    const userTable = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'user'",
    );
    expect(userTable.rows[0]!.cnt).toBe(1);

    const helperTable = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_ext_helper'",
    );
    expect(helperTable.rows[0]!.cnt).toBe(1);
  });

  it('rolls back ALL spaces when any one fails (locks AM4-rollback)', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          // Extension space succeeds first.
          space: 'ext',
          plan: buildSuccessfulExtensionPlan(),
          migrationEdges: synthEdges(buildSuccessfulExtensionPlan()),
          driver,
          destinationContract: extensionContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
        {
          // App space fails — its raise(ABORT) aborts the outer tx.
          space: 'app',
          plan: buildFailingExtensionPlan(),
          migrationEdges: synthEdges(buildFailingExtensionPlan()),
          driver,
          destinationContract: extensionContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect({
      message: result.failure.message,
      failingSpace: result.failure.meta.failingSpace,
    }).toEqual({
      message: 'Operation ext.create-helper failed during execution: always fails',
      failingSpace: 'app',
    });

    // The first space's helper table must NOT exist (transaction
    // rolled back).
    const helperTable = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_ext_helper'",
    );
    expect(helperTable.rows[0]!.cnt).toBe(0);

    // No marker rows should exist (the marker table itself may have
    // been created if it survived the rollback through SQLite's
    // BEGIN EXCLUSIVE — but typically also rolls back; either way no
    // rows are expected).
    const markerExists = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_prisma_marker'",
    );
    if (markerExists.rows[0]!.cnt > 0) {
      const markerCount = await driver.query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM _prisma_marker',
      );
      expect(markerCount.rows[0]!.cnt).toBe(0);
    }
  });

  it('returns ok with empty results for an empty perSpaceOptions list', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const result = await runner.execute({
      driver,
      perSpaceOptions: [],
    });

    if (!result.ok) {
      throw new Error(formatRunnerFailure(result.failure));
    }
    expect(result.value.perSpaceResults).toEqual([]);
  });
});
