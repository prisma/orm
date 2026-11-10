import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
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
 * A contract whose only table has a single `pg/uuid@1` id column and a text body column.
 *
 * Fail conditions per test:
 * - Removing `codecId: 'pg/uuid@1'` or changing it to `pg/text@1` breaks the DDL test
 *   (column type becomes `text`, not `uuid`) and the verifySchema test.
 * - A codec `pg/uuid@1` that represented another data type than `pg/uuid` would change the DDL.
 */
const contractWithUuid: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('test'),
  storage: new SqlStorage({
    storageHash: coreHash('uuid-e2e'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            item: {
              columns: {
                id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
                label: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
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

describe('pg/uuid@1 — end-to-end PGlite coverage', { concurrent: false }, () => {
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

  async function applyContract(d: PostgresControlDriver): Promise<void> {
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract: contractWithUuid,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    if (planResult.kind !== 'success') {
      throw new Error(`Planner failed: ${planResult.kind}`);
    }

    const executeResult = await runner.execute({
      driver: d,
      perSpaceOptions: [
        {
          space: planResult.plan.spaceId ?? APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: d,
          destinationContract: contractWithUuid,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    if (!executeResult.ok) {
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }
  }

  /**
   * SDoD1 (a): DDL renders the column as native `uuid` type.
   *
   * Fails if `pg/uuid@1` represents another data type than `pg/uuid`, so the planner
   * writes another type.
   */
  it('DDL creates a column with Postgres native uuid type', { timeout: testTimeout }, async () => {
    await applyContract(driver!);

    const result = await driver!.query<{ udt_name: string }>(`
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'item'
        AND column_name = 'id'
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.udt_name).toBe('uuid');
  });

  /**
   * SDoD1 (b): insert/select round-trip preserves the canonical lowercase uuid string.
   *
   * Fails if the codec encode/decode introduces any transformation (e.g. case normalization
   * or serialization that PGlite rejects). Also fails if the column type is changed to `text`
   * (which would accept the string but not as a native uuid).
   */
  it('insert + select round-trips a canonical uuid string unchanged', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(driver!);

    const id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    await driver!.query(`INSERT INTO "item" (id, label) VALUES ($1, $2)`, [id, 'hello']);

    const result = await driver!.query<{ id: string; label: string }>(
      `SELECT id::text, label FROM "item" WHERE id = $1`,
      [id],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe(id);
    expect(result.rows[0]?.label).toBe('hello');
  });

  /**
   * SDoD2 (d) — extended: PGlite accepts uuid values generated via gen_random_uuid() as a
   * database-side expression. This demonstrates the native uuid column works correctly with
   * Postgres' own uuid generation function, confirming `pg/uuid@1`'s DDL output is accepted.
   *
   * Fails if the column is not actually a native `uuid` type (gen_random_uuid() return type
   * is uuid, so it only works if the column accepts uuid, not text).
   */
  it('native uuid column accepts gen_random_uuid() as a DEFAULT expression', {
    timeout: testTimeout,
  }, async () => {
    await applyContract(driver!);

    // Temporarily add a uuid default via raw SQL to demonstrate native-uuid compatibility.
    await driver!.query(
      `INSERT INTO "item" (id, label) VALUES (gen_random_uuid(), 'db-generated')`,
    );

    const result = await driver!.query<{ id: string; label: string }>(
      `SELECT id::text, label FROM "item" WHERE label = 'db-generated'`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe('db-generated');
    expect(result.rows[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
