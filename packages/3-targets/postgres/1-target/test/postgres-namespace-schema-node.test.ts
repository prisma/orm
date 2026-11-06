import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';

const policy = new PostgresPolicySchemaNode({
  naming: parseNaming('read_own_a1b2c3d4', 'read_own'),
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select' as const,
  roles: ['authenticated'],
  using: '(auth.uid() = user_id)',
  permissive: true,
  withCheck: undefined,
  dependsOn: undefined,
});

const tableA = new PostgresTableSchemaNode({
  name: 'profiles',
  columns: { id: { name: 'id', typeText: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [policy],
  rlsEnabled: false,
});

const tableB = new PostgresTableSchemaNode({
  name: 'orders',
  columns: { id: { name: 'id', typeText: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [],
  rlsEnabled: false,
});

const baseInput = {
  schemaName: 'public',
  tables: { profiles: tableA, orders: tableB },
};

describe('PostgresNamespaceSchemaNode', () => {
  it('id returns schemaName', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.id).toBe('public');
  });

  it('isEqualTo matches by id (schema name)', () => {
    const a = new PostgresNamespaceSchemaNode(baseInput);
    const same = new PostgresNamespaceSchemaNode(baseInput);
    const other = new PostgresNamespaceSchemaNode({ ...baseInput, schemaName: 'other' });
    expect(a.isEqualTo(same)).toBe(true);
    expect(a.isEqualTo(other)).toBe(false);
  });

  it('children() returns table nodes', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.children()).toEqual([tableA, tableB]);
  });

  it('children() returns empty array when no tables', () => {
    const node = new PostgresNamespaceSchemaNode({ schemaName: 'empty', tables: {} });
    expect(node.children()).toEqual([]);
  });

  it('instance is frozen', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('native enums', () => {
    it('carries enum nodes passed directly into children()', () => {
      const enumNode = new PostgresNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2'],
        control: 'external',
      });
      const node = new PostgresNamespaceSchemaNode({
        schemaName: 'auth',
        tables: {},
        nativeEnums: [enumNode],
      });
      expect(node.nativeEnums).toEqual([enumNode]);
      expect(node.children()).toEqual([enumNode]);
    });

    it('defaults to empty when nativeEnums is omitted', () => {
      const node = new PostgresNamespaceSchemaNode(baseInput);
      expect(node.nativeEnums).toEqual([]);
    });

    it('freezes the nativeEnums list', () => {
      const enumNode = new PostgresNativeEnumSchemaNode({
        typeName: 'status_enum',
        namespaceId: 'public',
        members: ['draft', 'review'],
      });
      const node = new PostgresNamespaceSchemaNode({
        ...baseInput,
        nativeEnums: [enumNode],
      });
      expect(Object.isFrozen(node.nativeEnums)).toBe(true);
    });

    it('exposes one enum diff node per entry through children()', () => {
      const enumNode = new PostgresNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2'],
      });
      const node = new PostgresNamespaceSchemaNode({
        schemaName: 'auth',
        tables: { profiles: tableA },
        nativeEnums: [enumNode],
      });
      const enumChildren = node.children().filter((child) => child.id.startsWith('native_enum:'));
      expect(enumChildren).toEqual([
        expect.objectContaining({
          nodeKind: 'postgres-native-enum',
          typeName: 'aal_level',
          namespaceId: 'auth',
          members: ['aal1', 'aal2'],
        }),
      ]);
      expect(node.children()).toHaveLength(2);
    });
  });

  describe('PostgresNamespaceSchemaNode.is', () => {
    it('returns true for a PostgresNamespaceSchemaNode', () => {
      const node = new PostgresNamespaceSchemaNode(baseInput);
      expect(PostgresNamespaceSchemaNode.is(node)).toBe(true);
    });

    it('returns false for a PostgresTableSchemaNode', () => {
      expect(PostgresNamespaceSchemaNode.is(tableA)).toBe(false);
    });

    it('returns false for a PostgresPolicySchemaNode', () => {
      expect(PostgresNamespaceSchemaNode.is(policy)).toBe(false);
    });
  });
});
