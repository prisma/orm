import { describe, expect, it } from 'vitest';

import { SqlSchemaIR } from '../src/ir/sql-schema-ir';
import { SqlTableIR } from '../src/ir/sql-table-ir';

describe('flat tree diffability (SqlSchemaIR / SqlTableIR)', () => {
  const table = new SqlTableIR({
    name: 'users',
    columns: {
      id: { name: 'id', typeText: 'int4', nullable: false },
      email: { name: 'email', typeText: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [{ columns: ['org_id'], referencedTable: 'orgs', referencedColumns: ['id'] }],
    uniques: [{ columns: ['email'] }],
    indexes: [
      {
        naming: { kind: 'exact', name: 'users_email_idx' },
        columns: ['email'],
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
      { naming: { kind: 'exact', name: 'chk' }, expression: `"email" <> ''`, dependsOn: undefined },
    ],
  });

  it('SqlSchemaIR is the diff root: sentinel id, identity isEqualTo, tables as children', () => {
    const root = new SqlSchemaIR({ tables: { users: table } });
    expect(root.id).toBe('database');
    expect(root.isEqualTo(new SqlSchemaIR({ tables: {} }))).toBe(true);
    expect(root.children()).toEqual([table]);
  });

  it('SqlTableIR children compose columns, PK, FKs, uniques, indexes, checks in order', () => {
    expect(table.children().map((c) => c.id)).toEqual([
      'column:id',
      'column:email',
      'primary-key',
      'foreign-key:org_id->.orgs(id)',
      'unique:email',
      'index:users_email_idx',
      'check:chk',
    ]);
  });

  describe('given plain-data input rather than constructed nodes', () => {
    const fromPlainData = new SqlSchemaIR({
      tables: {
        users: {
          name: 'users',
          columns: { id: { name: 'id', typeText: 'int4', nullable: false } },
          foreignKeys: [
            { columns: ['org_id'], referencedTable: 'orgs', referencedColumns: ['id'] },
          ],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
      },
    });

    const users = Object.values(fromPlainData.tables)[0];

    it('normalises the whole tree into IR classes', () => {
      expect({
        table: users instanceof SqlTableIR,
        childKinds: users?.children().map((child) => child.nodeKind),
      }).toEqual({
        table: true,
        childKinds: ['sql-column', 'sql-foreign-key', 'sql-unique'],
      });
    });

    it('leaves an absent primary key and absent checks out of children', () => {
      expect(users?.children().map((child) => child.id)).toEqual([
        'column:id',
        'foreign-key:org_id->.orgs(id)',
        'unique:email',
      ]);
    });
  });

  it('SqlTableIR isEqualTo is identity by name', () => {
    const sameName = new SqlTableIR({
      name: 'users',
      columns: {},
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    const otherName = new SqlTableIR({
      name: 'orders',
      columns: {},
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    expect(table.isEqualTo(sameName)).toBe(true);
    expect(table.isEqualTo(otherName)).toBe(false);
  });
});
