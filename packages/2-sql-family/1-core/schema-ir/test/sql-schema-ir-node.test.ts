import { describe, expect, it } from 'vitest';

import { PrimaryKey } from '../src/ir/primary-key';
import { relationalNodeGranularity } from '../src/ir/schema-node-kinds';
import { SqlCheckConstraintIR } from '../src/ir/sql-check-constraint-ir';
import { SqlColumnDefaultIR } from '../src/ir/sql-column-default-ir';
import { SqlColumnIR } from '../src/ir/sql-column-ir';
import { SqlForeignKeyIR } from '../src/ir/sql-foreign-key-ir';
import { SqlIndexIR } from '../src/ir/sql-index-ir';
import { SqlSchemaIR } from '../src/ir/sql-schema-ir';
import { assertNode, defineNonEnumerable } from '../src/ir/sql-schema-ir-node';
import { SqlTableIR } from '../src/ir/sql-table-ir';
import { SqlUniqueIR } from '../src/ir/sql-unique-ir';

/**
 * `kind` stays non-enumerable so serialization stays canonical and `toEqual`
 * against flat literals keeps passing — this was the A08 concern the
 * required-discriminant change must not regress. `nodeKind` stays enumerable
 * so it survives a spread.
 */
describe('SqlSchemaIRNode discriminants', () => {
  it.each([
    ['SqlColumnIR', new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false })],
    ['PrimaryKey', new PrimaryKey({ columns: ['id'] })],
    [
      'SqlForeignKeyIR',
      new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      }),
    ],
    ['SqlUniqueIR', new SqlUniqueIR({ columns: ['email'] })],
    [
      'SqlIndexIR',
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
    ],
    [
      'SqlCheckConstraintIR',
      new SqlCheckConstraintIR({
        naming: { kind: 'exact', name: 'chk' },
        expression: 'x > 0',
        dependsOn: undefined,
      }),
    ],
  ] as const)('%s: kind is non-enumerable, absent from JSON and toEqual', (_label, node) => {
    expect(Object.keys(node)).not.toContain('kind');
    expect(JSON.parse(JSON.stringify(node))).not.toHaveProperty('kind');
    expect(node.kind).toBe('sql-schema-ir');
  });

  it.each([
    [
      'SqlColumnIR',
      new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false }),
      'sql-column',
    ],
    ['PrimaryKey', new PrimaryKey({ columns: ['id'] }), 'sql-primary-key'],
    [
      'SqlForeignKeyIR',
      new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      }),
      'sql-foreign-key',
    ],
    ['SqlUniqueIR', new SqlUniqueIR({ columns: ['email'] }), 'sql-unique'],
    [
      'SqlIndexIR',
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
      'sql-index',
    ],
    [
      'SqlCheckConstraintIR',
      new SqlCheckConstraintIR({
        naming: { kind: 'exact', name: 'chk' },
        expression: 'x > 0',
        dependsOn: undefined,
      }),
      'sql-check-constraint',
    ],
    [
      'SqlTableIR',
      new SqlTableIR({ name: 't', columns: {}, foreignKeys: [], uniques: [], indexes: [] }),
      'sql-table',
    ],
    ['SqlSchemaIR', new SqlSchemaIR({ tables: {} }), 'sql-schema'],
  ] as const)('%s: nodeKind is enumerable and JSON-visible', (_label, node, expectedKind) => {
    expect(node.nodeKind).toBe(expectedKind);
    expect(Object.keys(node)).toContain('nodeKind');
    expect(JSON.parse(JSON.stringify(node))).toHaveProperty('nodeKind', expectedKind);
  });

  it('a column still matches a pre-lift flat literal via toEqual', () => {
    const column = new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false });
    expect(column).toEqual({
      name: 'id',
      typeText: 'int4',
      nullable: false,
      nodeKind: 'sql-column',
    });
  });
});

describe('assertNode', () => {
  it('names the expected class and the kind it got instead', () => {
    const column = new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false });

    expect(() => assertNode(column, 'SqlIndexIR', SqlIndexIR.is)).toThrow(
      'Expected a SqlIndexIR but got nodeKind=sql-column',
    );
  });

  it('reports an absent node rather than dereferencing it', () => {
    expect(() => assertNode(undefined, 'SqlIndexIR', SqlIndexIR.is)).toThrow(
      'Expected a SqlIndexIR but got nodeKind=undefined',
    );
  });

  it('passes a node the predicate accepts', () => {
    const index = new SqlIndexIR({
      naming: { kind: 'exact', name: 'users_email_idx' },
      columns: ['email'],
      where: undefined,
      unique: false,
      partial: false,
      type: undefined,
      options: undefined,
      annotations: undefined,
      dependsOn: undefined,
    });

    expect(() => assertNode(index, 'SqlIndexIR', SqlIndexIR.is)).not.toThrow();
  });
});

describe('defineNonEnumerable', () => {
  it('defines a readable, non-enumerable property', () => {
    const target: { marker?: string } = {};

    defineNonEnumerable(target, 'marker', 'present');

    expect({ value: target.marker, keys: Object.keys(target) }).toEqual({
      value: 'present',
      keys: [],
    });
  });

  it('leaves the property absent for an undefined value', () => {
    const target: { marker?: string } = {};

    defineNonEnumerable(target, 'marker', undefined);

    expect('marker' in target).toBe(false);
  });
});

/**
 * A schema-IR node carries NO verdict-classification of its own — only its
 * `nodeKind` identity. The family's `relationalNodeGranularity` map is the one
 * place that turns a relational `nodeKind` into the framework-neutral
 * granularity its diff issues classify as, resolved on demand by consumers;
 * the node itself exposes no `diffRole` member or any classification of its
 * own.
 */
describe('relationalNodeGranularity map (granularity is off the node)', () => {
  it.each([
    ['SqlSchemaIR', new SqlSchemaIR({ tables: {} }), 'structural'],
    [
      'SqlTableIR',
      new SqlTableIR({ name: 't', columns: {}, foreignKeys: [], uniques: [], indexes: [] }),
      'entity',
    ],
    ['SqlColumnIR', new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false }), 'field'],
    ['SqlColumnDefaultIR', new SqlColumnDefaultIR({ raw: '0' }), 'auxiliary'],
    ['PrimaryKey', new PrimaryKey({ columns: ['id'] }), 'auxiliary'],
    [
      'SqlForeignKeyIR',
      new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      }),
      'auxiliary',
    ],
    ['SqlUniqueIR', new SqlUniqueIR({ columns: ['email'] }), 'auxiliary'],
    [
      'SqlIndexIR',
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
      'auxiliary',
    ],
    [
      'SqlCheckConstraintIR',
      new SqlCheckConstraintIR({
        naming: { kind: 'exact', name: 'chk' },
        expression: 'x > 0',
        dependsOn: undefined,
      }),
      'auxiliary',
    ],
  ] as const)(
    '%s: nodeKind maps to granularity %s; node exposes no role member',
    (_label, node, expectedGranularity) => {
      expect(relationalNodeGranularity(node.nodeKind)).toBe(expectedGranularity);
      expect('diffRole' in node).toBe(false);
    },
  );
});
