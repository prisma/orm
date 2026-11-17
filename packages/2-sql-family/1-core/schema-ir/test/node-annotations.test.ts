import { dataType } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';

import { SqlColumnIR } from '../src/ir/sql-column-ir';
import { SqlForeignKeyIR } from '../src/ir/sql-foreign-key-ir';
import { SqlIndexIR } from '../src/ir/sql-index-ir';
import { SqlSchemaIR } from '../src/ir/sql-schema-ir';
import { SqlTableIR } from '../src/ir/sql-table-ir';
import { SqlUniqueIR } from '../src/ir/sql-unique-ir';

const int4Type = { storedType: dataType('t/int4', { read: (json) => json }), storedTypeParams: {} };

const annotations = { 'prisma/rls': { enabled: true } };

const withAnnotations = {
  SqlColumnIR: () =>
    new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false, ...int4Type, annotations }),
  SqlForeignKeyIR: () =>
    new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      annotations,
    }),
  SqlUniqueIR: () => new SqlUniqueIR({ columns: ['email'], annotations }),
  SqlIndexIR: () =>
    new SqlIndexIR({
      naming: { kind: 'exact', name: 'users_email_idx' },
      columns: ['email'],
      where: undefined,
      unique: false,
      partial: false,
      type: undefined,
      options: undefined,
      annotations,
      dependsOn: undefined,
    }),
  SqlTableIR: () =>
    new SqlTableIR({
      name: 'users',
      columns: {},
      foreignKeys: [],
      uniques: [],
      indexes: [],
      annotations,
    }),
  SqlSchemaIR: () => new SqlSchemaIR({ tables: {}, annotations }),
} as const;

const withoutAnnotations = {
  SqlColumnIR: () =>
    new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false, ...int4Type }),
  SqlForeignKeyIR: () =>
    new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    }),
  SqlUniqueIR: () => new SqlUniqueIR({ columns: ['email'] }),
  SqlIndexIR: () =>
    new SqlIndexIR({
      naming: { kind: 'exact', name: 'users_email_idx' },
      columns: ['email'],
      where: undefined,
      unique: false,
      partial: false,
      type: undefined,
      options: undefined,
      annotations: undefined,
      dependsOn: undefined,
    }),
  SqlTableIR: () =>
    new SqlTableIR({ name: 'users', columns: {}, foreignKeys: [], uniques: [], indexes: [] }),
  SqlSchemaIR: () => new SqlSchemaIR({ tables: {} }),
} as const;

const nodeNames = Object.keys(withAnnotations) as (keyof typeof withAnnotations)[];

describe('annotations on schema IR nodes', () => {
  it.each(nodeNames)('%s carries supplied annotations into serialization', (name) => {
    const node = withAnnotations[name]();

    expect(JSON.parse(JSON.stringify(node))).toMatchObject({ annotations });
  });

  it.each(nodeNames)('%s leaves annotations absent when none are supplied', (name) => {
    expect('annotations' in withoutAnnotations[name]()).toBe(false);
  });

  it.each(nodeNames)('%s equality ignores annotations', (name) => {
    expect(withAnnotations[name]().isEqualTo(withoutAnnotations[name]())).toBe(true);
  });
});
