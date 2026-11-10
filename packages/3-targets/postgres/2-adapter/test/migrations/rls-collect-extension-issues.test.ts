import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { issueOutcome } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { normalizeSqlBody, parseNaming } from '@internal/sql-schema-ir/naming';
import { buildPostgresPlanDiff } from '@internal/target-postgres/diff-database-schema';
import { computeContentHash } from '@internal/target-postgres/rls-canonicalize';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresPolicySchemaNode,
  PostgresRlsEnablement,
  PostgresRlsPolicy,
  PostgresSchema,
  PostgresTableSchemaNode,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

const SCHEMA_NAME = 'public';
const TABLE_NAME = 'items';
const USING = '(owner_id = current_user_id())';
const PREFIX = 'read_own';
const HASH = computeContentHash({
  using: normalizeSqlBody(USING),
  roles: ['app_user'],
  operation: 'select',
  permissive: true,
});
const WIRE_NAME = `${PREFIX}_${HASH}`;

function wireNamedPolicy(): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: parseNaming(WIRE_NAME, PREFIX),
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['app_user'],
    using: USING,
    withCheck: undefined,
    permissive: true,
  });
}

function externalPolicy(): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: { kind: 'exact', name: 'legacy_admin_policy' },
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['app_user'],
    using: USING,
    withCheck: undefined,
    permissive: true,
  });
}

function toPolicyNode(p: PostgresRlsPolicy): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    naming: parseNaming(p.name, p.prefix),
    tableName: p.tableName,
    namespaceId: p.namespaceId,
    operation: p.operation,
    roles: [...p.roles],
    using: p.using,
    withCheck: p.withCheck,
    permissive: p.permissive,
    dependsOn: undefined,
  });
}

function schemaWithPolicies(policies: PostgresRlsPolicy[]): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    extensions: undefined,
    namespaces: {
      [SCHEMA_NAME]: new PostgresNamespaceSchemaNode({
        schemaName: SCHEMA_NAME,
        tables: {
          [TABLE_NAME]: new PostgresTableSchemaNode({
            name: TABLE_NAME,
            columns: {},
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: policies.map(toPolicyNode),
            rlsEnabled: false,
          }),
        },
      }),
    },
    pgVersion: 'unknown',
    roles: [],
    existingSchemas: [SCHEMA_NAME],
  });
}

function buildContract(policies: readonly PostgresRlsPolicy[]): Contract<SqlStorage> {
  const policyEntries: Record<string, PostgresRlsPolicy> = {};
  for (const p of policies) {
    policyEntries[p.name] = p;
  }
  const schema = new PostgresSchema({
    id: SCHEMA_NAME,
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {},
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: policyEntries,
      rls: {
        [TABLE_NAME]: new PostgresRlsEnablement({
          tableName: TABLE_NAME,
          namespaceId: SCHEMA_NAME,
        }),
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('collect-ext-test'),
    storage: new SqlStorage({
      storageHash: coreHash('collect-ext-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

/**
 * Runs the one-differ planner diff and returns only the policy findings —
 * the RLS drift these tests assert on. Mirrors how `planner.ts` itself
 * splits the combined issue list (`isPolicyDiffIssue`).
 */
function policyDiffIssues(contract: Contract<SqlStorage>, schema: PostgresDatabaseSchemaNode) {
  const { issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: schema,
    frameworkComponents: [],
  });
  return issues.filter((issue) => {
    const node = issue.expected ?? issue.actual;
    return node !== undefined && PostgresPolicySchemaNode.is(node);
  });
}

describe('buildPostgresPlanDiff — RLS drift detection', () => {
  it('no contract policy + Prisma-managed DB policy → one extra diff issue', () => {
    const issues = policyDiffIssues(buildContract([]), schemaWithPolicies([wireNamedPolicy()]));

    expect(issues).toHaveLength(1);
    expect(issueOutcome(issues[0]!)).toBe('not-expected');
    expect(issues[0]?.actual).toMatchObject({ name: WIRE_NAME });
  });

  it('no contract policy + external DB policy → one extra diff issue', () => {
    const issues = policyDiffIssues(buildContract([]), schemaWithPolicies([externalPolicy()]));

    expect(issues).toHaveLength(1);
    expect(issueOutcome(issues[0]!)).toBe('not-expected');
    expect(issues[0]?.actual).toMatchObject({ name: 'legacy_admin_policy' });
  });

  it('matching contract + DB policy → no issues', () => {
    const policy = wireNamedPolicy();
    const issues = policyDiffIssues(buildContract([policy]), schemaWithPolicies([policy]));

    expect(issues).toHaveLength(0);
  });
});
