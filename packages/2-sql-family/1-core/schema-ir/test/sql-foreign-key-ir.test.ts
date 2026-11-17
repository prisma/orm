import { describe, expect, it } from 'vitest';

import { SqlForeignKeyIR } from '../src/ir/sql-foreign-key-ir';

describe('SqlForeignKeyIR', () => {
  it('id is derived from the column tuple and referenced coordinates, not name', () => {
    const fk = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      referencedSchema: 'public',
      name: 'fk_orders_user_id',
    });
    expect(fk.id).toBe('foreign-key:user_id->public.users(id)');
  });

  it('two unnamed FKs with the same coordinates share the same id', () => {
    const a = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    const b = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    expect(a.id).toBe(b.id);
  });

  it('two FKs on the same table referencing different tables get distinct ids', () => {
    const a = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    const b = new SqlForeignKeyIR({
      columns: ['org_id'],
      referencedTable: 'organizations',
      referencedColumns: ['id'],
    });
    expect(a.id).not.toBe(b.id);
  });

  it('children is empty (a foreign key is a leaf)', () => {
    const fk = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    expect(fk.children()).toEqual([]);
  });

  describe('resolvedReferencedNamespace', () => {
    it('defaults to the raw referencedSchema when not supplied', () => {
      const fk = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        referencedSchema: 'public',
      });
      expect(fk.resolvedReferencedNamespace).toBe('public');
    });

    it('stays undefined when neither raw nor resolved schema is supplied', () => {
      const fk = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      });
      expect(fk.resolvedReferencedNamespace).toBeUndefined();
      expect(fk.id).toBe('foreign-key:user_id->.users(id)');
    });

    it('an explicit resolved schema overrides the raw value in the id', () => {
      const fk = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        referencedSchema: 'app_ns',
        resolvedReferencedNamespace: 'public',
      });
      expect(fk.referencedSchema).toBe('app_ns');
      expect(fk.id).toBe('foreign-key:user_id->public.users(id)');
    });

    it('an expected FK with a resolved namespace pairs with an introspected public FK by id', () => {
      const expected = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        referencedSchema: 'app_ns',
        resolvedReferencedNamespace: 'public',
      });
      const actual = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        referencedSchema: 'public',
      });
      expect(expected.id).toBe(actual.id);
    });
  });

  describe('isEqualTo referential-action directionality (this = expected)', () => {
    function fk(actions: {
      onDelete?: 'noAction' | 'cascade' | 'restrict';
      onUpdate?: 'noAction' | 'cascade' | 'setNull';
    }) {
      return new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        ...actions,
      });
    }

    it('an expected side that declares no action never flags drift', () => {
      expect(fk({}).isEqualTo(fk({ onDelete: 'cascade' }))).toBe(true);
      expect(fk({}).isEqualTo(fk({ onUpdate: 'setNull' }))).toBe(true);
    });

    it('an expected noAction is equivalent to undeclared (never flags drift)', () => {
      expect(fk({ onDelete: 'noAction' }).isEqualTo(fk({ onDelete: 'cascade' }))).toBe(true);
    });

    it('an actual noAction is equivalent to undeclared', () => {
      expect(fk({ onDelete: 'noAction' }).isEqualTo(fk({}))).toBe(true);
    });

    it('a declared expected action flags a missing actual action', () => {
      expect(fk({ onDelete: 'cascade' }).isEqualTo(fk({}))).toBe(false);
    });

    it('a declared expected action flags an actual noAction', () => {
      expect(fk({ onDelete: 'cascade' }).isEqualTo(fk({ onDelete: 'noAction' }))).toBe(false);
    });
  });

  describe('isEqualTo', () => {
    it('true when referential actions match', () => {
      const a = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'noAction',
      });
      const b = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'noAction',
      });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when onDelete differs', () => {
      const a = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
      });
      const b = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'restrict',
      });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when onUpdate differs', () => {
      const a = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onUpdate: 'cascade',
      });
      const b = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onUpdate: 'setNull',
      });
      expect(a.isEqualTo(b)).toBe(false);
    });
  });

  describe('dependsOn', () => {
    const dependsOn = [
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'users' },
      ],
    ];

    it('is readable when supplied', () => {
      const fk = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        dependsOn,
      });
      expect(fk.dependsOn).toEqual(dependsOn);
    });

    it('is absent when not supplied', () => {
      const fk = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      });
      expect(fk.dependsOn).toBeUndefined();
    });

    it('is non-enumerable — excluded from JSON and structural equality', () => {
      const fk = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        dependsOn,
      });
      expect(Object.keys(fk)).not.toContain('dependsOn');
      expect(JSON.parse(JSON.stringify(fk))).not.toHaveProperty('dependsOn');
    });

    it('is ignored by isEqualTo', () => {
      const a = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
        dependsOn,
      });
      const b = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
      });
      expect(a.isEqualTo(b)).toBe(true);
    });
  });
});
