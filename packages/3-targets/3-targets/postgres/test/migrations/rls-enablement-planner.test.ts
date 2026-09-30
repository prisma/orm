/**
 * Marker-driven enablement planning: `ENABLE`/`DISABLE ROW LEVEL SECURITY`
 * derive from the table's `rlsEnabled` attribute diff (the contract marker vs
 * `pg_class.relrowsecurity`) — never from the policy set. Pins the
 * pre-investigated edges: in-sync-policies-but-RLS-off re-enables, marker
 * removal disables under the destructive allowance and surfaces a conflict
 * without it, a marker with zero policies enables (deny-all), last-policy
 * removal plans no enablement change, and external tables suppress both
 * directions with a warning.
 */

import type { ControlPolicy } from '@internal/contract/types';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationOperationClass } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { namingOfLiveName, parseNaming } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const TABLE_NAME = 'profiles';
const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const ALL_CLASSES_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};
const NO_DESTRUCTIVE_POLICY = { allowedOperationClasses: ['additive', 'widening'] as const };
const ADDITIVE_ONLY_POLICY = { allowedOperationClasses: ['additive'] as const };

function contractPolicy(name: string): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: namingOfLiveName(name),
    tableName: TABLE_NAME,
    namespaceId: 'public',
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
    withCheck: undefined,
  });
}

