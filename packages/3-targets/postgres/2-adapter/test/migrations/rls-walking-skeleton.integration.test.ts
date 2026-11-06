import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { normalizeSqlBody, parseNaming } from '@internal/sql-schema-ir/naming';
import { computeContentHash } from '@internal/target-postgres/rls-canonicalize';
import {
  PostgresRlsEnablement,
  PostgresRlsPolicy,
  PostgresRole,
  PostgresSchema,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  testTimeout,
} from './fixtures/runner-fixtures';

// ============================================================================
// Contract construction (foundation IR path)
// ============================================================================

const TABLE_NAME = 'profile';
const POLICY_PREFIX = 'profile_read_own';
const POLICY_USING = "owner_id = current_setting('app.uid')::int";

const POLICY_HASH = computeContentHash({
  using: normalizeSqlBody(POLICY_USING),
  roles: ['app_user'],
  operation: 'select',
  permissive: true,
});
const POLICY_WIRE_NAME = `${POLICY_PREFIX}_${POLICY_HASH}`;

function buildRlsWalkingSkeletonContract(): Contract<SqlStorage> {
  const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });

  const policy = new PostgresRlsPolicy({
    naming: parseNaming(POLICY_WIRE_NAME, POLICY_PREFIX),
    tableName: TABLE_NAME,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: POLICY_USING,
    withCheck: undefined,
    permissive: true,
  });

  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            owner_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      role: { [role.name]: role },
      policy: { [policy.name]: policy },
      rls: {
        [TABLE_NAME]: new PostgresRlsEnablement({ tableName: TABLE_NAME, namespaceId: 'public' }),
      },
    },
  });

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('rls-walking-skeleton'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-walking-skeleton'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

// ============================================================================
// Walking-skeleton test
// ============================================================================

describe('RLS walking skeleton — author → plan → apply → filter → verify', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  it(
    'applies an RLS policy, enforces row isolation under SET ROLE, and re-verifies clean',
    async () => {
      const contract = buildRlsWalkingSkeletonContract();

      // Pre-create the role — role creation is out of scope for the planner.
      await driver.query('CREATE ROLE app_user');

      // Step 3: plan against empty schema.
      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const planResult = planner.plan({
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

      expect(planResult.kind).toBe('success');
      if (planResult.kind !== 'success') return;

      const ops = await Promise.all(planResult.plan.operations);
      const allSql = ops
        .flatMap((op) => [...op.precheck, ...op.execute, ...op.postcheck])
        .map((step) => step.sql);

      // Sanity: plan contains CREATE TABLE, ENABLE ROW LEVEL SECURITY, CREATE POLICY.
      expect(allSql.some((s) => s.includes('CREATE TABLE'))).toBe(true);
      expect(allSql.some((s) => s.includes('ENABLE ROW LEVEL SECURITY'))).toBe(true);
      expect(allSql.some((s) => s.includes('CREATE POLICY'))).toBe(true);

      // Step 4: apply all operations.
      for (const op of ops) {
        for (const step of [...op.precheck, ...op.execute, ...op.postcheck]) {
          await driver.query(step.sql, step.params ?? []);
        }
      }

      // Step 5: prove RLS filters rows.
      // Insert two rows with different owner_id values.
      await driver.query(
        `INSERT INTO "public"."${TABLE_NAME}" (id, owner_id) VALUES (1, 101), (2, 202)`,
      );

      // Grant SELECT so app_user can read the table.
      await driver.query(`GRANT SELECT ON "public"."${TABLE_NAME}" TO app_user`);

      // Switch to app_user and set the GUC to owner of row 1.
      await driver.query('SET ROLE app_user');
      await driver.query(`SELECT set_config('app.uid', '101', false)`);

      const filtered = await driver.query<{ id: number; owner_id: number }>(
        `SELECT id, owner_id FROM "public"."${TABLE_NAME}"`,
      );

      await driver.query('RESET ROLE');

      // The spine: only row 1 (owner_id=101) should be visible.
      expect(filtered.rows).toHaveLength(1);
      expect(filtered.rows[0]).toMatchObject({ id: 1, owner_id: 101 });

      // Step 6: re-verify clean — no RLS policy issues.
      const introspected = await familyInstance.introspect({ driver, contract });
      const verifyResult = familyInstance.verifySchema({
        contract,
        schema: introspected,
        strict: false,
        frameworkComponents,
      });

      expect(verifyResult.schema.issues).toEqual([]);
    },
    testTimeout,
  );
});
