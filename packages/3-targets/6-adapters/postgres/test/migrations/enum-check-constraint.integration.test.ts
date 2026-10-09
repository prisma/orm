import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { buildBoundContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
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

const postgresTypeLookups = {
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
};

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

// ---------------------------------------------------------------------------
// Contract factories
// ---------------------------------------------------------------------------

const pgText = { codecId: 'pg/text@1' as const };

function buildEnumType(members: { name: string; value: string }[]) {
  const [first, ...rest] = members;
  if (!first) throw new Error('enumType requires at least one member');
  return enumType(
    'Role',
    pgText,
    member(first.name, first.value),
    ...rest.map((m) => member(m.name, m.value)),
  );
}

function makeRoleContract(members: { name: string; value: string }[]): Contract<SqlStorage> {
  const Role = buildEnumType(members);
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Role }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m }) => ({
      models: {
        User: m('User', {
          fields: {
            id: f.text().id(),
            role: f.namedType(Role),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

/**
 * The single check the contract declares on `User`. Authoring names it
 * `User_role_check_<hash>`, where the hash commits to the predicate — so a
 * member change re-suffixes the name, and the test reads the name off the
 * contract rather than restating it.
 */
function declaredCheck(contract: Contract<SqlStorage>): { name: string; expression: string } {
  const table = contract.storage.namespaces['public']?.entries.table?.['User'];
  const check = (table as StorageTable | undefined)?.checks?.[0];
  if (check === undefined) throw new Error('expected the contract to declare a check on User');
  return { name: check.name, expression: check.expression };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function verifySchema(
  driver: PostgresControlDriver,
  contract: Contract<SqlStorage>,
): Promise<ReturnType<(typeof familyInstance)['verifySchema']>> {
  const schema = await familyInstance.introspect({ driver, contract });
  return familyInstance.verifySchema({
    contract,
    schema,
    strict: false,
    frameworkComponents,
  });
}

async function queryPgConstraint(
  driver: PostgresControlDriver,
  tableName: string,
  constraintName: string,
): Promise<string | null> {
  const result = await driver.query<{ consrc: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS consrc
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = $1
       AND c.conname = $2
       AND c.contype = 'c'`,
    [tableName, constraintName],
  );
  return result.rows[0]?.consrc ?? null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enum check-constraint — end-to-end PGlite', { concurrent: false }, () => {
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

  it('creates table with CHECK constraint for enum-restricted column', {
    timeout: testTimeout,
  }, async () => {
    const contract = makeRoleContract([
      { name: 'User', value: 'user' },
      { name: 'Admin', value: 'admin' },
    ]);

    // Apply the initial migration from an empty schema
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const result = planner.plan({
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
    if (result.kind !== 'success') {
      throw new Error(`Planner failed: ${JSON.stringify(result, null, 2)}`);
    }
    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: result.plan.spaceId ?? APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }

    // The wire-named check must exist, installed inline by CREATE TABLE.
    const { name } = declaredCheck(contract);
    expect(name).toMatch(/^User_role_check_[0-9a-f]{8}$/);
    const constraintDef = await queryPgConstraint(driver!, 'User', name);
    expect(constraintDef).not.toBeNull();
    // Postgres reprints 'role IN (...)' as 'role = ANY (ARRAY[...])'; the
    // exact body is observed output, not a transcription of the authored text.
    expect(constraintDef).toBe(`CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))`);

    // Nothing installed it after the fact: the table came with it.
    const addOps = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(addOps.filter((id) => id.startsWith('checkConstraint.'))).toEqual([]);
  });

  it('db verify passes after initial migration', { timeout: testTimeout }, async () => {
    const contract = makeRoleContract([
      { name: 'User', value: 'user' },
      { name: 'Admin', value: 'admin' },
    ]);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const result = planner.plan({
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
    if (result.kind !== 'success') throw new Error('Planner failed');
    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: result.plan.spaceId ?? APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok)
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);

    const verifyResult = await verifySchema(driver!, contract);
    expect(verifyResult.ok).toBe(true);
    expect(
      verifyResult.schema.issues.filter((i) => i.path[i.path.length - 1]?.startsWith('check:')),
    ).toHaveLength(0);
  });

  it('enforces the constraint: permitted value succeeds, non-member value is rejected', {
    timeout: testTimeout,
  }, async () => {
    const contract = makeRoleContract([
      { name: 'User', value: 'user' },
      { name: 'Admin', value: 'admin' },
    ]);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const result = planner.plan({
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
    if (result.kind !== 'success') throw new Error('Planner failed');
    await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: result.plan.spaceId ?? APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    // Permitted value must succeed
    await expect(
      driver!.query(`INSERT INTO "User" (id, role) VALUES ('alice', 'user')`),
    ).resolves.toBeDefined();

    // Non-member value must be rejected by the check constraint
    await expect(
      driver!.query(`INSERT INTO "User" (id, role) VALUES ('bob', 'superadmin')`),
    ).rejects.toThrow();
  });

  it('re-plans drop+recreate when enum members change, and new value set is enforced', {
    timeout: testTimeout,
  }, async () => {
    // --- v1: ['user', 'admin'] ---
    const v1Contract = makeRoleContract([
      { name: 'User', value: 'user' },
      { name: 'Admin', value: 'admin' },
    ]);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const v1Result = planner.plan({
      contract: v1Contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (v1Result.kind !== 'success') throw new Error('v1 planner failed');
    const v1ExecResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: v1Result.plan.spaceId ?? APP_SPACE_ID,
          plan: v1Result.plan,
          migrationEdges: synthEdges(v1Result.plan),
          driver: driver!,
          destinationContract: v1Contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!v1ExecResult.ok)
      throw new Error(`v1 runner failed:\n${formatRunnerFailure(v1ExecResult.failure)}`);

    // Insert a row with 'user' role before the member change
    await driver!.query(`INSERT INTO "User" (id, role) VALUES ('alice', 'user')`);

    // --- v2: add 'guest', remove 'admin' → drop+recreate the check ---
    const v2Contract = makeRoleContract([
      { name: 'User', value: 'user' },
      { name: 'Guest', value: 'guest' },
    ]);

    const v2Schema = await familyInstance.introspect({ driver: driver!, contract: v1Contract });
    const v2PlanResult = planner.plan({
      contract: v2Contract,
      schema: v2Schema,
      policy: FULL_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (v2PlanResult.kind !== 'success') {
      throw new Error(`v2 planner failed: ${JSON.stringify(v2PlanResult, null, 2)}`);
    }

    // Changing the member set changes the predicate, so the hash — and with it
    // the physical name — changes: the plan drops the old wire name and adds
    // the new one.
    const v1Name = declaredCheck(v1Contract).name;
    const v2Name = declaredCheck(v2Contract).name;
    expect(v2Name).not.toBe(v1Name);
    const resolvedOps = await Promise.all(v2PlanResult.plan.operations);
    const opIds = resolvedOps.map((op) => op.id);
    expect(opIds).toContain(`dropCheckConstraint.User.${v1Name}`);
    expect(opIds).toContain(`checkConstraint.User.${v2Name}`);

    const v2ExecResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: v2PlanResult.plan.spaceId ?? APP_SPACE_ID,
          plan: v2PlanResult.plan,
          migrationEdges: synthEdges(v2PlanResult.plan),
          driver: driver!,
          destinationContract: v2Contract,
          policy: FULL_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!v2ExecResult.ok) {
      throw new Error(`v2 runner failed:\n${formatRunnerFailure(v2ExecResult.failure)}`);
    }

    // Verify passes for v2 contract
    const verifyResult = await verifySchema(driver!, v2Contract);
    expect(verifyResult.ok).toBe(true);
    expect(
      verifyResult.schema.issues.filter((i) => i.path[i.path.length - 1]?.startsWith('check:')),
    ).toHaveLength(0);

    // New permitted value ('guest') must succeed
    await expect(
      driver!.query(`INSERT INTO "User" (id, role) VALUES ('charlie', 'guest')`),
    ).resolves.toBeDefined();

    // Old member ('admin') must now be rejected
    await expect(
      driver!.query(`INSERT INTO "User" (id, role) VALUES ('dave', 'admin')`),
    ).rejects.toThrow();

    // Previously valid row with 'user' still exists (add-only data path for alice's row)
    const rows = await driver!.query<{ id: string; role: string }>(`SELECT id, role FROM "User"`);
    expect(rows.rows.some((r) => r.id === 'alice' && r.role === 'user')).toBe(true);
  });
});
