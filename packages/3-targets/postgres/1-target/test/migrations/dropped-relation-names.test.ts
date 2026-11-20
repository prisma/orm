import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { droppedRelationNames } from '../../src/core/migrations/dropped-relation-names';
import {
  CreateSchemaCall,
  DropConstraintCall,
  DropIndexCall,
  DropTableCall,
} from '../../src/core/migrations/op-factory-call';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const stale = new PostgresTableSchemaNode({
  name: 'stale',
  columns: {},
  primaryKey: { columns: ['id'], name: 'stale_pkey' },
  foreignKeys: [
    {
      columns: ['owner'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      name: 'stale_owner_fkey',
    },
  ],
  uniques: [{ columns: ['code'], name: 'stale_code_key' }],
  indexes: [
    {
      columns: ['id'],
      naming: { kind: 'exact', name: 'app_users_pkey' },
      where: undefined,
      unique: false,
      type: undefined,
      options: undefined,
      annotations: undefined,
      dependsOn: undefined,
      partial: false,
    },
  ],
  checks: [
    {
      naming: { kind: 'exact', name: 'stale_code_check' },
      expression: "code <> ''",
      dependsOn: undefined,
    },
  ],
  policies: [],
  rlsEnabled: false,
});

const schema = new PostgresDatabaseSchemaNode({
  extensions: undefined,
  namespaces: {
    public: new PostgresNamespaceSchemaNode({ schemaName: 'public', tables: { stale } }),
  },
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

const ddlSchemaOf = (name: string) => (name === UNBOUND_NAMESPACE_ID ? 'public' : name);

describe('droppedRelationNames', () => {
  it('names every constraint and index of a dropped table, under either name of its schema', () => {
    const dropped = droppedRelationNames(
      [new DropTableCall(UNBOUND_NAMESPACE_ID, 'stale')],
      schema,
      ddlSchemaOf,
    );
    expect(
      [
        'stale_pkey',
        'stale_owner_fkey',
        'stale_code_key',
        'app_users_pkey',
        'stale_code_check',
        'users_pkey',
      ].map((name) => [dropped('public', name), dropped(UNBOUND_NAMESPACE_ID, name)]),
    ).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [false, false],
    ]);
  });

  it('names a dropped index and a dropped constraint in their own schema only', () => {
    const dropped = droppedRelationNames(
      [
        new DropIndexCall('public', 'users', 'users_email_idx'),
        new DropConstraintCall('billing', 'invoices', 'invoices_code_key'),
        new CreateSchemaCall('reporting'),
      ],
      schema,
      ddlSchemaOf,
    );
    expect([
      dropped('public', 'users_email_idx'),
      dropped('billing', 'invoices_code_key'),
      dropped('billing', 'users_email_idx'),
      dropped('public', 'invoices_code_key'),
    ]).toEqual([true, true, false, false]);
  });

  it('names nothing for a dropped table the schema does not have', () => {
    const dropped = droppedRelationNames(
      [new DropTableCall('public', 'missing')],
      schema,
      ddlSchemaOf,
    );
    expect(dropped('public', 'stale_pkey')).toBe(false);
  });
});
