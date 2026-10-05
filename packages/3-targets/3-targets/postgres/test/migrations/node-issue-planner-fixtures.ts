import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import {
  coalesceSubtreeIssues,
  planIssues as planNodeIssues,
} from '../../src/core/migrations/issue-planner';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import type { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

export type TableSpec = ConstructorParameters<typeof StorageTable>[0];

export function makeContract(tables: Record<string, TableSpec>): Contract<SqlStorage> {
  const publicSchema = new PostgresSchema({
    id: 'public',
    entries: {
      table: Object.fromEntries(
        Object.entries(tables).map(([name, spec]) => [name, new StorageTable(spec)]),
      ),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('node-planner'),
    storage: new SqlStorage({
      storageHash: coreHash('node-planner'),
      namespaces: { public: publicSchema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

export function emptyRoot(): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {},
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

export function rootOf(
  tables: Record<string, PostgresTableSchemaNode>,
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables,
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

export function planFor(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode) {
  const { issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: actual,
    frameworkComponents: [],
  });
  // Subtree coalescing is the planner's responsibility (per the differ's
  // contract) — the total differ emits an issue for every node in a
  // missing/extra subtree, redundant once the table-level call accounts for it.
  const coalesced = coalesceSubtreeIssues(issues);
  const result = planNodeIssues({
    issues: coalesced,
    toContract: contract,
    fromContract: null,
    schemaName: 'public',
    codecHooks: new Map(),
    storageTypes: contract.storage.types ?? {},
    // The default per-issue mapper is what this suite pins — the real
    // strategy list is covered elsewhere (see module docstring).
    strategies: [],
  });
  if (!result.ok) throw new Error(`expected ok, got conflicts: ${JSON.stringify(result.failure)}`);
  return result.value.calls;
}
