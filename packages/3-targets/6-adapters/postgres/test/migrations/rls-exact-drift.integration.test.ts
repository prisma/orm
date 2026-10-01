/**
 * Out-of-band `ALTER POLICY` changing the body under the same EXACT name
 * is drift — verify reports `not-equal`; a
 * destructive-allowed plan replaces the policy (drop before create under the
 * same name); without the destructive allowance the plan fails with the
 * disallowed-call conflict naming the policy. The contrast case: the same
 * out-of-band body edit on a WIRE-NAMED policy stays invisible to `isEqualTo`
 * — hash identity, a deliberate property (the wire name commits to the
 * content, so a same-named wire-named policy is by definition unchanged).
 */
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { APP_SPACE_ID, issueOutcome } from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import { computeContentHash } from '@internal/target-postgres/rls-canonicalize';
import {
  PostgresRlsEnablement,
  PostgresRlsPolicy,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const EXACT_NAME = 'Tenant members can read';
const BODY = '(tenant_id = 1)';
const ALL_CLASSES_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};
const ADDITIVE_ONLY_POLICY = { allowedOperationClasses: ['additive'] as const };

const WIRE_NAME = `tenant_read_${computeContentHash({
  using: BODY,
  roles: ['app_user'],
  operation: 'select',
  permissive: true,
})}`;

function buildContract(policyName: string, prefix?: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('rls-exact-drift'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-exact-drift'),
      namespaces: {
        public: postgresCreateNamespace({
          id: asNamespaceId('public'),
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  tenant_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
            policy: {
              [policyName]: new PostgresRlsPolicy({
                naming: parseNaming(policyName, prefix),
                tableName: 'user',
                namespaceId: 'public',
                operation: 'select',
                roles: ['app_user'],
                using: BODY,
                withCheck: undefined,
                permissive: true,
              }),
            },
            rls: {
              user: new PostgresRlsEnablement({ tableName: 'user', namespaceId: 'public' }),
            },
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

async function createLivePolicy(driver: PostgresControlDriver, name: string): Promise<void> {
  await driver.query('CREATE TABLE "user" (id int4 PRIMARY KEY, tenant_id int4 NOT NULL)');
  await driver.query('ALTER TABLE "user" ENABLE ROW LEVEL SECURITY');
  await driver.query(
    `CREATE POLICY "${name}" ON "user" AS PERMISSIVE FOR SELECT TO app_user USING ${BODY}`,
  );
}

describe('out-of-band body drift on an exact-named policy', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
    const bootstrap = await createDriver(database.connectionString);
    await bootstrap.query('CREATE ROLE app_user');
    await bootstrap.close();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
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

  it('verify is clean before the ALTER and reports not-equal after it', {
    timeout: testTimeout,
  }, async () => {
    await createLivePolicy(driver!, EXACT_NAME);
    const contract = buildContract(EXACT_NAME);

    const clean = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      strict: false,
      frameworkComponents,
    });
    expect(clean.schema.issues).toEqual([]);
    expect(clean.ok).toBe(true);

    await driver!.query(`ALTER POLICY "${EXACT_NAME}" ON "user" USING (tenant_id = 2)`);

    const drifted = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      strict: false,
      frameworkComponents,
    });
    expect(drifted.ok).toBe(false);
    const notEqual = drifted.schema.issues.filter(
      (issue) =>
        issueOutcome(issue) === 'not-equal' && issue.path.some((p) => p.includes(EXACT_NAME)),
    );
    expect(notEqual.length).toBeGreaterThan(0);
  });

  it('a widening-allowed plan replaces the drifted policy: drop before create, same name', {
    timeout: testTimeout,
  }, async () => {
    await createLivePolicy(driver!, EXACT_NAME);
    await driver!.query(`ALTER POLICY "${EXACT_NAME}" ON "user" USING (tenant_id = 2)`);
    const contract = buildContract(EXACT_NAME);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const result = planner.plan({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      policy: { allowedOperationClasses: [...ALL_CLASSES_POLICY.allowedOperationClasses] },
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual([
      `rlsPolicy.public.user.${EXACT_NAME}.drop`,
      `rlsPolicy.public.user.${EXACT_NAME}`,
    ]);
  });

  it('without the widening allowance the plan fails with the conflict naming the policy', {
    timeout: testTimeout,
  }, async () => {
    await createLivePolicy(driver!, EXACT_NAME);
    await driver!.query(`ALTER POLICY "${EXACT_NAME}" ON "user" USING (tenant_id = 2)`);
    const contract = buildContract(EXACT_NAME);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const result = planner.plan({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      policy: { allowedOperationClasses: [...ADDITIVE_ONLY_POLICY.allowedOperationClasses] },
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        kind: 'rlsPolicyIncompatible',
        summary: expect.stringContaining(EXACT_NAME),
        location: expect.objectContaining({ rlsPolicy: EXACT_NAME }),
      }),
    );
  });

  it('the same body drift on a WIRE-NAMED policy stays invisible to isEqualTo (hash identity — deliberate)', {
    timeout: testTimeout,
  }, async () => {
    await createLivePolicy(driver!, WIRE_NAME);
    await driver!.query(`ALTER POLICY "${WIRE_NAME}" ON "user" USING (tenant_id = 2)`);
    const contract = buildContract(WIRE_NAME, 'tenant_read');

    const result = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver: driver!, contract }),
      strict: false,
      frameworkComponents,
    });
    expect(result.schema.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
