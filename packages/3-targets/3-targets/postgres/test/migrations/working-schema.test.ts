import type { SchemaNodeRef } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { computeCheckContentHash, computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { RelationalSchemaNodeKind, SqlCheckConstraintIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  RenameConstraintCall,
  RenameIndexCall,
  RenamePostgresRlsPolicyCall,
  RenameTableCall,
} from '../../src/core/migrations/op-factory-call';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import {
  createWorkingSchema,
  renameTableInPostgresSchema,
} from '../../src/core/migrations/working-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { PostgresSchemaNodeKind } from '../../src/core/schema-ir/schema-node-kinds';
import { postgresTypeComponents } from '../postgres-type-lookups';
import {
  contractOf,
  NICKNAME_CHECK,
  type ProfileSpec,
  postTable,
  reference,
} from './rename-table-fixtures';

const HANDLE_HASH = computeIndexContentHash({ columns: ['handle'], unique: false });
const NICKNAME_HASH = computeCheckContentHash(NICKNAME_CHECK);

const withObjects: ProfileSpec = {
  primaryKey: { columns: ['id'] },
  uniques: [{ columns: ['email'] }],
  foreignKeys: (tableName) => [
    { source: reference(tableName, ['accountId']), target: reference('account', ['id']) },
  ],
  indexes: (tableName) => [
    {
      columns: ['handle'],
      naming: { kind: 'wire', prefix: `${tableName}_handle_idx`, hash: HANDLE_HASH },
      where: undefined,
      unique: false,
      type: undefined,
      options: undefined,
    },
  ],
  checks: (tableName) => [
    {
      naming: { kind: 'wire', prefix: `${tableName}_nickname_check`, hash: NICKNAME_HASH },
      expression: NICKNAME_CHECK,
    },
  ],
};

function startSchema(): PostgresDatabaseSchemaNode {
  return postgresContractToSchema(
    contractOf('userProfile', withObjects, 'from', (tableName) => ({ post: postTable(tableName) })),
    postgresTypeComponents,
  );
}

function tableIn(schema: PostgresDatabaseSchemaNode, table: string): PostgresTableSchemaNode {
  const found = schema.namespaces['public']?.tables[table];
  if (found === undefined) throw new Error(`table ${table} missing`);
  return found;
}

const tableRef = (table: string): SchemaNodeRef => [
  { nodeKind: PostgresSchemaNodeKind.database, id: 'database' },
  { nodeKind: PostgresSchemaNodeKind.namespace, id: 'public' },
  { nodeKind: PostgresSchemaNodeKind.table, id: table },
];

const RENAME = { schemaName: 'public', from: 'userProfile', to: 'UserProfile' } as const;

describe('renameTableInPostgresSchema', () => {
  it('re-keys and renames the table and leaves the input untouched', () => {
    const before = startSchema();
    const after = renameTableInPostgresSchema(before, RENAME);

    expect(Object.keys(after.namespaces['public']?.tables ?? {}).sort()).toEqual([
      'UserProfile',
      'account',
      'post',
    ]);
    expect(tableIn(after, 'UserProfile').name).toBe('UserProfile');
    expect(Object.keys(before.namespaces['public']?.tables ?? {}).sort()).toEqual([
      'account',
      'post',
      'userProfile',
    ]);
  });

  it('retargets a foreign key on another table, with its dependency on the table', () => {
    const fk = tableIn(renameTableInPostgresSchema(startSchema(), RENAME), 'post').foreignKeys[0];
    expect(fk?.referencedTable).toBe('UserProfile');
    expect(fk?.dependsOn?.[0]).toEqual(tableRef('UserProfile'));
  });

  it('keeps every object name, spelling out the names derived from the old table name', () => {
    const table = tableIn(renameTableInPostgresSchema(startSchema(), RENAME), 'UserProfile');
    expect({
      primaryKey: table.primaryKey?.name,
      uniques: table.uniques.map((unique) => unique.name),
      foreignKeys: table.foreignKeys.map((fk) => fk.name),
      indexes: table.indexes.map((index) => index.name),
      checks: table.checks?.map((check) => check.name),
    }).toEqual({
      primaryKey: 'userProfile_pkey',
      uniques: ['userProfile_email_key'],
      foreignKeys: ['userProfile_accountId_fkey'],
      indexes: [`userProfile_handle_idx_${HANDLE_HASH}`],
      checks: [`userProfile_nickname_check_${NICKNAME_HASH}`],
    });
  });

  it('moves the dependencies of the objects on the table to its new name', () => {
    const table = tableIn(renameTableInPostgresSchema(startSchema(), RENAME), 'UserProfile');
    const column = (name: string): SchemaNodeRef => [
      ...tableRef('UserProfile'),
      { nodeKind: RelationalSchemaNodeKind.column, id: `column:${name}` },
    ];
    expect(table.primaryKey?.dependsOn).toEqual([column('id')]);
    expect(table.uniques[0]?.dependsOn).toEqual([column('email')]);
    expect(table.indexes[0]?.dependsOn).toEqual([column('handle')]);
  });

  it('carries row-level security and moves the policies onto the new table name', () => {
    const policy = new PostgresPolicySchemaNode({
      naming: { kind: 'exact', name: 'tenant_read' },
      tableName: 'userProfile',
      namespaceId: 'public',
      operation: 'select',
      roles: ['app_user'],
      using: '(tenant_id = 1)',
      withCheck: undefined,
      permissive: true,
      dependsOn: [tableRef('userProfile')],
    });
    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            userProfile: new PostgresTableSchemaNode({
              name: 'userProfile',
              columns: {},
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [policy],
              rlsEnabled: true,
            }),
          },
        }),
      },
      roles: [],
      existingSchemas: ['public'],
      pgVersion: '16',
    });

    const table = tableIn(renameTableInPostgresSchema(schema, RENAME), 'UserProfile');
    expect(table.rlsEnabled).toBe(true);
    expect(table.policies.map((node) => [node.name, node.tableName])).toEqual([
      ['tenant_read', 'UserProfile'],
    ]);
    expect(table.policies[0]?.dependsOn).toEqual([tableRef('UserProfile')]);
  });
});

