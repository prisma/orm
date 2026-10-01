import { describe, expect, it } from 'vitest';

import { SqlColumnDefaultIR } from '../src/ir/sql-column-default-ir';
import { SqlColumnIR } from '../src/ir/sql-column-ir';

describe('SqlColumnIR', () => {
  it('id is the column name, prefixed by kind', () => {
    const column = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
    expect(column.id).toBe('column:email');
  });

  it('nodeKind is the column kind', () => {
    const column = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
    expect(column.nodeKind).toBe('sql-column');
  });

  describe('children', () => {
    it('empty when the column has no default', () => {
      const column = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
      expect(column.children()).toEqual([]);
    });

    it('yields a default node built from the resolved default', () => {
      const column = new SqlColumnIR({
        name: 'status',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'draft' },
      });
      expect(column.children()).toEqual([
        new SqlColumnDefaultIR({
          resolved: { kind: 'literal', value: 'draft' },
          nativeTypeContext: 'text',
        }),
      ]);
    });

    it('gives the default node the column codec identity, for rendering the default as DDL', () => {
      const codecRef = { codecId: 'pg/enum@1', typeParams: { typeName: 'order' }, many: true };
      const column = new SqlColumnIR({
        name: 'orders',
        nativeType: 'order',
        nullable: true,
        many: true,
        resolvedNativeType: 'order[]',
        resolvedDefault: { kind: 'literal', value: ['asc'] },
        codecRef,
        codecBaseNativeType: 'order',
        codecNamedType: true,
      });

      const defaultNode = column.children()[0] as SqlColumnDefaultIR;

      expect(defaultNode).toBeInstanceOf(SqlColumnDefaultIR);
      expect({
        codecRef: defaultNode.codecRef,
        codecBaseNativeType: defaultNode.codecBaseNativeType,
        codecNamedType: defaultNode.codecNamedType,
        enumerableKeys: Object.keys(defaultNode),
      }).toEqual({
        codecRef,
        codecBaseNativeType: 'order',
        codecNamedType: true,
        enumerableKeys: ['nodeKind', 'resolved', 'nativeTypeContext'],
      });
    });

    it('yields a default node from a raw default alone (unparseable or hand-built)', () => {
      const column = new SqlColumnIR({
        name: 'status',
        nativeType: 'text',
        nullable: false,
        default: "'draft'::text",
      });
      expect(column.children()).toEqual([new SqlColumnDefaultIR({ raw: "'draft'::text" })]);
    });

    it('the default node id is the fixed sentinel', () => {
      const column = new SqlColumnIR({
        name: 'status',
        nativeType: 'text',
        nullable: false,
        default: "'x'",
      });
      expect(column.children()[0]?.id).toBe('default');
    });
  });

  describe('isEqualTo (own attributes only — never the default)', () => {
    it('true when nativeType and nullability match, even when defaults differ', () => {
      const a = new SqlColumnIR({
        name: 'email',
        nativeType: 'text',
        nullable: false,
        default: "'x'",
      });
      const b = new SqlColumnIR({
        name: 'email',
        nativeType: 'text',
        nullable: false,
        default: "'y'",
      });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when nativeType differs', () => {
      const a = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
      const b = new SqlColumnIR({ name: 'email', nativeType: 'varchar', nullable: false });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when nullable differs', () => {
      const a = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
      const b = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: true });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when many differs in raw mode', () => {
      const a = new SqlColumnIR({ name: 'tags', nativeType: 'text', nullable: false });
      const b = new SqlColumnIR({ name: 'tags', nativeType: 'text', nullable: false, many: true });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('compares resolvedNativeType when both sides carry it, ignoring raw drift', () => {
      const expected = new SqlColumnIR({
        name: 'email',
        nativeType: 'character varying(255)',
        nullable: false,
        resolvedNativeType: 'character varying(255)',
      });
      const actual = new SqlColumnIR({
        name: 'email',
        nativeType: 'varchar(255)',
        nullable: false,
        resolvedNativeType: 'character varying(255)',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('false when resolvedNativeType differs', () => {
      const expected = new SqlColumnIR({
        name: 'n',
        nativeType: 'int4',
        nullable: false,
        resolvedNativeType: 'int4',
      });
      const actual = new SqlColumnIR({
        name: 'n',
        nativeType: 'int4',
        nullable: false,
        resolvedNativeType: 'int8',
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('array-ness rides on resolvedNativeType ([] suffix), not the many flag', () => {
      const expected = new SqlColumnIR({
        name: 'tags',
        nativeType: 'text[]',
        nullable: false,
        resolvedNativeType: 'text[]',
      });
      const actual = new SqlColumnIR({
        name: 'tags',
        nativeType: 'text',
        nullable: false,
        many: true,
        resolvedNativeType: 'text[]',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('falls back to raw comparison when either side lacks resolvedNativeType', () => {
      const withResolved = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
      });
      const rawOnly = new SqlColumnIR({ name: 'c', nativeType: 'text', nullable: false });
      expect(withResolved.isEqualTo(rawOnly)).toBe(true);
      expect(rawOnly.isEqualTo(withResolved)).toBe(true);
    });
  });

  describe('resolved fields', () => {
    it('carries resolvedNativeType and resolvedDefault when supplied', () => {
      const column = new SqlColumnIR({
        name: 'email',
        nativeType: 'character varying(255)',
        nullable: false,
        resolvedNativeType: 'character varying(255)',
        resolvedDefault: { kind: 'literal', value: 'x' },
      });
      expect(column.resolvedNativeType).toBe('character varying(255)');
      expect(column.resolvedDefault).toEqual({ kind: 'literal', value: 'x' });
    });
  });

  describe('identity columns (introspected, no raw default)', () => {
    it('yields a default child node from resolvedDefault alone, with no raw default', () => {
      // A `GENERATED ... AS IDENTITY` column has no `column_default` at
      // all — the postgres control adapter sets `resolvedDefault` directly
      // to `autoincrement()` without a raw expression to parse, so
      // `children()` must still produce a default node without a `default`
      // (raw) field.
      const column = new SqlColumnIR({
        name: 'id',
        nativeType: 'int4',
        nullable: false,
        resolvedDefault: { kind: 'function', expression: 'autoincrement()' },
      });
      expect(column.children()).toEqual([
        new SqlColumnDefaultIR({
          resolved: { kind: 'function', expression: 'autoincrement()' },
        }),
      ]);
    });
  });
});
