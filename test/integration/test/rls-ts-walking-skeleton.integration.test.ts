/**
 * RLS walking skeleton, TS-authored — the slice-1 scenario authored via
 * `defineContract` + the RLS helpers instead of PSL, with identical
 * observable behaviour against live PGlite:
 *
 *  1. Authored policies migrate on (CREATE TABLE + ENABLE ROW LEVEL SECURITY
 *     + CREATE POLICY) and filter rows under manual `SET ROLE`; verify is
 *     clean afterwards.
 *  2. Lifecycle: predicate edit → drop+create under a new wire name (and the
 *     new predicate enforces); prefix rename with unchanged content →
 *     `ALTER POLICY … RENAME TO` (no drop, no create); policy removal →
 *     drop, then verify is clean again.
 *  3. Drift: an out-of-band policy drop fails verify naming the wire name.
 *  4. A TS-declared `role(...)` in `entities` absent from pg_roles fails
 *     verify naming the role (the slice-4 existence check, reached from the
 *     TS authoring surface for the first time).
 *
 * Lives in test/integration (not beside the PSL twin in adapter-postgres):
 * `@internal/postgres` already depends on `@internal/adapter-postgres`,
 * so the reverse devDependency would create a workspace cycle.
 */
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapterDescriptor from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriverDescriptor from '@internal/driver-postgres/control';
import sqlFamilyDescriptor, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  createControlStack,
  issueOutcome,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import {
  defineContract,
  field,
  model,
  policySelect,
  rlsEnabled,
  role,
  type SqlExpression,
  sql,
} from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import { isPostgresSchema, PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testTimeout = timeouts.spinUpPpgDev;

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensions: [],
});
const familyInstance = sqlFamilyDescriptor.create(controlStack);
const controlAdapter = postgresAdapterDescriptor.create(controlStack);
const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
] as const;

const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

const ALLOW_DESTRUCTIVE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

type PostgresControlDriver = Awaited<ReturnType<typeof postgresDriverDescriptor.create>>;

const OWNER_PREDICATE = sql`owner_id = current_setting('app.uid')::int`;
const EDITED_PREDICATE = sql`${OWNER_PREDICATE} AND deleted_at IS NULL`;

const appUser = role('app_user');

function makeProfile() {
  return model('profile', {
    fields: {
      id: field.column(int4Column).id(),
      owner_id: field.column(int4Column),
      deleted_at: field.column(textColumn).optional(),
    },
  }).sql({ table: 'profile' });
}

function buildTsContract(input: {
  readonly policy?: { readonly prefix: string; readonly using: SqlExpression };
  readonly declaredRoleName?: string;
}): Contract<SqlStorage> {
  const profile = makeProfile();
  return defineContract({
    models: { profile },
    entities: [
      rlsEnabled(profile),
      ...(input.policy !== undefined
        ? [
            policySelect(profile, {
              name: input.policy.prefix,
              roles: [appUser],
              using: input.policy.using,
            }),
          ]
        : []),
      ...(input.declaredRoleName !== undefined ? [role(input.declaredRoleName)] : []),
    ],
  });
}

function wireNameOf(contract: Contract<SqlStorage>): string {
  const ns = contract.storage.namespaces['public'];
  if (!isPostgresSchema(ns)) throw new Error('expected PostgresSchema for public');
  const name = Object.values(ns.policy)[0]?.name;
  if (name === undefined) throw new Error('expected one policy in the contract');
  return name;
}

function planContract(
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy = INIT_ADDITIVE_POLICY,
) {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const planResult = planner.plan({
    contract,
    schema,
    policy,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planResult.kind !== 'success') {
    throw new Error(`Planner failed: ${JSON.stringify(planResult)}`);
  }
  return planResult.plan;
}

type PlannedMigration = ReturnType<typeof planContract>;

async function planSql(plan: PlannedMigration): Promise<readonly string[]> {
  const ops = await Promise.all(plan.operations);
  return ops
    .flatMap((op) => [...op.precheck, ...op.execute, ...op.postcheck])
    .map((step) => step.sql);
}

async function applyPlan(
  driver: PostgresControlDriver,
  plan: PlannedMigration,
  contract: Contract<SqlStorage>,
  policy: MigrationOperationPolicy,
): Promise<void> {
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: plan.spaceId ?? APP_SPACE_ID,
        plan,
        migrationEdges: [
          buildFabricatedMigrationEdge({
            currentMarkerStorageHash: plan.origin?.storageHash,
            destinationStorageHash: plan.destination.storageHash,
            operationCount: plan.operations.length,
          }),
        ],
        driver,
        destinationContract: contract,
        policy,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok) {
    throw new Error(`Runner failed: ${JSON.stringify(executeResult.failure, null, 2)}`);
  }
}

