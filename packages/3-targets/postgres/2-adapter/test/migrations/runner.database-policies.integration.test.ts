import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
  type MigrationRunnerResult,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { ifDefined } from '@internal/utils/defined';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createLedgerTestPlan,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

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

describe('PostgresMigrationRunner database policies', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver.close();
  }, testTimeout);

  function run(
    perSpace: ReadonlyArray<{
      readonly plan: ReturnType<typeof createMigrationPlan<PostgresPlanTargetDetails>>;
      readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
      readonly databasePolicies?: DatabasePolicies;
    }>,
    options: {
      readonly expectedDatabasePolicies?: DatabasePolicies;
      readonly onOperationStart?: (operation: { readonly id: string }) => void;
    } = {},
  ): Promise<MigrationRunnerResult> {
    return postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: perSpace.map((entry) => ({
        space: entry.plan.spaceId,
        driver,
        destinationContract: contract,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
        ...ifDefined(
          'callbacks',
          options.onOperationStart === undefined
            ? undefined
            : { onOperationStart: options.onOperationStart },
        ),
        ...entry,
      })),
      ...ifDefined('expectedDatabasePolicies', options.expectedDatabasePolicies),
    });
  }

  async function applyContract(databasePolicies?: DatabasePolicies): Promise<void> {
    const planned = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error('expected planner success');
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: await Promise.all(planned.plan.operations),
      providedInvariants: [],
    });
    const result = await run([
      {
        plan,
        migrationEdges: synthEdges(plan),
        ...ifDefined('databasePolicies', databasePolicies),
      },
    ]);
    result.assertOk();
  }

  function selfEdgePlan(providedInvariants: readonly string[] = []) {
    return createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: toPlanContractInfo(contract),
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants,
    });
  }

  async function recordedPolicies(): Promise<unknown> {
    const result = await driver.query<{ policies: unknown }>('select policies from _prisma.config');
    return result.rows[0]?.policies;
  }

  async function signedAt(): Promise<string | undefined> {
    const result = await driver.query<{ signed_at: string }>(
      'select signed_at::text as signed_at from _prisma.signatures where space = $1',
      [APP_SPACE_ID],
    );
    return result.rows[0]?.signed_at;
  }

  async function ledgerLength(): Promise<number> {
    return (await familyInstance.readLedger({ driver, space: APP_SPACE_ID })).length;
  }

  it('records the policies in _prisma.config on a first run', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(MIGRATE_ONLY);

    expect(await recordedPolicies()).toEqual(MIGRATE_ONLY);
  });

  it('leaves the policies when a later run does not set them', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(MIGRATE_ONLY);

    const result = await run([{ plan: selfEdgePlan(['inv-a']), migrationEdges: [] }]);

    result.assertOk();
    const marker = await familyInstance.readMarker({ driver, space: APP_SPACE_ID });
    expect({ invariants: marker?.invariants, policies: await recordedPolicies() }).toEqual({
      invariants: ['inv-a'],
      policies: MIGRATE_ONLY,
    });
  });

  it('records the policies, and writes no signature and no ledger entry, for a run with no migrations', {
    timeout: testTimeout,
  }, async () => {
    await applyContract();
    const ledgerBefore = await ledgerLength();
    const signedBefore = await signedAt();

    const result = await run([
      { plan: selfEdgePlan(), migrationEdges: [], databasePolicies: MIGRATE_ONLY },
    ]);

    result.assertOk();
    expect({
      policies: await recordedPolicies(),
      ledger: await ledgerLength(),
      signedAt: await signedAt(),
    }).toEqual({ policies: MIGRATE_ONLY, ledger: ledgerBefore, signedAt: signedBefore });
  });

  it('leaves the policies unchanged when a later space of the same run fails', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(MIGRATE_ONLY);
    const failing = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: contract.storage.storageHash,
      migrationEdges: [],
      operations: [
        {
          id: 'table.never',
          label: 'Failing operation',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'never' },
          },
          precheck: [{ description: 'always false', sql: 'SELECT FALSE' }],
          execute: [],
          postcheck: [],
        },
      ],
    });

    const result = await run([
      { plan: selfEdgePlan(), migrationEdges: [], databasePolicies: RECONCILE_ONLY },
      { plan: failing, migrationEdges: synthEdges(failing) },
    ]);

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      meta: { failingSpace: LEDGER_TEST_SPACE_ID },
    });
    expect(await recordedPolicies()).toEqual(MIGRATE_ONLY);
  });
  it('records the policies and writes no ledger entry for a db update that changes nothing', {
    timeout: testTimeout,
  }, async () => {
    await applyContract();
    const ledgerBefore = await ledgerLength();
    const signedBefore = await signedAt();
    const inSync = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants: [],
    });

    const result = await run([
      { plan: inSync, migrationEdges: synthEdges(inSync), databasePolicies: MIGRATE_ONLY },
    ]);

    result.assertOk();
    expect({
      policies: await recordedPolicies(),
      ledger: await ledgerLength(),
      signedAt: await signedAt(),
    }).toEqual({ policies: MIGRATE_ONLY, ledger: ledgerBefore, signedAt: signedBefore });
  });

  it('fails as a concurrent change, before the first space runs an operation, when the policies moved after the caller checked them', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(MIGRATE_ONLY);
    const extension = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: contract.storage.storageHash,
      migrationEdges: [],
      operations: [
        {
          id: 'table.extension_table',
          label: 'Create the extension table',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'extension_table' },
          },
          precheck: [],
          execute: [{ description: 'create', sql: 'CREATE TABLE extension_table (id int)' }],
          postcheck: [],
        },
      ],
    });
    const started: string[] = [];

    const result = await run(
      [
        { plan: extension, migrationEdges: synthEdges(extension) },
        { plan: selfEdgePlan(['inv-a']), migrationEdges: [], databasePolicies: RECONCILE_ONLY },
      ],
      {
        expectedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
        onOperationStart: (operation) => started.push(operation.id),
      },
    );

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      why: "The database's policies changed after this run checked them: change moved from migrate, reconcile to migrate; dataProtection.dataLoss moved from data-loss-with-consent to data-loss-forbidden; dataProtection.accessWidening moved from access-widening-with-consent to access-widening-forbidden. Run the command again to check them anew. The failed apply changed nothing.",
      meta: {
        reason: 'databasePolicies',
        checkedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
        foundDatabasePolicies: MIGRATE_ONLY,
      },
    });
    const marker = await familyInstance.readMarker({ driver, space: APP_SPACE_ID });
    expect({
      started,
      invariants: marker?.invariants,
      policies: await recordedPolicies(),
    }).toEqual({ started: [], invariants: [], policies: MIGRATE_ONLY });
  });

  it('signs nothing when the policies in _prisma.config moved after the caller checked them, and goes ahead once they hold', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(MIGRATE_ONLY);
    const signedBefore = await signedAt();
    const sign = (checked: DatabasePolicies) =>
      familyInstance.signSpaces({
        driver,
        spaces: [
          {
            space: APP_SPACE_ID,
            contract,
            expected: {
              storageHash: contract.storage.storageHash,
              profileHash: contract.profileHash,
            },
          },
        ],
        expectedDatabasePolicies: checked,
      });

    const refused = await sign(DEFAULT_DATABASE_POLICIES);
    const signedAfterRefusal = await signedAt();
    const held = await sign(MIGRATE_ONLY);

    expect({
      refused,
      signedAfterRefusal,
      held: held.map((signature) => signature.status),
    }).toEqual({
      refused: [
        {
          space: APP_SPACE_ID,
          status: 'conflict',
          reason: 'databasePolicies',
          checked: DEFAULT_DATABASE_POLICIES,
          comparison: { kind: 'moved', found: MIGRATE_ONLY },
        },
      ],
      signedAfterRefusal: signedBefore,
      held: ['unchanged'],
    });
  });

  it('reports policies in _prisma.config it cannot read under the lock as corrupt, keeping them', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(MIGRATE_ONLY);
    await driver.query(`UPDATE _prisma.config SET policies = '"strict"'::jsonb`);

    await expect(
      run([{ plan: selfEdgePlan(), migrationEdges: [] }], {
        expectedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
      }),
    ).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'Ask whoever owns this database to correct meta.policies in the marker; do not delete the marker.',
        },
      ],
    });
  });
});