function buildContract(options: {
  readonly marked: boolean;
  readonly policies?: readonly PostgresRlsPolicy[];
  readonly control?: ControlPolicy;
}): Contract<SqlStorage> {
  const policyEntries: Record<string, PostgresRlsPolicy> = {};
  for (const policy of options.policies ?? []) {
    policyEntries[policy.name] = policy;
  }
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          ...(options.control !== undefined ? { control: options.control } : {}),
        }),
      },
      policy: policyEntries,
      rls: options.marked
        ? {
            [TABLE_NAME]: new PostgresRlsEnablement({
              tableName: TABLE_NAME,
              namespaceId: 'public',
            }),
          }
        : {},
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('rls-enablement-planner-test'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-enablement-planner-test'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function actualSchema(options: {
  readonly rlsEnabled: boolean;
  readonly policies?: readonly PostgresRlsPolicy[];
}): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [TABLE_NAME]: new PostgresTableSchemaNode({
            name: TABLE_NAME,
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            rlsEnabled: options.rlsEnabled,
            policies: (options.policies ?? []).map(
              (policy) =>
                new PostgresPolicySchemaNode({
                  naming: parseNaming(policy.name, policy.prefix),
                  tableName: policy.tableName,
                  namespaceId: 'public',
                  operation: policy.operation,
                  roles: [...policy.roles],
                  using: policy.using,
                  permissive: policy.permissive,
                  withCheck: policy.withCheck,
                  dependsOn: undefined,
                }),
            ),
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

function plan(
  contract: Contract<SqlStorage>,
  schema: PostgresDatabaseSchemaNode,
  policy: { readonly allowedOperationClasses: readonly MigrationOperationClass[] },
) {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  return planner.plan({
    contract,
    schema,
    policy: { allowedOperationClasses: [...policy.allowedOperationClasses] },
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

async function opIdsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  const ops = await Promise.all(result.plan.operations);
  return ops.map((op) => op.id);
}

describe('marker-driven ENABLE', () => {
  it('plans ENABLE when policies are in sync but RLS is off (the edge the imperative path missed)', async () => {
    const policy = contractPolicy('p_read_ab12cd34');
    const contract = buildContract({ marked: true, policies: [policy] });
    const schema = actualSchema({ rlsEnabled: false, policies: [policy] });

    const opIds = await opIdsOf(plan(contract, schema, ALL_CLASSES_POLICY));
    expect(opIds).toEqual([`rowLevelSecurity.public.${TABLE_NAME}`]);
  });

  it('plans ENABLE under an additive-only policy (enable is additive)', async () => {
    const policy = contractPolicy('p_read_ab12cd34');
    const contract = buildContract({ marked: true, policies: [policy] });
    const schema = actualSchema({ rlsEnabled: false, policies: [policy] });

    const opIds = await opIdsOf(plan(contract, schema, ADDITIVE_ONLY_POLICY));
    expect(opIds).toEqual([`rowLevelSecurity.public.${TABLE_NAME}`]);
  });

  it('plans ENABLE for a marker with zero policies (deny-all is the point of fail-closed)', async () => {
    const contract = buildContract({ marked: true });
    const schema = actualSchema({ rlsEnabled: false });

    const opIds = await opIdsOf(plan(contract, schema, ALL_CLASSES_POLICY));
    expect(opIds).toEqual([`rowLevelSecurity.public.${TABLE_NAME}`]);
  });
});

describe('marker-removal DISABLE', () => {
  it('plans DISABLE when the marker is removed and the destructive allowance is present', async () => {
    const contract = buildContract({ marked: false });
    const schema = actualSchema({ rlsEnabled: true });

    const opIds = await opIdsOf(plan(contract, schema, ALL_CLASSES_POLICY));
    expect(opIds).toEqual([`rowLevelSecurity.public.${TABLE_NAME}.disable`]);
  });

  it('surfaces a conflict (not a silent skip) when the destructive allowance is absent', () => {
    const contract = buildContract({ marked: false });
    const schema = actualSchema({ rlsEnabled: true });

    const result = plan(contract, schema, NO_DESTRUCTIVE_POLICY);
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        summary: expect.stringContaining('Disable row-level security'),
      }),
    );
  });
});

describe('enablement neutrality', () => {
  it('plans no enablement op when removing the last policy on a marked table (fail-closed)', async () => {
    const livePolicy = contractPolicy('p_read_ab12cd34');
    const contract = buildContract({ marked: true });
    const schema = actualSchema({ rlsEnabled: true, policies: [livePolicy] });

    const opIds = await opIdsOf(plan(contract, schema, ALL_CLASSES_POLICY));
    expect(opIds).toEqual([`rlsPolicy.public.${TABLE_NAME}.p_read_ab12cd34.drop`]);
  });

  it('plans nothing when marker and live enablement agree', async () => {
    const contract = buildContract({ marked: true });
    const schema = actualSchema({ rlsEnabled: true });

    const opIds = await opIdsOf(plan(contract, schema, ALL_CLASSES_POLICY));
    expect(opIds).toEqual([]);
  });
});

describe('tolerated-table grading', () => {
  it('plans ENABLE on an existing tolerated table (enablement is creation-class, like the policy set it guards)', async () => {
    const policy = contractPolicy('p_read_ab12cd34');
    const contract = buildContract({ marked: true, policies: [policy], control: 'tolerated' });
    const schema = actualSchema({ rlsEnabled: false, policies: [policy] });

    const opIds = await opIdsOf(plan(contract, schema, ALL_CLASSES_POLICY));
    expect(opIds).toEqual([`rowLevelSecurity.public.${TABLE_NAME}`]);
  });

  it('creates the policy set AND enables RLS together on a tolerated table', async () => {
    const policy = contractPolicy('p_read_ab12cd34');
    const contract = buildContract({ marked: true, policies: [policy], control: 'tolerated' });
    const schema = actualSchema({ rlsEnabled: false });

    const opIds = await opIdsOf(plan(contract, schema, ALL_CLASSES_POLICY));
    expect(opIds).toEqual([
      `rowLevelSecurity.public.${TABLE_NAME}`,
      `rlsPolicy.public.${TABLE_NAME}.p_read_ab12cd34`,
    ]);
  });

  it('never plans DISABLE on a tolerated table (marker removal suppresses with a warning)', async () => {
    const contract = buildContract({ marked: false, control: 'tolerated' });
    const schema = actualSchema({ rlsEnabled: true });

    const result = plan(contract, schema, ALL_CLASSES_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops).toEqual([]);
    expect(result.warnings ?? []).not.toEqual([]);
  });
});

describe('external-table grading', () => {
  it('plans nothing for an external table with RLS on and no marker, surfacing a suppression warning', async () => {
    const contract = buildContract({ marked: false, control: 'external' });
    const schema = actualSchema({ rlsEnabled: true });

    const result = plan(contract, schema, ALL_CLASSES_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops).toEqual([]);
    expect(result.warnings ?? []).not.toEqual([]);
  });

  it('plans nothing for an external marked table with RLS off, surfacing a suppression warning', async () => {
    const contract = buildContract({ marked: true, control: 'external' });
    const schema = actualSchema({ rlsEnabled: false });

    const result = plan(contract, schema, ALL_CLASSES_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops).toEqual([]);
    expect(result.warnings ?? []).not.toEqual([]);
  });
});
