import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
} from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  PostgresRlsPolicy,
  PostgresSchema,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresScalarAuthoringTypes } from '../../src/core/control-mutation-defaults';
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

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

// ============================================================================
// PSL source — the author-facing input
// ============================================================================

const PSL = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

// ============================================================================
// PSL → contract
// ============================================================================

function buildScalarTypeDescriptors(): ReadonlyMap<
  string,
  { codecId: string; nativeType: string }
> {
  return collectScalarTypeConstructors(postgresScalarAuthoringTypes);
}

function buildPslContract() {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);
  const scalarColumnDescriptors = buildScalarTypeDescriptors();

  const { document, sources } = parse(PSL, 'rls-walking-skeleton-psl.integration.test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });

  return interpretPslDocumentToSqlContract({
    dataTypeLookup: postgresDataTypeLookup,
    document,
    symbolTable,
    sources,
    target: {
      kind: 'target' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'postgres',
      version: postgresTargetDescriptor.version,
      capabilities: {},
      defaultNamespaceId: 'public',
    },
    scalarColumnDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

// ============================================================================
// PSL walking-skeleton test
// ============================================================================

describe('RLS walking skeleton — PSL author → plan → apply → filter → verify', {
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
    'PSL lowers to a contract with a policy entry in the public namespace',
    () => {
      const result = buildPslContract();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const ns = result.value.storage.namespaces['public'] as PostgresSchema;
      expect(ns).toBeInstanceOf(PostgresSchema);
      expect(Object.keys(ns.policy)).toHaveLength(1);

      const [policyKey] = Object.keys(ns.policy);
      const policy = ns.policy[policyKey!]!;
      expect(policy).toBeInstanceOf(PostgresRlsPolicy);
      expect(policy.operation).toBe('select');
      expect(policy.permissive).toBe(true);
      expect(policy.namespaceId).toBe('public');
      expect(policy.tableName).toBe('profile');
      expect(policy.roles).toEqual(['app_user']);
      expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
      expect(policy.prefix).toBe('p_read');
      expect(policy.name).toMatch(/^p_read_[0-9a-f]{8}$/);
    },
    testTimeout,
  );

  it(
    'applies an RLS policy authored in PSL, enforces row isolation under SET ROLE, and re-verifies clean',
    async () => {
      const result = buildPslContract();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contract = result.value as Contract<SqlStorage>;

      // Pre-create the role — role creation is out of scope for the planner.
      await driver.query('CREATE ROLE app_user');

      // Plan against empty schema.
      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const planResult = planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
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

      expect(allSql.some((s) => s.includes('CREATE TABLE'))).toBe(true);
      expect(allSql.some((s) => s.includes('ENABLE ROW LEVEL SECURITY'))).toBe(true);
      expect(allSql.some((s) => s.includes('CREATE POLICY'))).toBe(true);

      // Apply all operations.
      for (const op of ops) {
        for (const step of [...op.precheck, ...op.execute, ...op.postcheck]) {
          await driver.query(step.sql, step.params ?? []);
        }
      }

      // Insert two rows with different owner_id values.
      await driver.query(`INSERT INTO "public"."profile" (id, owner_id) VALUES (1, 101), (2, 202)`);

      // Grant SELECT so app_user can read the table.
      await driver.query(`GRANT SELECT ON "public"."profile" TO app_user`);

      // Switch to app_user and set the GUC to owner of row 1.
      await driver.query('SET ROLE app_user');
      await driver.query(`SELECT set_config('app.uid', '101', false)`);

      const filtered = await driver.query<{ id: number; owner_id: number }>(
        `SELECT id, owner_id FROM "public"."profile"`,
      );

      await driver.query('RESET ROLE');

      // Only row 1 (owner_id=101) should be visible.
      expect(filtered.rows).toHaveLength(1);
      expect(filtered.rows[0]).toMatchObject({ id: 1, owner_id: 101 });

      // Re-verify clean — no RLS policy issues.
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
