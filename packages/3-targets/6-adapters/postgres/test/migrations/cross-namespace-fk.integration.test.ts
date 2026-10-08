import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY, type SqlMigrationPlanOperation } from '@internal/family-sql/control';
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
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * AC1 — cross-namespace FK end-to-end via PGlite-backed Postgres.
 *
 * A 2-namespace contract (public.post → auth.user) exercises the full
 * planner → DDL → verifier path for cross-namespace foreign keys.
 */

function buildCrossNamespaceFkContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('cross-ns-fk'),
    storage: new SqlStorage({
      storageHash: coreHash('cross-ns-fk'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              post: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  author_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'post',
                      columns: ['author_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId('auth'),
                      tableName: 'user',
                      columns: ['id'],
                    },
                    constraint: true,
                    index: false,
                  },
                ],
              },
            },
          },
        }),
        auth: postgresCreateNamespace({
          id: 'auth',
          entries: {
            table: {
              user: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
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

describe('AC1 — cross-namespace FK end-to-end (PGlite)', { concurrent: false }, () => {
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
    'applies a cross-namespace FK contract, verifies the schema, and round-trips data',
    async () => {
      const contract = buildCrossNamespaceFkContract();

      // Plan: schema is empty, contract has cross-namespace FK
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

      // Confirm the plan emits CREATE SCHEMA "auth" before any DDL that
      // targets that schema — closes the FR9 / AC1 gap where the
      // database was missing the schema container at apply time.
      const planOps = (await Promise.all(
        planResult.plan.operations,
      )) as SqlMigrationPlanOperation<unknown>[];
      const operationIds = planOps.map((op) => op.id);
      const createSchemaIdx = operationIds.indexOf('schema.auth');
      expect(createSchemaIdx).toBeGreaterThanOrEqual(0);

      const allSql = planOps
        .flatMap((op) => [...op.precheck, ...op.execute, ...op.postcheck])
        .map((step) => step.sql);

      const createSchemaSql = allSql.find((s) => s.includes('CREATE SCHEMA'));
      expect(createSchemaSql).toContain('CREATE SCHEMA IF NOT EXISTS "auth"');

      const fkDdl = allSql.find(
        (s) => s.includes('REFERENCES') && s.toLowerCase().includes('auth'),
      );
      expect(fkDdl).toBeDefined();
      expect(fkDdl).toContain('"auth"."user"');

      // CREATE SCHEMA must precede every table DDL that targets auth.
      const sqlByOpIdx = planOps.map((op) => ({
        id: op.id,
        sql: [...op.precheck, ...op.execute, ...op.postcheck].map((step) => step.sql).join('\n'),
      }));
      const createAuthUserIdx = sqlByOpIdx.findIndex((entry) =>
        entry.sql.includes('CREATE TABLE "auth"."user"'),
      );
      expect(createAuthUserIdx).toBeGreaterThanOrEqual(0);
      expect(createSchemaIdx).toBeLessThan(createAuthUserIdx);

      // Apply all operations
      for (const op of planOps) {
        for (const step of [...op.precheck, ...op.execute, ...op.postcheck]) {
          await driver.query(step.sql, step.params ?? []);
        }
      }

      // Verify: introspect the live DB and compare against the contract
      const introspected = await familyInstance.introspect({ driver, contract });
      const verifyResult = familyInstance.verifySchema({
        contract,
        schema: introspected,
        strict: false,
        frameworkComponents,
      });

      if (!verifyResult.ok) {
        throw new Error(
          `verifySchema failed: ${JSON.stringify(verifyResult.schema.issues, null, 2)}`,
        );
      }
      expect(verifyResult.ok).toBe(true);
      expect(verifyResult.schema.issues).toEqual([]);

      // Round-trip: insert into auth.user, then insert into public.post with a valid FK
      await driver.query('INSERT INTO "auth"."user" (id) VALUES (1)');
      await driver.query('INSERT INTO "post" (id, author_id) VALUES (1, 1)');

      const rows = await driver.query<{ id: number; author_id: number }>(
        'SELECT id, author_id FROM "post"',
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ id: 1, author_id: 1 });

      // FK constraint is honored: inserting with a missing user should fail
      await expect(
        driver.query('INSERT INTO "post" (id, author_id) VALUES (2, 999)'),
      ).rejects.toThrow();
    },
    testTimeout,
  );
});
