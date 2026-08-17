import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * Integration tests for schema verification after runner execution.
 *
 * These tests prove that the schema verification primitive correctly detects
 * real database drift that occurs AFTER a successful migration.
 *
 * This is different from runner error tests which verify the runner correctly
 * fails when a plan is invalid. These tests simulate production scenarios where
 * someone manually alters the database after a migration.
 */
describe('Schema verification after runner - integration', { concurrent: false }, () => {
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

  /**
   * Helper to run a successful migration that creates the schema.
   */
  async function runSuccessfulMigration(d: PostgresControlDriver): Promise<void> {
    await runSuccessfulMigrationForContract(d, contract);
  }

  async function runSuccessfulMigrationForContract(
    d: PostgresControlDriver,
    contractInput: Contract<SqlStorage>,
  ): Promise<void> {
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const result = planner.plan({
      contract: contractInput,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    if (result.kind !== 'success') {
      throw new Error(`Planner failed: ${result.kind}`);
    }

    const executeResult = await runner.execute({
      driver: d,
      perSpaceOptions: [
        {
          space: result.plan.spaceId ?? APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver: d,
          destinationContract: contractInput,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    if (!executeResult.ok) {
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }
  }

  describe('when schema matches contract after migration', () => {
    it('returns ok: true', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      const schema = await familyInstance.introspect({
        driver: driver!,
        contract,
      });
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toHaveLength(0);
    });

    it('returns ok: true with normalized defaults', { timeout: testTimeout }, async () => {
      const contractWithDefaults: Contract<SqlStorage> = {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('test'),
        storage: new SqlStorage({
          storageHash: coreHash('contract-with-defaults'),
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
              id: UNBOUND_NAMESPACE_ID,
              entries: {
                table: {
                  user: {
                    columns: {
                      id: {
                        nativeType: 'int4',
                        codecId: 'pg/int4@1',
                        nullable: false,
                        default: { kind: 'function', expression: 'autoincrement()' },
                      },
                      createdAt: {
                        nativeType: 'timestamptz',
                        codecId: 'pg/timestamptz-temporal@1',
                        nullable: false,
                        default: { kind: 'function', expression: 'now()' },
                      },
                      email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            }),
          },
        }),
        roots: {},
        domain: applicationDomainOf({ models: {} }),
        capabilities: {},
        extensions: {},
        meta: {},
      };

      await runSuccessfulMigrationForContract(driver!, contractWithDefaults);

      const schema = await familyInstance.introspect({
        driver: driver!,
        contract: contractWithDefaults,
      });
      const result = familyInstance.verifySchema({
        contract: contractWithDefaults,
        schema,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toHaveLength(0);
    });
  });

  describe('when schema is mutated after migration', () => {
    it('detects nullability change (DROP NOT NULL)', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      // Mutate the database: make email nullable (was NOT NULL)
      await driver!.query('ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL');

      const schema = await familyInstance.introspect({
        driver: driver!,
        contract,
      });
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          path: ['database', 'public', 'user', 'column:email'],
        }),
      );
    });

    it('detects missing column (DROP COLUMN)', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      // Mutate the database: drop the email column
      await driver!.query('ALTER TABLE "user" DROP COLUMN email');

      const schema = await familyInstance.introspect({
        driver: driver!,
        contract,
      });
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          path: ['database', 'public', 'user', 'column:email'],
        }),
      );
    });

    it('detects type change', { timeout: testTimeout }, async () => {
      await runSuccessfulMigration(driver!);

      // Mutate the database: change email type from text to varchar(255)
      // PostgreSQL allows this type change
      await driver!.query('ALTER TABLE "user" ALTER COLUMN email TYPE varchar(255)');

      const schema = await familyInstance.introspect({
        driver: driver!,
        contract,
      });
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: false,
        frameworkComponents,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          path: ['database', 'public', 'user', 'column:email'],
        }),
      );
    });
  });
});
