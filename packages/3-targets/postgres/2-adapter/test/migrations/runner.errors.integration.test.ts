import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expectNoMarkerOrLedgerWrites } from '../utils/dbAssertions';
import {
  bootstrapPostgresControlTables,
  contract,
  createDriver,
  createFailingPlan,
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

describe('PostgresMigrationRunner - Error Scenarios', { concurrent: false }, () => {
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

  describe('when an empty plan is executed but the schema does not satisfy the destination contract', () => {
    it('fails with SCHEMA_VERIFY_FAILED error and leaves no marker or ledger writes', {
      timeout: testTimeout,
    }, async () => {
      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
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
            driver: driver!,
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

      await expectNoMarkerOrLedgerWrites(driver!);
    });
  });

  describe('when an operation precheck fails', () => {
    it('fails with PRECHECK_FAILED error and leaves no marker or ledger writes', {
      timeout: testTimeout,
    }, async () => {
      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const failingPlan = createFailingPlan();

      const result = await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: failingPlan.spaceId ?? APP_SPACE_ID,
            plan: failingPlan,
            migrationEdges: synthEdges(failingPlan),
            driver: driver!,
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

      await expectNoMarkerOrLedgerWrites(driver!);
    });
  });

  describe('when an existing marker does not match the origin contract', () => {
    it('fails with MARKER_ORIGIN_MISMATCH error and does not modify marker or append ledger', {
      timeout: testTimeout,
    }, async () => {
      await bootstrapPostgresControlTables(driver!);

      await familyInstance.initMarker({
        driver: driver!,
        space: APP_SPACE_ID,
        destination: {
          storageHash: 'other-contract',
          profileHash: 'other-profile',
          invariants: [],
        },
      });

      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
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
            driver: driver!,
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

      const markerRow = await driver!.query<{ core_hash: string; profile_hash: string }>(
        'select core_hash, profile_hash from prisma_contract.marker where space = $1',
        ['app'],
      );
      expect(markerRow.rows[0]).toMatchObject({
        core_hash: 'other-contract',
        profile_hash: 'other-profile',
      });

      const ledgerCount = await driver!.query<{ count: string }>(
        'select count(*)::text as count from prisma_contract.ledger',
      );
      expect(ledgerCount.rows[0]?.count).toBe('0');

      const tableRow = await driver!.query<{ exists: boolean }>(
        `select to_regclass('public."user"') is not null as exists`,
      );
      expect(tableRow.rows[0]?.exists).toBe(false);
    });
  });

  describe('when the plan executes but the resulting schema does not satisfy the contract', () => {
    it('fails with SCHEMA_VERIFY_FAILED error and rolls back all changes', {
      timeout: testTimeout,
    }, async () => {
      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      const invalidPlan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [
          {
            id: 'table.user',
            label: 'Create user table without required columns',
            summary: 'Creates a user table missing contract-required columns',
            operationClass: 'additive',
            target: {
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'user',
              },
            },
            precheck: [],
            execute: [
              {
                description: 'create user table',
                sql: 'create table "user" (id uuid primary key)',
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
            space: invalidPlan.spaceId ?? APP_SPACE_ID,
            plan: invalidPlan,
            migrationEdges: synthEdges(invalidPlan),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });

      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');

      await expectNoMarkerOrLedgerWrites(driver!);

      // Verify table was rolled back
      const tableRow = await driver!.query<{ exists: boolean }>(
        `select to_regclass('public."user"') is not null as exists`,
      );
      expect(tableRow.rows[0]?.exists).toBe(false);
    });
  });

  describe('when an operation postcheck fails after execution', () => {
    it('fails with POSTCHECK_FAILED error and rolls back all changes', {
      timeout: testTimeout,
    }, async () => {
      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      const planWithFailingPostcheck = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [
          {
            id: 'table.test_table',
            label: 'Create test_table but postcheck fails',
            summary: 'The execute step runs, but postcheck returns false',
            operationClass: 'additive',
            target: {
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'test_table',
              },
            },
            precheck: [],
            execute: [
              {
                description: 'create test_table',
                sql: 'create table "test_table" (id uuid primary key)',
              },
            ],
            postcheck: [
              {
                description: 'always returns false',
                sql: 'select false',
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
            driver: driver!,
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
      expect(failure.message).toMatch(/postcheck/i);

      // Verify table was rolled back
      const tableRow = await driver!.query<{ exists: boolean }>(
        `select to_regclass('public."test_table"') is not null as exists`,
      );
      expect(tableRow.rows[0]?.exists).toBe(false);

      // Verify no marker/ledger writes
      await expectNoMarkerOrLedgerWrites(driver!);
    });
  });

  describe('when an operation execute step fails with SQL error', () => {
    it('fails with EXECUTION_FAILED error and includes normalized error metadata', {
      timeout: testTimeout,
    }, async () => {
      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      // Create a plan with SQL that will fail (syntax error)
      const planWithInvalidSql = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [
          {
            id: 'table.user',
            label: 'Create user table with invalid SQL',
            summary: 'The execute SQL has a syntax error',
            operationClass: 'additive',
            target: {
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'user',
              },
            },
            precheck: [],
            execute: [
              {
                description: 'create user table with invalid SQL',
                sql: 'CREATE TABLE "user" (id INVALID_TYPE PRIMARY KEY)',
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
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });

      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.code).toBe('MIGRATION.EXECUTION_FAILED');
      expect(failure.message).toMatch(/Operation table\.user failed during execution/i);
      expect(failure.meta).toMatchObject({
        operationId: 'table.user',
        stepDescription: 'create user table with invalid SQL',
        sql: 'CREATE TABLE "user" (id INVALID_TYPE PRIMARY KEY)',
      });
      // Normalized error metadata should include sqlState
      expect(failure.meta?.['sqlState']).toBe('42704'); // undefined_object

      await expectNoMarkerOrLedgerWrites(driver!);

      // Verify table was not created (rolled back)
      const tableRow = await driver!.query<{ exists: boolean }>(
        `select to_regclass('public."user"') is not null as exists`,
      );
      expect(tableRow.rows[0]?.exists).toBe(false);
    });

    it('includes constraint violation metadata when SQL fails with constraint error', {
      timeout: testTimeout,
    }, async () => {
      // NOTE: This test intentionally creates the table outside the migration plan
      // to test error handling for DML failures (INSERT/UPDATE/DELETE) during migration
      // execution, rather than DDL errors (CREATE TABLE/ALTER TABLE). Other tests in
      // this file focus on DDL errors where the migration creates schema objects.
      await driver!.query(`
          CREATE TABLE "user" (
            id uuid PRIMARY KEY,
            email text NOT NULL,
            CONSTRAINT user_email_unique UNIQUE (email)
          )
        `);

      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      // Create a plan that tries to insert duplicate email (will fail with constraint violation)
      const planWithConstraintViolation = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [
          {
            id: 'insert.duplicate',
            label: 'Insert duplicate email',
            summary: 'Tries to insert a duplicate email which violates unique constraint',
            operationClass: 'additive',
            target: {
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'user',
              },
            },
            precheck: [],
            execute: [
              {
                description: 'insert first user',
                sql: `INSERT INTO "user" (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'test@example.com')`,
              },
              {
                description: 'insert duplicate email',
                sql: `INSERT INTO "user" (id, email) VALUES ('00000000-0000-0000-0000-000000000002', 'test@example.com')`,
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
            space: planWithConstraintViolation.spaceId ?? APP_SPACE_ID,
            plan: planWithConstraintViolation,
            migrationEdges: synthEdges(planWithConstraintViolation),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });

      expect(result.ok).toBe(false);
      const failure = result.assertNotOk();
      expect(failure.code).toBe('MIGRATION.EXECUTION_FAILED');
      expect(failure.meta).toMatchObject({
        operationId: 'insert.duplicate',
        stepDescription: 'insert duplicate email',
        sqlState: '23505', // Unique violation SQLSTATE
        constraint: 'user_email_unique',
        table: 'user',
        // PostgreSQL does not include column property for unique constraint violations
      });

      // Verify transaction was rolled back (no rows inserted)
      const countRow = await driver!.query<{ count: string }>(
        'SELECT count(*)::text as count FROM "user"',
      );
      expect(countRow.rows[0]?.count).toBe('0');
    });
  });
});
