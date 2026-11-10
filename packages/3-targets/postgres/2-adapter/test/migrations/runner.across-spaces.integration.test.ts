import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const extensionContract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('ext-test'),
  storage: new SqlStorage({
    storageHash: coreHash('ext-contract'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
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
  return createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
    spaceId: 'ext',
    origin: null,
    destination: toPlanContractInfo(extensionContract),
    operations: [
      {
        id: 'ext.create-helper',
        label: 'Create extension helper table',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: '_ext_helper' },
        },
        precheck: [],
        execute: [
          {
            description: 'create helper',
            sql: 'create table public._ext_helper (id integer primary key)',
          },
        ],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

function buildFailingAppPlan() {
  return createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
    spaceId: 'app',
    origin: null,
    destination: toPlanContractInfo(extensionContract),
    operations: [
      {
        id: 'app.fail',
        label: 'Always fails',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'doomed' },
        },
        precheck: [
          {
            description: 'always false',
            sql: 'select false',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

describe('PostgresMigrationRunner.execute', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('rolls back ALL spaces when one fails (locks AM4-rollback)', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: 'ext',
          plan: buildSuccessfulExtensionPlan(),
          migrationEdges: synthEdges(buildSuccessfulExtensionPlan()),
          driver: driver!,
          destinationContract: extensionContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
        {
          space: 'app',
          plan: buildFailingAppPlan(),
          migrationEdges: synthEdges(buildFailingAppPlan()),
          driver: driver!,
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
      code: result.failure.code,
      message: result.failure.message,
      failingSpace: result.failure.meta.failingSpace,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: expect.stringMatching(/failed during precheck/),
      failingSpace: 'app',
    });

    // The first (succeeding) space's writes must have rolled back —
    // the helper table should not exist.
    const helperExists = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public._ext_helper') is not null as exists`,
    );
    expect(helperExists.rows[0]?.exists).toBe(false);

    // No marker rows should exist for either space (the marker
    // table itself may not have been created since the whole
    // transaction rolled back).
    const markerSchemaExists = await driver!.query<{ exists: boolean }>(
      `select exists(select 1 from information_schema.schemata where schema_name = 'prisma_contract') as exists`,
    );
    if (markerSchemaExists.rows[0]?.exists) {
      const markers = await driver!.query<{ space: string }>(
        'select space from prisma_contract.marker',
      );
      expect(markers.rows).toEqual([]);
    }
  });

  it('commits per-space marker rows when all spaces succeed', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: 'ext',
          plan: buildSuccessfulExtensionPlan(),
          migrationEdges: synthEdges(buildSuccessfulExtensionPlan()),
          driver: driver!,
          destinationContract: extensionContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });

    expect(result.ok).toBe(true);

    const markerRow = await driver!.query<{ space: string; core_hash: string }>(
      'select space, core_hash from prisma_contract.marker order by space',
    );
    expect(markerRow.rows).toEqual([
      {
        space: 'ext',
        core_hash: extensionContract.storage.storageHash,
      },
    ]);

    const helperExists = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public._ext_helper') is not null as exists`,
    );
    expect(helperExists.rows[0]?.exists).toBe(true);
  });
});
