import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';

const basePolicy = new PostgresPolicySchemaNode({
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

const tableInput = {
  name: 'profiles',
  columns: {
    id: { name: 'id', typeText: 'int4', nullable: false },
    user_id: { name: 'user_id', typeText: 'int4', nullable: false },
  },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  rlsEnabled: false,
};

describe('PostgresTableSchemaNode', () => {
  it('id returns the table name', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput, policies: [] });
    expect(table.id).toBe('profiles');
  });

  it('isEqualTo matches by id (name), ignoring columns and policies', () => {
    const a = new PostgresTableSchemaNode({ ...tableInput, policies: [basePolicy] });
    const same = new PostgresTableSchemaNode({ ...tableInput, policies: [] });
    const other = new PostgresTableSchemaNode({ ...tableInput, name: 'other', policies: [] });
    expect(a.isEqualTo(same)).toBe(true);
    expect(a.isEqualTo(other)).toBe(false);
  });

  it('isEqualTo compares rlsEnabled: nodes differing only in rlsEnabled are NOT equal (the first table-attribute comparison)', () => {
    const enabled = new PostgresTableSchemaNode({ ...tableInput, rlsEnabled: true, policies: [] });
    const disabled = new PostgresTableSchemaNode({ ...tableInput, policies: [] });
    expect(enabled.isEqualTo(disabled)).toBe(false);
    expect(disabled.isEqualTo(enabled)).toBe(false);
  });

  it('isEqualTo holds for same name and same rlsEnabled regardless of other structure', () => {
    const a = new PostgresTableSchemaNode({
      ...tableInput,
      rlsEnabled: true,
      policies: [basePolicy],
    });
    const b = new PostgresTableSchemaNode({
      name: 'profiles',
      columns: {},
      foreignKeys: [],
      uniques: [],
      indexes: [],
      rlsEnabled: true,
      policies: [],
    });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('rlsEnabled adds no children()', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput, rlsEnabled: true, policies: [] });
    expect(table.children()).toEqual([table.columns['id'], table.columns['user_id']]);
  });

  it('children() returns columns plus policies when there are no other constraints', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput, policies: [basePolicy] });
    expect(table.children()).toEqual([table.columns['id'], table.columns['user_id'], basePolicy]);
  });

  it('children() returns only columns when there are no policies or constraints', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput, policies: [] });
    expect(table.children()).toEqual([table.columns['id'], table.columns['user_id']]);
  });

  it('children() returns empty array for a table with no columns, constraints, or policies', () => {
    const table = new PostgresTableSchemaNode({
      name: 'empty',
      columns: {},
      foreignKeys: [],
      uniques: [],
      indexes: [],
      rlsEnabled: false,
      policies: [],
    });
    expect(table.children()).toEqual([]);
  });

  it('children() composes columns, primary key, foreign keys, uniques, indexes, checks, and policies in that order', () => {
    const table = new PostgresTableSchemaNode({
      name: 'orders',
      columns: {
        id: { name: 'id', typeText: 'int4', nullable: false },
        user_id: { name: 'user_id', typeText: 'int4', nullable: false },
        status: { name: 'status', typeText: 'text', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
      uniques: [{ columns: ['user_id', 'status'] }],
      indexes: [
        {
          naming: parseNaming('orders_status_idx', undefined),
          columns: ['status'],
          where: undefined,
          unique: false,
          partial: false,
          type: undefined,
          options: undefined,
          annotations: undefined,
          dependsOn: undefined,
        },
      ],
      checks: [
        {
          naming: { kind: 'exact', name: 'chk_status' },
          expression: `"status" IN ('active', 'inactive')`,
          dependsOn: undefined,
        },
      ],
      rlsEnabled: false,
      policies: [basePolicy],
    });

    const children = table.children();
    expect(children.map((c) => c.id)).toEqual([
      'column:id',
      'column:user_id',
      'column:status',
      'primary-key',
      'foreign-key:user_id->.users(id)',
      'unique:user_id,status',
      'index:orders_status_idx',
      'check:chk_status',
      basePolicy.id,
    ]);
  });

  it('children() order is deterministic across repeated calls', () => {
    const table = new PostgresTableSchemaNode({
      name: 'orders',
      columns: {
        id: { name: 'id', typeText: 'int4', nullable: false },
        user_id: { name: 'user_id', typeText: 'int4', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
      uniques: [],
      indexes: [],
      rlsEnabled: false,
      policies: [basePolicy],
    });

    expect(table.children().map((c) => c.id)).toEqual(table.children().map((c) => c.id));
  });

  it('a primary key sentinel id never collides with a column, constraint, or policy id under the same table', () => {
    const table = new PostgresTableSchemaNode({
      name: 'orders',
      columns: {
        id: { name: 'id', typeText: 'int4', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
      checks: [],
      rlsEnabled: false,
      policies: [basePolicy],
    });

    const ids = table.children().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('policies defaults to empty when not supplied', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput });
    expect(table.policies).toEqual([]);
  });

  it('carries columns from SqlTableIR', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput });
    expect(Object.keys(table.columns)).toEqual(['id', 'user_id']);
    expect(table.columns['id']?.typeText).toBe('int4');
  });

  it('instance is frozen', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput });
    expect(Object.isFrozen(table)).toBe(true);
  });

  describe('PostgresTableSchemaNode.is guard', () => {
    it('returns true for a PostgresTableSchemaNode', () => {
      const table = new PostgresTableSchemaNode({ ...tableInput });
      expect(PostgresTableSchemaNode.is(table)).toBe(true);
    });

    it('returns false for a PostgresPolicySchemaNode', () => {
      expect(PostgresTableSchemaNode.is(basePolicy)).toBe(false);
    });
  });
});
