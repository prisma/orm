/**
 * Verify half of the managed/external grading matrix. Enablement drift is a
 * table `not-equal` issue and flows through the generic verdict as
 * `declaredIncompatible`, graded per the table's control policy: managed
 * fails, external suppresses. Policy drift (missing / extra / the two halves
 * of a rename) grades the same way. No verify plumbing exists for RLS —
 * everything here rides the generic diff verdict.
 */

import type { ControlPolicy } from '@internal/contract/types';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { namingOfLiveName, parseNaming } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { diffPostgresSchema } from '../../src/core/migrations/diff-database-schema';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresDiffSubjectGranularity } from '../../src/core/schema-ir/schema-node-kinds';
import { postgresTypeComponents } from '../postgres-type-lookups';

const TABLE_NAME = 'profiles';

function policyNamed(name: string): PostgresRlsPolicy {
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
            id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            user_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
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
    profileHash: profileHash('rls-verdict-matrix-test'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-verdict-matrix-test'),
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
                  withCheck: undefined,
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

function verdictOk(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode): boolean {
  const result = verifySqlSchemaByDiff({
    contract,
    schema: actual,
    strict: true,
    frameworkComponents: postgresTypeComponents,
    diffSchema: diffPostgresSchema,
    granularityOf: postgresDiffSubjectGranularity,
  });
  return result.ok;
}

describe('enablement drift verdicts', () => {
  it('managed: marker present but live RLS off fails verify', () => {
    const contract = buildContract({ marked: true });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: false }))).toBe(false);
  });

  it('managed: no marker but live RLS on fails verify', () => {
    const contract = buildContract({ marked: false });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true }))).toBe(false);
  });

  it('managed: marker and live enablement in agreement verifies clean', () => {
    const contract = buildContract({ marked: true });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true }))).toBe(true);
  });

  it('external: enablement drift fails verify like any declared-shape divergence (plan still never emits ops)', () => {
    // The framework disposition deliberately fails existence/declared-shape
    // divergences on external subjects and suppresses only extras + value
    // drift — the same verdict an external table's column drift gets today.
    // The plan side is where external RLS is fully hands-off (the issue
    // partition suppresses enable/disable/create/drop/rename with a
    // warning; see rls-enablement-planner / rls-rename-planner).
    const unmarked = buildContract({ marked: false, control: 'external' });
    expect(verdictOk(unmarked, actualSchema({ rlsEnabled: true }))).toBe(false);
    const marked = buildContract({ marked: true, control: 'external' });
    expect(verdictOk(marked, actualSchema({ rlsEnabled: false }))).toBe(false);
  });

  it('last-policy removal end state (marker, RLS on, no policies) verifies clean', () => {
    const contract = buildContract({ marked: true });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true, policies: [] }))).toBe(true);
  });
});

describe('policy drift verdicts', () => {
  it('managed: a declared policy missing live fails verify', () => {
    const contract = buildContract({ marked: true, policies: [policyNamed('p_read_ab12cd34')] });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true }))).toBe(false);
  });

  it('managed: an undeclared live policy fails verify', () => {
    const contract = buildContract({ marked: true });
    expect(
      verdictOk(
        contract,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(false);
  });

  it('managed: a rename in flight reports as missing + extra and fails verify', () => {
    const contract = buildContract({
      marked: true,
      policies: [policyNamed('owner_read_ab12cd34')],
    });
    expect(
      verdictOk(
        contract,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(false);
  });

  it('external: an undeclared live policy suppresses (extraAuxiliary), but a declared-missing policy fails', () => {
    // Same disposition split as enablement drift: external suppresses
    // extras, and fails declared objects the database lacks — declaring a
    // policy on an external table asserts a shape the contract does not
    // manage, so verify holds it to the declaration.
    const extra = buildContract({ marked: true, control: 'external' });
    expect(
      verdictOk(
        extra,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(true);

    const missing = buildContract({
      marked: true,
      policies: [policyNamed('p_read_ab12cd34')],
      control: 'external',
    });
    expect(verdictOk(missing, actualSchema({ rlsEnabled: true }))).toBe(false);

    // A rename in flight carries a declared-missing half, so it fails too.
    const renameInFlight = buildContract({
      marked: true,
      policies: [policyNamed('owner_read_ab12cd34')],
      control: 'external',
    });
    expect(
      verdictOk(
        renameInFlight,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(false);
  });

  it('managed: matching policy set verifies clean', () => {
    const policy = policyNamed('p_read_ab12cd34');
    const contract = buildContract({ marked: true, policies: [policy] });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true, policies: [policy] }))).toBe(true);
  });
});
