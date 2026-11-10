import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expectNoMarkerOrLedgerWrites } from '../utils/dbAssertions';
import {
  contract,
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

describe('PostgresMigrationRunner - Policy Violations', { concurrent: false }, () => {
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

  describe('when an operation violates the policy (operation class not allowed)', () => {
    it('fails with POLICY_VIOLATION error without executing any operations', {
      timeout: testTimeout,
    }, async () => {
      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      const planWithPolicyViolation = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [
          {
            id: 'table.drop_something',
            label: 'Destructive operation',
            summary: 'This is a destructive operation that should be rejected by policy',
            operationClass: 'destructive', // Not allowed by INIT_ADDITIVE_POLICY
            target: {
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'something',
              },
            },
            precheck: [],
            execute: [
              {
                description: 'drop table',
                sql: 'drop table if exists "something"',
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
            space: planWithPolicyViolation.spaceId ?? APP_SPACE_ID,
            plan: planWithPolicyViolation,
            migrationEdges: synthEdges(planWithPolicyViolation),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY, // Only allows 'additive'
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

      // Verify no marker/ledger writes
      await expectNoMarkerOrLedgerWrites(driver!);
    });

    it('fails with POLICY_VIOLATION on a data-class operation under INIT_ADDITIVE_POLICY', {
      timeout: testTimeout,
    }, async () => {
      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      // Lowered data-transform op shape (matches what `createDataTransform`
      // emits post-unification): precheck/execute/postcheck wrap the user's
      // check + run plans. The policy gate runs before any step executes,
      // so the SQL bodies are arbitrary.
      const planWithDataOp = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        providedInvariants: [],
        operations: [
          {
            id: 'data_migration.backfill-emails',
            label: 'Data transform: backfill-emails',
            operationClass: 'data', // Not allowed by INIT_ADDITIVE_POLICY
            target: { id: 'postgres' },
            precheck: [
              {
                description: 'Check backfill-emails has work to do',
                sql: `SELECT EXISTS (SELECT 1 FROM "user" WHERE "email" IS NULL) AS ok`,
                params: [],
              },
            ],
            execute: [
              {
                description: 'Run backfill-emails',
                sql: `UPDATE "user" SET "email" = $1 WHERE "email" IS NULL`,
                params: ['n/a'],
              },
            ],
            postcheck: [
              {
                description: 'Verify backfill-emails resolved all violations',
                sql: `SELECT NOT EXISTS (SELECT 1 FROM "user" WHERE "email" IS NULL) AS ok`,
                params: [],
              },
            ],
          },
        ],
      });

      const result = await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: planWithDataOp.spaceId ?? APP_SPACE_ID,
            plan: planWithDataOp,
            migrationEdges: synthEdges(planWithDataOp),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY, // Only allows 'additive'
            frameworkComponents,
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('MIGRATION.POLICY_VIOLATION');
        expect(result.failure.message).toMatch(/data/i);
        expect(result.failure.why).toMatch(/additive/i);
        expect(result.failure.meta).toMatchObject({
          operationId: 'data_migration.backfill-emails',
          operationClass: 'data',
        });
      }

      // Policy gate runs before any DB write, so neither marker nor
      // ledger should have been touched.
      await expectNoMarkerOrLedgerWrites(driver!);
    });

    it('succeeds with a policy that allows destructive operations', {
      timeout: testTimeout,
    }, async () => {
      // Create a table first so we can drop it
      await driver!.query('create table "something" (id serial primary key)');

      const runner = postgresTargetDescriptor.createRunner(familyInstance);

      // Same operation structure as above, but now with a permissive policy
      const planWithDestructiveOp = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [
          {
            id: 'table.drop_something',
            label: 'Drop table something',
            summary: 'Drops the something table',
            operationClass: 'destructive',
            target: {
              id: 'postgres',
              details: {
                schema: 'public',
                objectType: 'table',
                name: 'something',
              },
            },
            precheck: [],
            execute: [
              {
                description: 'drop table',
                sql: 'drop table if exists "something"',
              },
            ],
            postcheck: [
              {
                description: 'verify table dropped',
                sql: `select to_regclass('public."something"') is null`,
              },
            ],
          },
        ],
        providedInvariants: [],
      });

      // Policy that allows destructive operations
      const permissivePolicy = {
        allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
      };

      const result = await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: planWithDestructiveOp.spaceId ?? APP_SPACE_ID,
            plan: planWithDestructiveOp,
            migrationEdges: synthEdges(planWithDestructiveOp),
            driver: driver!,
            destinationContract: contract,
            policy: permissivePolicy,
            frameworkComponents,
          },
        ],
      });

      // With a permissive policy, the same plan succeeds
      // (Note: schemaVerify will fail because we're not actually creating the user table,
      // but the policy check itself passes)
      // We expect SCHEMA_VERIFY_FAILED, not POLICY_VIOLATION
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');
      }
    });
  });
});
