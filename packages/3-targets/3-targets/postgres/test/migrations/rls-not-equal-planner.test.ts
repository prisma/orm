/**
 * A `not-equal` policy issue — reachable once exact-named (prefix-absent)
 * policies compare by content — maps to drop + create: the drop is
 * destructive-gated, and without the destructive allowance the plan fails
 * with the existing disallowed-call conflict instead of silently skipping
 * the drift.
 */

import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationOperationClass } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
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
const EXACT_NAME = 'Tenant members can read';
const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const ALL_CLASSES_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};
const NO_DESTRUCTIVE_POLICY = { allowedOperationClasses: ['additive', 'widening'] as const };

function exactPolicy(using: string): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: { kind: 'exact', name: EXACT_NAME },
    tableName: TABLE_NAME,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using,
    permissive: true,
    withCheck: undefined,
  });
}

function buildContract(
  policy: PostgresRlsPolicy,
  tableControl?: 'managed' | 'tolerated' | 'external' | 'observed',
): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            tenant_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          ...(tableControl !== undefined ? { control: tableControl } : {}),
        }),
      },
      policy: { [policy.name]: policy },
      rls: {
        [TABLE_NAME]: new PostgresRlsEnablement({ tableName: TABLE_NAME, namespaceId: 'public' }),
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('rls-not-equal-planner-test'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-not-equal-planner-test'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function actualSchema(
  livePolicy: PostgresRlsPolicy,
  options?: { readonly extraColumn?: boolean },
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [TABLE_NAME]: new PostgresTableSchemaNode({
            name: TABLE_NAME,
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              tenant_id: { name: 'tenant_id', nativeType: 'int4', nullable: false },
              ...(options?.extraColumn
                ? { stale: { name: 'stale', nativeType: 'int4', nullable: true } }
                : {}),
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            rlsEnabled: true,
            policies: [
              new PostgresPolicySchemaNode({
                naming: { kind: 'exact', name: livePolicy.name },
                tableName: livePolicy.tableName,
                namespaceId: 'public',
                operation: livePolicy.operation,
                roles: [...livePolicy.roles],
                using: livePolicy.using,
                permissive: livePolicy.permissive,
                withCheck: undefined,
                dependsOn: undefined,
              }),
            ],
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

describe('not-equal policy issue (exact-mode content drift)', () => {
  it('maps to drop + create under a destructive-allowed policy', async () => {
    const contract = buildContract(exactPolicy('(tenant_id = 1)'));
    const schema = actualSchema(exactPolicy('(tenant_id = 2)'));

    const result = plan(contract, schema, ALL_CLASSES_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual([
      `rlsPolicy.public.${TABLE_NAME}.${EXACT_NAME}.drop`,
      `rlsPolicy.public.${TABLE_NAME}.${EXACT_NAME}`,
    ]);
  });

  it('fails with the policy-incompatible conflict, naming the policy structurally, when destructive is not allowed', () => {
    const contract = buildContract(exactPolicy('(tenant_id = 1)'));
    const schema = actualSchema(exactPolicy('(tenant_id = 2)'));

    const result = plan(contract, schema, NO_DESTRUCTIVE_POLICY);
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        kind: 'rlsPolicyIncompatible',
        summary: expect.stringContaining(EXACT_NAME),
        location: expect.objectContaining({
          entityKind: 'table',
          entityName: TABLE_NAME,
          rlsPolicy: EXACT_NAME,
        }),
      }),
    );
  });

  it('an unchanged exact policy plans nothing', async () => {
    const contract = buildContract(exactPolicy('(tenant_id = 1)'));
    const schema = actualSchema(exactPolicy('(tenant_id = 1)'));

    const result = plan(contract, schema, ALL_CLASSES_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual([]);
  });

  it('composes the policy conflict with relational conflicts in one failure', () => {
    const contract = buildContract(exactPolicy('(tenant_id = 1)'));
    const schema = actualSchema(exactPolicy('(tenant_id = 2)'), { extraColumn: true });

    const result = plan(contract, schema, NO_DESTRUCTIVE_POLICY);
    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ summary: expect.stringContaining('stale') }),
    );
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        kind: 'rlsPolicyIncompatible',
        summary: expect.stringContaining(EXACT_NAME),
      }),
    );
  });
});

describe('not-equal policy under non-managed control policies', () => {
  it.each(['external', 'observed'] as const)(
    'drift on an %s table never fails the plan — zero policy DDL, one suppression warning',
    async (control) => {
      const contract = buildContract(exactPolicy('(tenant_id = 1)'), control);
      const schema = actualSchema(exactPolicy('(tenant_id = 2)'));

      const result = plan(contract, schema, ALL_CLASSES_POLICY);
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;
      const ops = await Promise.all(result.plan.operations);
      expect(ops.map((op) => op.id)).toEqual([]);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          kind: 'controlPolicySuppressedCall',
          summary: expect.stringContaining(`RLS policy "${EXACT_NAME}"`),
          location: expect.objectContaining({ rlsPolicy: EXACT_NAME }),
        }),
      );
      expect(result.warnings?.[0]?.summary).toContain(`'${control}'`);
    },
  );

  it('under tolerated the replacement pair is suppressed as one unit — no orphaned CREATE', async () => {
    const contract = buildContract(exactPolicy('(tenant_id = 1)'), 'tolerated');
    const schema = actualSchema(exactPolicy('(tenant_id = 2)'));

    const result = plan(contract, schema, ALL_CLASSES_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'controlPolicySuppressedCall',
        summary: expect.stringContaining(`RLS policy "${EXACT_NAME}"`),
        location: expect.objectContaining({ rlsPolicy: EXACT_NAME }),
      }),
    );
  });

  it('a suppressed relational change and a suppressed policy replacement on one table are two distinguishable warnings', async () => {
    const contract = buildContract(exactPolicy('(tenant_id = 1)'), 'tolerated');
    const schema = actualSchema(exactPolicy('(tenant_id = 2)'), { extraColumn: true });

    const result = plan(contract, schema, ALL_CLASSES_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const suppressions = (result.warnings ?? []).filter(
      (w) => w.kind === 'controlPolicySuppressedCall',
    );
    expect(suppressions).toHaveLength(2);
    const summaries = suppressions.map((w) => w.summary);
    expect(summaries.filter((x) => x.includes(`RLS policy "${EXACT_NAME}"`))).toHaveLength(1);
    expect(new Set(summaries).size).toBe(2);
  });

  it('tolerated drift without the destructive allowance is still a suppression, not a conflict', async () => {
    const contract = buildContract(exactPolicy('(tenant_id = 1)'), 'tolerated');
    const schema = actualSchema(exactPolicy('(tenant_id = 2)'));

    const result = plan(contract, schema, NO_DESTRUCTIVE_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'controlPolicySuppressedCall',
        summary: expect.stringContaining("'tolerated'"),
      }),
    );
  });
});
