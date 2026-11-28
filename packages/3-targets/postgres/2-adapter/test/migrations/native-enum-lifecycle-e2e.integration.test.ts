/**
 * Managed native-enum lifecycle end-to-end against a live (PGlite) database
 * (Phase 2 Slice A DoD):
 *
 *  - Create: a managed `native_enum` + `pg.enum` column migrates from empty —
 *    `CREATE TYPE` is ordered BEFORE the table that uses it (an out-of-order
 *    plan fails at apply on Postgres, so a clean apply is itself the ordering
 *    proof), then `db verify` is clean.
 *  - Drop: removing the block + column plans `DROP TYPE` after the column is
 *    gone; apply succeeds; re-verify clean.
 *  - Verify drift (R10): a managed enum reports missing / extra / value-mismatch.
 *
 * Member changes are in `native-enum-changes-e2e.integration.test.ts`.
 */
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { issueOutcome } from '@internal/framework-components/control';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOW_DESTRUCTIVE,
  applyPlan,
  buildContractFromPsl,
  opIds,
  PSL_AUTH_WITH_ENUM,
  PSL_AUTH_WITHOUT_ENUM,
  PSL_WITH_ENUM,
  PSL_WITHOUT_ENUM,
  planContract,
} from './fixtures/native-enum-lifecycle';
import {
  createDriver,
  createPrismaTables,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

interface LifecycleConfig {
  readonly label: string;
  readonly schemaName: string;
  readonly typeName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly createPsl: string;
  readonly dropPsl: string;
  /** The per-segment-quoted enum type name the CREATE TABLE column must carry. */
  readonly expectedColumnTypeSql: string;
}

function lifecycleSuite(cfg: LifecycleConfig): void {
  describe(`managed native-enum lifecycle e2e — ${cfg.label}`, { concurrent: false }, () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let driver: PostgresControlDriver;

    beforeAll(async () => {
      database = await createTestDatabase();
      driver = await createDriver(database.connectionString);
      await createPrismaTables(driver);
    }, testTimeout);

    afterAll(async () => {
      if (driver) await driver.close();
      if (database) await database.close();
    }, testTimeout);

    it(
      'create: CREATE TYPE is planned before the table, applies cleanly, verify is clean',
      async () => {
        const contract = buildContractFromPsl(cfg.createPsl, 'managed');
        const plan = await planContract(contract, emptySchema, INIT_ADDITIVE_POLICY);

        const ids = await opIds(plan);
        const createTypeIdx = ids.indexOf(`createNativeEnumType.${cfg.typeName}`);
        const createTableIdx = ids.indexOf(`table.${cfg.tableName}`);
        expect(createTypeIdx).toBeGreaterThanOrEqual(0);
        expect(createTableIdx).toBeGreaterThanOrEqual(0);
        // Ordering: the type must exist before the table that references it.
        expect(createTypeIdx).toBeLessThan(createTableIdx);

        // The CREATE TABLE column renders the enum type as a per-segment-quoted
        // (schema-qualified) identifier — not bare, not whole-string-quoted.
        const createTableOp = (await Promise.all(plan.operations)).find(
          (op) => op.id === `table.${cfg.tableName}`,
        );
        const createTableSql = createTableOp?.execute.map((s) => s.sql).join('\n') ?? '';
        expect(createTableSql).toContain(`"${cfg.columnName}" ${cfg.expectedColumnTypeSql}`);

        // Apply — an out-of-order plan (or a mis-quoted qualified type name for
        // a named schema) would fail here on Postgres.
        await applyPlan(driver, plan, contract, INIT_ADDITIVE_POLICY);

        // The type and the enum-typed column both exist.
        const typeRow = await driver.query<{ typname: string }>(
          `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = $1 AND n.nspname = $2`,
          [cfg.typeName, cfg.schemaName],
        );
        expect(typeRow.rows.map((r) => r.typname)).toEqual([cfg.typeName]);
        const colRow = await driver.query<{ udt_name: string }>(
          `SELECT udt_name FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [cfg.schemaName, cfg.tableName, cfg.columnName],
        );
        expect(colRow.rows[0]?.udt_name).toBe(cfg.typeName);

        const introspected = await familyInstance.introspect({ driver, contract });
        const verify = familyInstance.verifySchema({
          contract,
          schema: introspected,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
      },
      testTimeout,
    );

    it(
      'drop: DROP TYPE is planned after the dependent column is gone, applies cleanly, verify is clean',
      async () => {
        const contract = buildContractFromPsl(cfg.dropPsl, 'managed');
        const introspected = await familyInstance.introspect({ driver, contract });
        const plan = await planContract(contract, introspected, ALLOW_DESTRUCTIVE);

        const ids = await opIds(plan);
        const dropTypeIdx = ids.indexOf(`dropNativeEnumType.${cfg.typeName}`);
        const dropColumnIdx = ids.findIndex((id) => id.startsWith('dropColumn.'));
        expect(dropTypeIdx).toBeGreaterThanOrEqual(0);
        expect(dropColumnIdx).toBeGreaterThanOrEqual(0);
        // Ordering: the dependent column must be dropped before its type.
        expect(dropColumnIdx).toBeLessThan(dropTypeIdx);

        await applyPlan(driver, plan, contract, ALLOW_DESTRUCTIVE);

        const typeRow = await driver.query<{ typname: string }>(
          `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = $1 AND n.nspname = $2`,
          [cfg.typeName, cfg.schemaName],
        );
        expect(typeRow.rows).toHaveLength(0);

        const reintrospected = await familyInstance.introspect({ driver, contract });
        const verify = familyInstance.verifySchema({
          contract,
          schema: reintrospected,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
      },
      testTimeout,
    );
  });
}

lifecycleSuite({
  label: 'public schema',
  schemaName: 'public',
  typeName: 'order_status',
  tableName: 'orders',
  columnName: 'status',
  createPsl: PSL_WITH_ENUM,
  dropPsl: PSL_WITHOUT_ENUM,
  expectedColumnTypeSql: '"order_status"',
});

lifecycleSuite({
  label: 'named (auth) schema — qualified quoted type name',
  schemaName: 'auth',
  typeName: 'aal_level',
  tableName: 'sessions',
  columnName: 'aal',
  createPsl: PSL_AUTH_WITH_ENUM,
  dropPsl: PSL_AUTH_WITHOUT_ENUM,
  expectedColumnTypeSql: '"auth"."aal_level"',
});

describe('managed native-enum verify drift (R10)', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    if (driver) await driver.close();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    // The managed contract declares an `orders` table too; give the DB the
    // table so the only drift under test is the enum type itself.
    await driver.query('CREATE TABLE "public"."orders" (id int PRIMARY KEY)');
  }, testTimeout);

  function verifyManaged(schema: SqlSchemaIRNode) {
    const contract = buildContractFromPsl(PSL_WITH_ENUM, 'managed');
    return familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
  }

  it(
    'missing: contract declares the managed enum, the DB lacks it → verify fails',
    async () => {
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(false);
      const missing = verify.schema.issues.filter(
        (i) => issueOutcome(i) === 'not-found' && i.path.some((p) => p.includes('order_status')),
      );
      expect(missing.length).toBeGreaterThan(0);
    },
    testTimeout,
  );

  it(
    'extra: the DB has an undeclared managed enum → verify fails (strict)',
    async () => {
      // The contract's own type present (so it is not "missing"), plus a stray.
      await driver!.query(`CREATE TYPE order_status AS ENUM ('draft', 'review', 'done')`);
      await driver!.query(`CREATE TYPE stray_mood AS ENUM ('happy', 'sad')`);
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(false);
      const extra = verify.schema.issues.filter(
        (i) => issueOutcome(i) === 'not-expected' && i.path.some((p) => p.includes('stray_mood')),
      );
      expect(extra.length).toBeGreaterThan(0);
    },
    testTimeout,
  );

  it(
    'value-mismatch: same type name, different ordered members → verify fails',
    async () => {
      await driver!.query(`CREATE TYPE order_status AS ENUM ('review', 'draft', 'done')`);
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(false);
      const mismatch = verify.schema.issues.filter(
        (i) => issueOutcome(i) === 'not-equal' && i.path.some((p) => p.includes('order_status')),
      );
      expect(mismatch.length).toBeGreaterThan(0);
    },
    testTimeout,
  );

  it(
    'clean: the DB matches the declared managed enum exactly → verify passes',
    async () => {
      await driver!.query(`CREATE TYPE order_status AS ENUM ('draft', 'review', 'done')`);
      await driver!.query(`ALTER TABLE "public"."orders" ADD COLUMN status order_status NOT NULL`);
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(true);
    },
    testTimeout,
  );
});
