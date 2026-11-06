import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
} from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { postgresDataTypeSupport } from '../helpers/postgres-data-type-support';
import {
  controlAdapter,
  frameworkComponents,
  postgresTargetDescriptor,
} from './fixtures/runner-fixtures';

const postgresCodecLookup = createPostgresBuiltinCodecLookup();

// `migration plan` runs offline (no live database): it derives the schema from
// the contract via the target's `contractToSchema` hook and plans against it.
// That derivation carries the contract's RLS policies, so the plan emits
// ENABLE ROW LEVEL SECURITY + CREATE POLICY.

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
    using  = sql\`owner_id = current_setting('app.uid')::int\`
  }
}
`;

// A `policy_update` with both predicates — proves the contract → plan → render
// path threads `withCheck` through for a non-select operation.
const PSL_UPDATE = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_update p_write {
    target    = profile
    roles     = [app_user]
    using     = sql\`owner_id = current_setting('app.uid')::int\`
    withCheck = sql\`owner_id = current_setting('app.uid')::int\`
  }
}
`;

function buildPslContract(psl: string = PSL) {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);
  const bound = bindPslSchema(psl, {
    sourceId: 'rls-migration-plan.integration.test.psl',
    context: {
      composedExtensions: [],
      defaultNamespaceId: 'public',
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: postgresCodecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
      dataTypes: postgresDataTypeSupport,
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: {
        kind: 'target' as const,
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        id: 'postgres',
        version: postgresTargetDescriptor.version,
        capabilities: {},
        defaultNamespaceId: 'public',
      },
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

describe('migration plan emits RLS (offline, no live database)', () => {
  it('derives a PostgresDatabaseSchemaNode from the contract and plans CREATE POLICY + ENABLE RLS', async () => {
    const result = buildPslContract();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contract = result.value as Contract<SqlStorage>;

    // The initial `migration plan` derives the "from" schema from a null
    // contract (no prior state) — an empty PostgresDatabaseSchemaNode. The differ
    // then reports the contract's policy as missing → CREATE POLICY.
    const fromSchema = postgresTargetDescriptor.migrations.contractToSchema(
      null,
      frameworkComponents,
    ) as SqlSchemaIRNode;
    PostgresDatabaseSchemaNode.assert(fromSchema);
    const allPolicies = Object.values(fromSchema.namespaces).flatMap((ns) =>
      Object.values(ns.tables).flatMap((t) => t.policies),
    );
    expect(allPolicies).toEqual([]);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema: fromSchema,
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

    expect(allSql.some((s) => s.includes('ENABLE ROW LEVEL SECURITY'))).toBe(true);
    expect(allSql.some((s) => s.includes('CREATE POLICY'))).toBe(true);
  });

  it('plans FOR UPDATE with both USING and WITH CHECK for a policy_update contract', async () => {
    const result = buildPslContract(PSL_UPDATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contract = result.value as Contract<SqlStorage>;
    const fromSchema = postgresTargetDescriptor.migrations.contractToSchema(
      null,
      frameworkComponents,
    ) as SqlSchemaIRNode;
    PostgresDatabaseSchemaNode.assert(fromSchema);

    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema: fromSchema,
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
    const createPolicySql = ops
      .flatMap((op) => op.execute)
      .map((step) => step.sql)
      .find((s) => s.includes('CREATE POLICY'));

    expect(createPolicySql).toBeDefined();
    expect(createPolicySql).toContain('FOR UPDATE');
    expect(createPolicySql).toContain("USING (owner_id = current_setting('app.uid')::int)");
    expect(createPolicySql).toContain("WITH CHECK (owner_id = current_setting('app.uid')::int)");
    // USING must precede WITH CHECK.
    expect(createPolicySql!.indexOf('USING')).toBeLessThan(createPolicySql!.indexOf('WITH CHECK'));
  });
});