async function applyContract(
  driver: PostgresControlDriver,
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy = INIT_ADDITIVE_POLICY,
): Promise<void> {
  await applyPlan(driver, planContract(contract, schema, policy), contract, policy);
}

async function selectVisibleIds(driver: PostgresControlDriver, uid: string): Promise<number[]> {
  await driver.query('SET ROLE app_user');
  await driver.query(`SELECT set_config('app.uid', '${uid}', false)`);
  const rows = await driver.query<{ id: number }>(`SELECT id FROM "public"."profile" ORDER BY id`);
  await driver.query('RESET ROLE');
  return rows.rows.map((row) => row.id);
}

describe('RLS walking skeleton — TS author → plan → apply → filter → verify', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: PostgresControlDriver;

  const contractA = buildTsContract({ policy: { prefix: 'p_read', using: OWNER_PREDICATE } });
  const contractB = buildTsContract({ policy: { prefix: 'p_read', using: EDITED_PREDICATE } });
  const contractRenamed = buildTsContract({
    policy: { prefix: 'p_read_v2', using: EDITED_PREDICATE },
  });
  const contractNoPolicy = buildTsContract({});

  const nameA = wireNameOf(contractA);
  const nameB = wireNameOf(contractB);
  const nameRenamed = wireNameOf(contractRenamed);

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresDriverDescriptor.create(database.connectionString);
    // Role provisioning is out of scope for the planner; CREATE POLICY … TO
    // app_user needs the role to exist.
    await driver.query('CREATE ROLE app_user');
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  it(
    'wire names: edit changes the hash, rename keeps it under a new prefix',
    () => {
      expect(nameA).toMatch(/^p_read_[0-9a-f]{8}$/);
      expect(nameB).toMatch(/^p_read_[0-9a-f]{8}$/);
      expect(nameA).not.toBe(nameB);
      // Same content as B, different prefix — the hash suffix must match.
      expect(nameRenamed).toBe(`p_read_v2${nameB.slice('p_read'.length)}`);
    },
    testTimeout,
  );

  it(
    'applies the TS-authored contract and filters rows under SET ROLE; verify is clean',
    async () => {
      const plan = planContract(contractA, emptySchema);
      const allSql = await planSql(plan);
      expect(allSql.some((s) => s.includes('CREATE TABLE'))).toBe(true);
      expect(allSql.some((s) => s.includes('ENABLE ROW LEVEL SECURITY'))).toBe(true);
      expect(allSql.some((s) => s.includes(`CREATE POLICY "${nameA}"`))).toBe(true);

      await applyPlan(driver, plan, contractA, INIT_ADDITIVE_POLICY);

      await driver.query(
        `INSERT INTO "public"."profile" (id, owner_id, deleted_at) VALUES (1, 101, NULL), (2, 101, '2024-01-01'), (3, 202, NULL)`,
      );
      await driver.query(`GRANT SELECT ON "public"."profile" TO app_user`);

      // Predicate A: ownership only — both rows owned by uid 101 are visible.
      expect(await selectVisibleIds(driver, '101')).toEqual([1, 2]);
      expect(await selectVisibleIds(driver, '202')).toEqual([3]);

      const introspected = await familyInstance.introspect({ driver, contract: contractA });
      const verifyResult = familyInstance.verifySchema({
        contract: contractA,
        schema: introspected,
        strict: false,
        frameworkComponents,
      });
      expect(verifyResult.schema.issues).toEqual([]);
    },
    testTimeout,
  );

  it(
    'predicate edit plans drop+create under the new wire name, and the new predicate enforces',
    async () => {
      const introspected = await familyInstance.introspect({ driver, contract: contractA });
      const plan = planContract(contractB, introspected, ALLOW_DESTRUCTIVE);
      const allSql = await planSql(plan);
      expect(allSql.some((s) => s.includes(`CREATE POLICY "${nameB}"`))).toBe(true);
      expect(allSql.some((s) => s.includes(`DROP POLICY "${nameA}"`))).toBe(true);

      await applyPlan(driver, plan, contractB, ALLOW_DESTRUCTIVE);

      const policyRows = await driver.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'profile' AND schemaname = 'public'`,
      );
      expect(policyRows.rows.map((r) => r.policyname)).toEqual([nameB]);

      // Predicate B additionally hides the soft-deleted row 2.
      expect(await selectVisibleIds(driver, '101')).toEqual([1]);
    },
    testTimeout,
  );

  it(
    'prefix rename with unchanged content plans ALTER POLICY … RENAME TO — no drop, no create',
    async () => {
      const introspected = await familyInstance.introspect({ driver, contract: contractB });
      const plan = planContract(contractRenamed, introspected, ALLOW_DESTRUCTIVE);
      const allSql = await planSql(plan);

      const renameSql = allSql.find((s) => s.includes('RENAME TO'));
      expect(renameSql).toBeDefined();
      expect(renameSql).toContain(`ALTER POLICY "${nameB}"`);
      expect(renameSql).toContain(`RENAME TO "${nameRenamed}"`);
      expect(allSql.some((s) => s.includes('CREATE POLICY'))).toBe(false);
      expect(allSql.some((s) => s.includes('DROP POLICY'))).toBe(false);

      await applyPlan(driver, plan, contractRenamed, ALLOW_DESTRUCTIVE);

      const policyRows = await driver.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'profile' AND schemaname = 'public'`,
      );
      expect(policyRows.rows.map((r) => r.policyname)).toEqual([nameRenamed]);
    },
    testTimeout,
  );

  it(
    'drift: an out-of-band policy drop fails verify naming the wire name; re-applying restores it',
    async () => {
      await driver.query(`DROP POLICY "${nameRenamed}" ON "public"."profile"`);

      const drifted = await familyInstance.introspect({ driver, contract: contractRenamed });
      const verifyResult = familyInstance.verifySchema({
        contract: contractRenamed,
        schema: drifted,
        strict: false,
        frameworkComponents,
      });
      expect(verifyResult.ok).toBe(false);
      const missing = verifyResult.schema.issues.filter(
        (issue) => issueOutcome(issue) === 'not-found',
      );
      expect(missing.some((issue) => issue.path.join('/').includes(nameRenamed))).toBe(true);

      // Re-apply: the plan recreates the dropped policy and verify is clean again.
      await applyContract(driver, contractRenamed, drifted, ALLOW_DESTRUCTIVE);
      const restored = await familyInstance.introspect({ driver, contract: contractRenamed });
      const verifyRestored = familyInstance.verifySchema({
        contract: contractRenamed,
        schema: restored,
        strict: false,
        frameworkComponents,
      });
      expect(verifyRestored.schema.issues).toEqual([]);
    },
    testTimeout,
  );

  it(
    'policy removal plans a drop; verify is clean afterwards',
    async () => {
      const introspected = await familyInstance.introspect({ driver, contract: contractRenamed });
      const plan = planContract(contractNoPolicy, introspected, ALLOW_DESTRUCTIVE);
      const allSql = await planSql(plan);
      expect(allSql.some((s) => s.includes(`DROP POLICY "${nameRenamed}"`))).toBe(true);

      await applyPlan(driver, plan, contractNoPolicy, ALLOW_DESTRUCTIVE);

      const policyRows = await driver.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'profile' AND schemaname = 'public'`,
      );
      expect(policyRows.rows).toEqual([]);

      const after = await familyInstance.introspect({ driver, contract: contractNoPolicy });
      const verifyResult = familyInstance.verifySchema({
        contract: contractNoPolicy,
        schema: after,
        strict: false,
        frameworkComponents,
      });
      expect(verifyResult.schema.issues).toEqual([]);
    },
    testTimeout,
  );

  it(
    'a TS-declared role absent from pg_roles fails verify naming the role',
    async () => {
      const contractWithRole = buildTsContract({ declaredRoleName: 'app_role' });
      const schema = await familyInstance.introspect({ driver, contract: contractWithRole });

      const verifyResult = familyInstance.verifySchema({
        contract: contractWithRole,
        schema,
        strict: false,
        frameworkComponents,
      });
      expect(verifyResult.ok).toBe(false);
      const roleIssue = verifyResult.schema.issues.find(
        (issue) => issueOutcome(issue) === 'not-found' && issue.path.includes('app_role'),
      );
      expect(roleIssue).toBeDefined();

      // The declared role exists in pg_roles → verify has no role issue.
      const contractWithExistingRole = buildTsContract({ declaredRoleName: 'app_user' });
      const verifyExisting = familyInstance.verifySchema({
        contract: contractWithExistingRole,
        schema: await familyInstance.introspect({ driver, contract: contractWithExistingRole }),
        strict: false,
        frameworkComponents,
      });
      expect(verifyExisting.schema.issues.some((issue) => issue.path.includes('app_user'))).toBe(
        false,
      );
    },
    testTimeout,
  );
});
