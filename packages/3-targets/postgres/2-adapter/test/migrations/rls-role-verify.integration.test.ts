/**
 * Roles enter verify (slice 4, W3): existence-only, asymmetric.
 *
 * AC-4: a role the contract declares but the live database lacks fails
 *       `db verify`, naming the role, under BOTH `external` and `managed`.
 * AC-5: a role present in the live database that the contract does not declare
 *       verifies clean under every control policy, including `managed` — the
 *       framework references but does not own the cluster's role list.
 */

import { type Contract, type ControlPolicy, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { PostgresRole, PostgresSchema } from '@internal/target-postgres/types';
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

const TABLE_NAME = 'profiles';

function buildContract(input: {
  readonly roleNames: readonly string[];
  readonly defaultControlPolicy?: ControlPolicy;
  readonly hashSeed: string;
}): Contract<SqlStorage> {
  const roleEntries: Record<string, PostgresRole> = {};
  for (const name of input.roleNames) {
    roleEntries[name] = new PostgresRole({ name, namespaceId: UNBOUND_NAMESPACE_ID });
  }
  const schema = new PostgresSchema({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            user_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      role: roleEntries,
    },
  });

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(`${input.hashSeed}`),
    storage: new SqlStorage({
      storageHash: coreHash(`${input.hashSeed}`),
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    ...(input.defaultControlPolicy !== undefined
      ? { defaultControlPolicy: input.defaultControlPolicy }
      : {}),
  };
}

describe('roles enter verify — existence-only, asymmetric', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
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

  // Applies a contract's TABLE only — role provisioning is a non-goal, so the
  // planner emits zero role ops and no role is created in the database.
  async function applyContract(
    d: PostgresControlDriver,
    contract: Contract<SqlStorage>,
  ): Promise<void> {
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
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
    if (planResult.kind !== 'success') throw new Error(`Planner failed: ${planResult.kind}`);
    const executeResult = await runner.execute({
      driver: d,
      perSpaceOptions: [
        {
          space: planResult.plan.spaceId ?? APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: d,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok)
      throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }

  it('AC-4: a declared role missing from the database fails verify under external, managed, AND observed, naming the role', {
    timeout: testTimeout,
  }, async () => {
    // Apply a role-free contract so only the table is created (the runner's own
    // post-apply verify would otherwise fail on the un-provisioned role — which
    // is exactly the behavior AC-4 pins). The live DB then lacks `app_role`.
    const applied = buildContract({ roleNames: [], hashSeed: 'role-missing-apply' });
    await applyContract(driver!, applied);

    const schema = await familyInstance.introspect({ driver: driver!, contract: applied });

    // Roles resolve unconditionally to the `external` control policy, so a
    // missing declared role fails even under `observed` — deviating from
    // the usual observed→warn convention for other node kinds.
    for (const controlPolicy of ['external', 'managed', 'observed'] as const) {
      const contract = buildContract({
        roleNames: ['app_role'],
        defaultControlPolicy: controlPolicy,
        hashSeed: `role-missing-${controlPolicy}`,
      });
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: false,
        frameworkComponents,
      });
      expect(result.ok).toBe(false);
      const roleFailure = result.schema.issues.find(
        (i) => issueOutcome(i) === 'not-found' && i.path.includes('app_role'),
      );
      expect(roleFailure).toBeDefined();
    }
  });

  it('AC-5: an undeclared live role verifies clean under every control policy including managed, and is never a failure', {
    timeout: testTimeout,
  }, async () => {
    // Apply a role-free contract, then create an undeclared live role.
    const applied = buildContract({ roleNames: [], hashSeed: 'role-extra-apply' });
    await applyContract(driver!, applied);
    await driver!.query('CREATE ROLE legacy_role');

    const schema = await familyInstance.introspect({ driver: driver!, contract: applied });

    for (const controlPolicy of ['external', 'managed', 'tolerated', 'observed'] as const) {
      const contract = buildContract({
        roleNames: [],
        defaultControlPolicy: controlPolicy,
        hashSeed: `role-extra-${controlPolicy}`,
      });
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: false,
        frameworkComponents,
      });
      // A role issue always resolves to the `external` control policy, whose
      // disposition suppresses every extra — so the undeclared role is
      // neither a failure nor a warning under ANY control policy, and
      // verify passes.
      expect(result.schema.issues.some((i) => i.path.includes('legacy_role'))).toBe(false);
      expect(
        (result.schema.warnings?.issues ?? []).some((i) => i.path.includes('legacy_role')),
      ).toBe(false);
      expect(result.ok).toBe(true);
    }
  });
});
