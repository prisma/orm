import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { PostgresDatabaseSchemaNode } from '../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';
import {
  PostgresSchemaNodeKind,
  postgresDiffSubjectGranularity,
  postgresNodeGranularity,
} from '../src/core/schema-ir/schema-node-kinds';

/**
 * The subject granularity a Postgres diff node's issues carry is resolved
 * from the node's `nodeKind` by the family/target map — NEVER stamped on the
 * node. Namespace/table nodes carry the granularities their extras classify
 * under (extraTopLevelObject, strict-gated); a policy node and a role node
 * are both `structural` (a policy set is owned by its managed table; a role
 * is referenced by the contract but not owned). The asymmetric grading for a
 * role — a missing declared one fails, an undeclared live one is tolerated
 * unconditionally — comes from roles resolving to the `external` control
 * policy, not from the granularity. These tests pin the map and prove the
 * node itself carries no role/granularity of its own.
 */
describe('postgresNodeGranularity map', () => {
  it.each([
    [PostgresSchemaNodeKind.database, 'structural'],
    [PostgresSchemaNodeKind.namespace, 'namespace'],
    [PostgresSchemaNodeKind.table, 'entity'],
    [PostgresSchemaNodeKind.policy, 'structural'],
    [PostgresSchemaNodeKind.role, 'structural'],
  ] as const)('maps %s to %s', (nodeKind, granularity) => {
    expect(postgresNodeGranularity(nodeKind)).toBe(granularity);
  });
});

describe('postgresDiffSubjectGranularity dispatches Postgres and relational kinds', () => {
  it('resolves a Postgres-specific kind via the Postgres map', () => {
    expect(postgresDiffSubjectGranularity(PostgresSchemaNodeKind.policy)).toBe('structural');
    expect(postgresDiffSubjectGranularity(PostgresSchemaNodeKind.table)).toBe('entity');
  });

  it('resolves a relational leaf kind via the relational map', () => {
    expect(postgresDiffSubjectGranularity('sql-column')).toBe('field');
    expect(postgresDiffSubjectGranularity('sql-index')).toBe('auxiliary');
  });
});

describe('Postgres schema nodes carry no role/granularity of their own', () => {
  it.each([
    [
      'PostgresDatabaseSchemaNode',
      new PostgresDatabaseSchemaNode({
        extensions: undefined,
        namespaces: {},
        roles: [],
        existingSchemas: [],
        pgVersion: '',
      }),
    ],
    [
      'PostgresNamespaceSchemaNode',
      new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {},
      }),
    ],
    [
      'PostgresTableSchemaNode',
      new PostgresTableSchemaNode({
        name: 't',
        columns: {},
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    ],
    [
      'PostgresPolicySchemaNode',
      new PostgresPolicySchemaNode({
        naming: parseNaming('read_own_a1b2c3d4', 'read_own'),
        tableName: 'profiles',
        namespaceId: 'public',
        operation: 'select',
        roles: ['authenticated'],
        permissive: true,
        using: undefined,
        withCheck: undefined,
        dependsOn: undefined,
      }),
    ],
    [
      'PostgresRoleSchemaNode',
      new PostgresRoleSchemaNode({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID }),
    ],
  ] as const)('%s exposes no diffRole or classification member of its own', (_label, node) => {
    expect('diffRole' in node).toBe(false);
    expect('nodeKind' in node).toBe(true);
  });
});
