import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperation,
  type SqlMigrationPlanOperationStep,
} from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * Multi-tenancy on Postgres via the late-bound `__unbound__` namespace.
 *
 * A single contract authored with an unbound namespace is applied against
 * two distinct tenant schemas on the same Postgres instance, each addressed
 * through the connection's `search_path`. The planner must emit unqualified DDL
 * (no `"public"."tenant"` prefix) so each tenant ends up with its own
 * physical table. Insert / select round-trips on each tenant must
 * remain isolated.
 *
 * The qualifier-routing test
 * (`packages/3-extensions/postgres/test/psl-namespace-qualifier-routing.test.ts`)
 * proves the contract-side substrate; this test proves the runtime
 * side end-to-end with PGlite-backed Postgres.
 */

const TENANT_A_SCHEMA = 'tenant_a';
const TENANT_B_SCHEMA = 'tenant_b';

function buildUnboundContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('unbound-multi-tenant'),
    storage: new SqlStorage({
      storageHash: coreHash('unbound-multi-tenant'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              tenant: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
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
}

function flattenSql(steps: readonly SqlMigrationPlanOperationStep[]): readonly string[] {
  return steps.map((step) => step.sql);
}

async function executeStepsAgainst(
  driver: PostgresControlDriver,
  steps: readonly SqlMigrationPlanOperationStep[],
): Promise<void> {
  for (const step of steps) {
    await driver.query(step.sql, step.params ?? []);
  }
}

describe('`namespace unbound` multi-tenancy via search_path', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);

    // Pre-create the tenant schemas. The planner has no contract-level
    // "create schema" op for `__unbound__` because the late-bound slot
    // is, by construction, supplied externally — typically by the
    // operator pre-creating the schema and configuring `search_path`
    // on the connection / role.
    await driver.query(`create schema if not exists ${TENANT_A_SCHEMA}`);
    await driver.query(`create schema if not exists ${TENANT_B_SCHEMA}`);
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  async function withSearchPath<T>(schema: string, fn: () => Promise<T>): Promise<T> {
    await driver.query(`set search_path to ${schema}`);
    try {
      return await fn();
    } finally {
      await driver.query('reset search_path');
    }
  }

  it(
    'plans unqualified DDL for an unbound contract, applies it independently per tenant, and round-trips inserts in isolation',
    async () => {
      const contract = buildUnboundContract();
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
      if (planResult.kind !== 'success') {
        throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
      }

      const planOps = (await Promise.all(
        planResult.plan.operations,
      )) as SqlMigrationPlanOperation<unknown>[];
      const allSteps = planOps.flatMap((op) => [
        ...flattenSql(op.precheck),
        ...flattenSql(op.execute),
        ...flattenSql(op.postcheck),
      ]);
      expect(allSteps.length).toBeGreaterThan(0);

      // Polymorphic dispatch through `PostgresSchema.unbound` elides
      // the schema qualifier, leaving the table name naked. The same
      // DDL therefore lands in whichever schema `search_path`
      // resolves at runtime.
      for (const sql of allSteps) {
        expect(sql).not.toContain('"public"."tenant"');
        expect(sql).not.toContain('public."tenant"');
      }

      const executeSteps = planOps.flatMap((op) => op.execute);

      // Apply the *same* unqualified DDL twice — once per tenant via
      // session-scoped `search_path`. Each apply lands in a different
      // physical schema even though the operator handed the runner
      // identical SQL.
      await withSearchPath(TENANT_A_SCHEMA, () => executeStepsAgainst(driver, executeSteps));
      await withSearchPath(TENANT_B_SCHEMA, () => executeStepsAgainst(driver, executeSteps));

      const physicalTables = await driver.query<{ table_schema: string; table_name: string }>(
        `select table_schema, table_name
         from information_schema.tables
         where table_name = 'tenant'
         order by table_schema`,
      );
      expect(physicalTables.rows.map((r) => r.table_schema).sort()).toEqual(
        [TENANT_A_SCHEMA, TENANT_B_SCHEMA].sort(),
      );

      // Insert / select round-trip — each tenant sees its own row only.
      await withSearchPath(TENANT_A_SCHEMA, async () => {
        await driver.query(`insert into "tenant" ("id", "label") values (1, $1)`, [
          'from-tenant-a',
        ]);
      });
      await withSearchPath(TENANT_B_SCHEMA, async () => {
        await driver.query(`insert into "tenant" ("id", "label") values (2, $1)`, [
          'from-tenant-b',
        ]);
      });

      const tenantARows = await withSearchPath(TENANT_A_SCHEMA, () =>
        driver.query<{ id: number; label: string }>(`select id, label from "tenant" order by id`),
      );
      expect(tenantARows.rows).toEqual([{ id: 1, label: 'from-tenant-a' }]);

      const tenantBRows = await withSearchPath(TENANT_B_SCHEMA, () =>
        driver.query<{ id: number; label: string }>(`select id, label from "tenant" order by id`),
      );
      expect(tenantBRows.rows).toEqual([{ id: 2, label: 'from-tenant-b' }]);

      // Catalog-level confirmation: the two tenants point at distinct
      // physical tables, not a shared `public.tenant`.
      const physicalCounts = await driver.query<{ table_schema: string; cnt: number }>(
        `select table_schema, count(*)::int as cnt
         from information_schema.tables
         where table_name = 'tenant'
         group by table_schema
         order by table_schema`,
      );
      expect(physicalCounts.rows).toEqual([
        { table_schema: TENANT_A_SCHEMA, cnt: 1 },
        { table_schema: TENANT_B_SCHEMA, cnt: 1 },
      ]);

      const publicLeak = await driver.query<{ cnt: number }>(
        `select count(*)::int as cnt
         from information_schema.tables
         where table_schema = 'public' and table_name = 'tenant'`,
      );
      expect(publicLeak.rows[0]?.cnt).toBe(0);
    },
    testTimeout,
  );
});
