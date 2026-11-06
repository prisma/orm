import { describe, expect, it } from 'vitest';
import {
  type AnyJsonValueProjection,
  BinaryExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  NativeJsonValueProjection,
  OrderByItem,
  ParamRef,
  type ProjectionExpr,
} from '../../src/exports/ast';

function projections(value: ProjectionExpr): ReadonlyArray<AnyJsonValueProjection> {
  return [
    new CodecJsonValueProjection(value, {
      codecId: 'extension/parameterized@1',
      typeParams: { precision: 8 },
      many: true,
    }),
    new NativeJsonValueProjection(value),
    new JsonDocumentProjection(value),
  ];
}

describe('JSON containers with explicit projections', () => {
  it('freezes object entries without stripping projection classes', () => {
    const variants = projections(ColumnRef.of('record', 'value'));
    const object = JsonObjectExpr.fromEntries(
      variants.map((projection) => JsonObjectExpr.entry(projection.kind, projection)),
    );

    expect(Object.isFrozen(object)).toBe(true);
    expect(Object.isFrozen(object.entries)).toBe(true);
    expect(object.entries).toHaveLength(variants.length);
    for (const [index, entry] of object.entries.entries()) {
      expect(entry.value).toBe(variants[index]);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.value)).toBe(true);
    }
  });

  it('stores every projection class as a frozen array element', () => {
    for (const projection of projections(ColumnRef.of('record', 'value'))) {
      const array = JsonArrayAggExpr.of(projection);

      expect(Object.isFrozen(array)).toBe(true);
      expect(array.expr).toBe(projection);
      expect(array.expr.constructor).toBe(projection.constructor);
    }
  });

  it('rewrites object projections without changing their concrete classes', () => {
    const variants = projections(ColumnRef.of('record', 'value'));
    const object = JsonObjectExpr.fromEntries(
      variants.map((projection) => JsonObjectExpr.entry(projection.kind, projection)),
    );
    const rewritten = object.rewrite({
      columnRef: (column) => ColumnRef.of('rewritten', column.column),
    });

    expect(rewritten).toBeInstanceOf(JsonObjectExpr);
    if (!(rewritten instanceof JsonObjectExpr)) {
      throw new Error('Expected JsonObjectExpr');
    }

    for (const [index, entry] of rewritten.entries.entries()) {
      const original = variants[index];
      expect(original).toBeDefined();
      expect(entry.value.constructor).toBe(original?.constructor);
      expect(entry.value.value).toEqual(ColumnRef.of('rewritten', 'value'));
    }
  });

  it('rewrites array projections without changing their concrete classes', () => {
    for (const projection of projections(ColumnRef.of('record', 'value'))) {
      const rewritten = JsonArrayAggExpr.of(projection).rewrite({
        columnRef: (column) => ColumnRef.of('rewritten', column.column),
      });

      expect(rewritten).toBeInstanceOf(JsonArrayAggExpr);
      if (!(rewritten instanceof JsonArrayAggExpr)) {
        throw new Error('Expected JsonArrayAggExpr');
      }
      expect(rewritten.expr.constructor).toBe(projection.constructor);
      expect(rewritten.expr.value).toEqual(ColumnRef.of('rewritten', 'value'));
    }
  });

  it('folds and collects refs through object projections', () => {
    const column = ColumnRef.of('record', 'value');
    const param = ParamRef.of(1, { name: 'value' });
    const object = JsonObjectExpr.fromEntries(
      projections(BinaryExpr.eq(column, param)).map((projection) =>
        JsonObjectExpr.entry(projection.kind, projection),
      ),
    );

    expect(
      object.fold<string[]>({
        empty: [],
        combine: (left, right) => [...left, ...right],
        columnRef: (ref) => [`${ref.table}.${ref.column}`],
        paramRef: (ref) => [`$${String(ref.value)}`],
      }),
    ).toEqual(['record.value', '$1', 'record.value', '$1', 'record.value', '$1']);
    expect(object.collectColumnRefs()).toEqual([column, column, column]);
    expect(object.collectParamRefs()).toEqual([param, param, param]);
  });

  it('folds and collects refs through every array projection and order item', () => {
    const column = ColumnRef.of('record', 'value');
    const param = ParamRef.of(1, { name: 'value' });
    const orderColumn = ColumnRef.of('record', 'position');

    for (const projection of projections(BinaryExpr.eq(column, param))) {
      const array = JsonArrayAggExpr.of(projection, 'emptyArray', [OrderByItem.asc(orderColumn)]);

      expect(
        array.fold<string[]>({
          empty: [],
          combine: (left, right) => [...left, ...right],
          columnRef: (ref) => [`${ref.table}.${ref.column}`],
          paramRef: (ref) => [`$${String(ref.value)}`],
        }),
      ).toEqual(['record.value', '$1', 'record.position']);
      expect(array.collectColumnRefs()).toEqual([column, orderColumn]);
      expect(array.collectParamRefs()).toEqual([param]);
    }
  });
});