describe('WorkingSchema.apply', () => {
  it('renames the table and then applies each companion', () => {
    const working = createWorkingSchema(startSchema());
    working.apply(
      new RenameTableCall(UNBOUND_NAMESPACE_ID, 'userProfile', 'UserProfile', [
        new RenameConstraintCall(
          UNBOUND_NAMESPACE_ID,
          'UserProfile',
          'primaryKey',
          'userProfile_pkey',
          'UserProfile_pkey',
        ),
      ]),
    );
    const table = tableIn(working.current, 'UserProfile');
    expect(table.primaryKey?.name).toBe('UserProfile_pkey');
    expect(tableIn(working.current, 'post').foreignKeys[0]?.referencedTable).toBe('UserProfile');
  });

  it('renames a unique constraint and a check constraint', () => {
    const working = createWorkingSchema(startSchema());
    working.apply(
      new RenameConstraintCall(
        UNBOUND_NAMESPACE_ID,
        'userProfile',
        'unique',
        'userProfile_email_key',
        'profile_email_unique',
      ),
    );
    working.apply(
      new RenameConstraintCall(
        UNBOUND_NAMESPACE_ID,
        'userProfile',
        'checkConstraint',
        `userProfile_nickname_check_${NICKNAME_HASH}`,
        `profile_nickname_check_${NICKNAME_HASH}`,
      ),
    );
    const table = tableIn(working.current, 'userProfile');
    expect(table.uniques.map((unique) => unique.name)).toEqual(['profile_email_unique']);
    expect(table.checks?.map((check) => [check.name, check.prefix])).toEqual([
      [`profile_nickname_check_${NICKNAME_HASH}`, 'profile_nickname_check'],
    ]);
  });

  it('renames an index and every dependency that names it', () => {
    const indexStep = (name: string) => ({
      nodeKind: RelationalSchemaNodeKind.index,
      id: `index:${name}`,
    });
    const oldIndex = `userProfile_handle_idx_${HANDLE_HASH}`;
    const newIndex = `profile_handle_idx_${HANDLE_HASH}`;
    const base = tableIn(startSchema(), 'userProfile');
    const dependent = new SqlCheckConstraintIR({
      naming: { kind: 'exact', name: 'handle_present' },
      expression: 'handle IS NOT NULL',
      dependsOn: [[...tableRef('userProfile'), indexStep(oldIndex)]],
    });
    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            userProfile: new PostgresTableSchemaNode({ ...base, checks: [dependent] }),
          },
        }),
      },
      roles: [],
      existingSchemas: ['public'],
      pgVersion: '16',
    });

    const working = createWorkingSchema(schema);
    working.apply(new RenameIndexCall(UNBOUND_NAMESPACE_ID, 'userProfile', oldIndex, newIndex));
    const table = tableIn(working.current, 'userProfile');
    expect(table.indexes.map((index) => [index.name, index.prefix])).toEqual([
      [newIndex, 'profile_handle_idx'],
    ]);
    expect(table.checks?.[0]?.dependsOn).toEqual([
      [...tableRef('userProfile'), indexStep(newIndex)],
    ]);
  });

  it('renames a policy and every dependency that names it', () => {
    const policyStep = (name: string) => ({ nodeKind: PostgresSchemaNodeKind.policy, id: name });
    const policy = (name: string, dependsOn: readonly SchemaNodeRef[]) =>
      new PostgresPolicySchemaNode({
        naming: { kind: 'exact', name },
        tableName: 'userProfile',
        namespaceId: 'public',
        operation: 'select',
        roles: ['app_user'],
        using: '(tenant_id = 1)',
        withCheck: undefined,
        permissive: true,
        dependsOn,
      });
    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            userProfile: new PostgresTableSchemaNode({
              name: 'userProfile',
              columns: {},
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [
                policy('tenant_read', [tableRef('userProfile')]),
                policy('tenant_audit', [[...tableRef('userProfile'), policyStep('tenant_read')]]),
              ],
              rlsEnabled: true,
            }),
          },
        }),
      },
      roles: [],
      existingSchemas: ['public'],
      pgVersion: '16',
    });

    const working = createWorkingSchema(schema);
    working.apply(
      new RenamePostgresRlsPolicyCall('public', 'userProfile', 'tenant_read', 'tenant_select'),
    );
    const policies = tableIn(working.current, 'userProfile').policies;
    expect(policies.map((node) => node.name)).toEqual(['tenant_select', 'tenant_audit']);
    expect(policies[1]?.dependsOn).toEqual([
      [...tableRef('userProfile'), policyStep('tenant_select')],
    ]);
  });

  it('replaces current with a new tree and never changes the one it replaced', () => {
    const working = createWorkingSchema(startSchema());
    const before = working.current;
    working.apply(new RenameTableCall(UNBOUND_NAMESPACE_ID, 'userProfile', 'UserProfile', []));
    expect(working.current).not.toBe(before);
    expect(Object.keys(before.namespaces['public']?.tables ?? {})).toContain('userProfile');
    expect(tableIn(before, 'post').foreignKeys[0]?.referencedTable).toBe('userProfile');
  });
});
