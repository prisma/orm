import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootstrapSqliteControlTables,
  contract,
  createFailingPlan,
  createMigrationPlan,
  createTestDatabase,
  expectNoMarkerOrLedgerWrites,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner - Error Scenarios', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('fails with SCHEMA_VERIFY_FAILED when empty plan on empty database', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const emptyPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: emptyPlan.spaceId ?? APP_SPACE_ID,
          plan: emptyPlan,
          migrationEdges: synthEdges(emptyPlan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');
    expect({
      metaKeys: Object.keys(failure.meta).sort(),
      databaseUnchanged: failure.meta.databaseUnchanged,
      found: (failure.meta.schemaIssues?.length ?? 0) > 0,
    }).toEqual({
      metaKeys: ['databaseUnchanged', 'failingSpace', 'schemaIssues'],
      databaseUnchanged: true,
      found: true,
    });

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with PRECHECK_FAILED when operation precheck fails', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const failingPlan = createFailingPlan();

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: failingPlan.spaceId ?? APP_SPACE_ID,
          plan: failingPlan,
          migrationEdges: synthEdges(failingPlan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.PRECHECK_FAILED');
    expect(failure.message).toMatch(/precheck/i);
    expect(failure.why).toBe(
      'Before operation table.user runs, it checks: always false. That check failed on this database. The failed apply changed nothing.',
    );

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with MARKER_ORIGIN_MISMATCH when existing marker does not match plan origin', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    await bootstrapSqliteControlTables(driver);
    await familyInstance.initMarker({
      driver,
      space: APP_SPACE_ID,
      destination: {
        storageHash: 'other-contract',
        profileHash: 'other-profile',
        invariants: [],
      },
    });

    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const emptyPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: {
        storageHash: 'expected-origin',
        profileHash: 'expected-profile',
      },
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: emptyPlan.spaceId ?? APP_SPACE_ID,
          plan: emptyPlan,
          migrationEdges: synthEdges(emptyPlan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.MARKER_ORIGIN_MISMATCH');
    expect(failure.message).toMatch(/does not match plan origin/i);

    const markerRow = await driver.query<{ core_hash: string; profile_hash: string }>(
      'SELECT core_hash, profile_hash FROM _prisma_marker WHERE space = ?',
      ['app'],
    );
    expect(markerRow.rows[0]).toMatchObject({
      core_hash: 'other-contract',
      profile_hash: 'other-profile',
    });

    const ledgerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    expect(ledgerCount.rows[0]!.cnt).toBe(0);
  });

  it('fails with POSTCHECK_FAILED when postcheck fails after execution', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const planWithFailingPostcheck = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.test_table',
          label: 'Create test_table but postcheck fails',
          summary: 'Execute runs, but postcheck returns false',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { objectType: 'table', name: 'test_table' },
          },
          precheck: [],
          execute: [
            {
              description: 'create test_table',
              sql: 'CREATE TABLE "test_table" (id INTEGER PRIMARY KEY)',
            },
          ],
          postcheck: [
            {
              description: 'verify table "test_table" exists',
              sql: 'SELECT 0',
              expectation: { expects: 'present', object: 'table "test_table"' },
            },
          ],
        },
      ],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: planWithFailingPostcheck.spaceId ?? APP_SPACE_ID,
          plan: planWithFailingPostcheck,
          migrationEdges: synthEdges(planWithFailingPostcheck),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.POSTCHECK_FAILED');
    expect(failure.message).toMatch(/table\.test_table/i);
    expect(failure.why).toBe(
      'After operation table.test_table ran, it checks: verify table "test_table" exists. That check failed: the database has no table "test_table". The failed apply changed nothing.',
    );

    // Table should be rolled back
    const tableRow = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'test_table'",
    );
    expect(tableRow.rows[0]!.cnt).toBe(0);

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with EXECUTION_FAILED when SQL errors during execute step', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const planWithInvalidSql = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.user',
          label: 'Insert into nonexistent table',
          summary: 'SQL references a table that does not exist',
          operationClass: 'additive',
          target: { id: 'sqlite', details: { objectType: 'table', name: 'user' } },
          precheck: [],
          execute: [
            {
              description: 'insert into nonexistent table',
              sql: 'INSERT INTO "nonexistent_table_xyz" (id) VALUES (1)',
            },
          ],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: planWithInvalidSql.spaceId ?? APP_SPACE_ID,
          plan: planWithInvalidSql,
          migrationEdges: synthEdges(planWithInvalidSql),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.EXECUTION_FAILED');
    expect(failure.message).toMatch(/table\.user.*execution/i);
    expect(failure.meta).toMatchObject({
      operationId: 'table.user',
      stepDescription: 'insert into nonexistent table',
    });

    await expectNoMarkerOrLedgerWrites(driver);
  });

  it('fails with DESTINATION_CONTRACT_MISMATCH when plan hash differs from contract', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: { storageHash: 'plan-hash', profileHash: 'plan-profile' },
      operations: [],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.DESTINATION_CONTRACT_MISMATCH');
  });
});

describe('SqliteMigrationRunner - Policy Violations', () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('fails with POLICY_VIOLATION when operation class not allowed', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const planWithPolicyViolation = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        {
          id: 'table.drop_something',
          label: 'Destructive operation',
          summary: 'Should be rejected by additive-only policy',
          operationClass: 'destructive',
          target: {
            id: 'sqlite',
            details: { objectType: 'table', name: 'something' },
          },
          precheck: [],
          execute: [{ description: 'drop table', sql: 'DROP TABLE IF EXISTS "something"' }],
          postcheck: [],
        },
      ],
      providedInvariants: [],
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: planWithPolicyViolation.spaceId ?? APP_SPACE_ID,
          plan: planWithPolicyViolation,
          migrationEdges: synthEdges(planWithPolicyViolation),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.POLICY_VIOLATION');
      expect(result.failure.message).toMatch(/destructive/i);
      expect(result.failure.why).toMatch(/additive/i);
    }

    await expectNoMarkerOrLedgerWrites(driver);
  });
});
