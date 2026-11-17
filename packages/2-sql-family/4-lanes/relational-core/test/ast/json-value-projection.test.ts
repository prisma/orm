import { describe, expect, it } from 'vitest';
import {
  type AnyJsonValueProjection,
  BinaryExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonDocumentProjection,
  type JsonValueProjectionVisitor,
  NativeJsonValueProjection,
  ParamRef,
  type ProjectionExpr,
} from '../../src/exports/ast';

type NestedTypeParams = {
  dimensions: number;
  options: {
    labels: string[];
    precision: number;
  };
};

function expressionWithRefs(): {
  column: ColumnRef;
  expression: BinaryExpr;
  param: ParamRef;
} {
  const column = ColumnRef.of('record', 'value');
  const param = ParamRef.of(1, { name: 'value' });
  return {
    column,
    expression: BinaryExpr.eq(column, param),
    param,
  };
}

function projections(value: ProjectionExpr): {
  codec: CodecJsonValueProjection;
  document: JsonDocumentProjection;
  native: NativeJsonValueProjection;
} {
  return {
    codec: new CodecJsonValueProjection(value, {
      codecId: 'extension/parameterized@1',
      typeParams: { dimensions: 1536 },
      many: true,
    }),
    document: new JsonDocumentProjection(value),
    native: new NativeJsonValueProjection(value),
  };
}

describe('JSON value projection algebra', () => {
  it('constructs frozen class instances for every variant', () => {
    const value = ColumnRef.of('record', 'value');
    const variants = projections(value);

    expect(variants.codec).toBeInstanceOf(CodecJsonValueProjection);
    expect(variants.native).toBeInstanceOf(NativeJsonValueProjection);
    expect(variants.document).toBeInstanceOf(JsonDocumentProjection);
    expect(Object.isFrozen(variants.codec)).toBe(true);
    expect(Object.isFrozen(variants.native)).toBe(true);
    expect(Object.isFrozen(variants.document)).toBe(true);
    expect(variants.codec.value).toBe(value);
    expect(variants.native.value).toBe(value);
    expect(variants.document.value).toBe(value);
  });

  it('dispatches every variant through the exhaustive visitor', () => {
    const value = ColumnRef.of('record', 'value');
    const variants = projections(value);
    const visitor: JsonValueProjectionVisitor<string> = {
      codec: (projection) => `${projection.kind}:${projection.codec.codecId}`,
      native: (projection) => projection.kind,
      document: (projection) => projection.kind,
    };

    expect(variants.codec.accept(visitor)).toBe('codec:extension/parameterized@1');
    expect(variants.native.accept(visitor)).toBe('native');
    expect(variants.document.accept(visitor)).toBe('document');
  });

  it('rewrites wrapped expressions without changing concrete variants', () => {
    const { expression } = expressionWithRefs();
    const variants = projections(expression);
    const all: ReadonlyArray<AnyJsonValueProjection> = [
      variants.codec,
      variants.native,
      variants.document,
    ];

    for (const projection of all) {
      const rewritten = projection.rewrite({
        columnRef: (column) => ColumnRef.of('rewritten', column.column),
        paramRef: (param) =>
          ParamRef.of(Number(param.value) + 1, {
            ...(param.name === undefined ? {} : { name: param.name }),
          }),
      });

      expect(rewritten).not.toBe(projection);
      expect(rewritten.constructor).toBe(projection.constructor);
      expect(rewritten.kind).toBe(projection.kind);
      expect(rewritten.value).toEqual(
        BinaryExpr.eq(ColumnRef.of('rewritten', 'value'), ParamRef.of(2, { name: 'value' })),
      );
      expect(Object.isFrozen(rewritten)).toBe(true);
    }

    expect(variants.codec.rewrite({}).codec).toEqual(variants.codec.codec);
  });

  it('folds and collects column and parameter refs through every variant', () => {
    const { column, expression, param } = expressionWithRefs();
    const variants: ReadonlyArray<AnyJsonValueProjection> = Object.values(projections(expression));

    for (const projection of variants) {
      expect(
        projection.fold<string[]>({
          empty: [],
          combine: (left, right) => [...left, ...right],
          columnRef: (ref) => [`${ref.table}.${ref.column}`],
          paramRef: (ref) => [`$${String(ref.value)}`],
        }),
      ).toEqual(['record.value', '$1']);
      expect(projection.collectColumnRefs()).toEqual([column]);
      expect(projection.collectParamRefs()).toEqual([param]);
    }
  });

  it('defensively copies and deeply freezes complete codec refs', () => {
    const typeParams: NestedTypeParams = {
      dimensions: 1536,
      options: {
        labels: ['dense', 'cosine'],
        precision: 8,
      },
    };
    const codec = {
      codecId: 'extension/vector@1',
      typeParams,
      many: true,
    };
    const projection = new CodecJsonValueProjection(ColumnRef.of('record', 'embedding'), codec);

    codec.codecId = 'changed@1';
    codec.many = false;
    typeParams.dimensions = 3;
    typeParams.options.precision = 2;
    typeParams.options.labels.push('mutated');

    expect(projection.codec).toEqual({
      codecId: 'extension/vector@1',
      typeParams: {
        dimensions: 1536,
        options: {
          labels: ['dense', 'cosine'],
          precision: 8,
        },
      },
      many: true,
    });
    expect(projection.codec).not.toBe(codec);
    expect(projection.codec.typeParams).not.toBe(typeParams);
    expect(Object.isFrozen(projection.codec)).toBe(true);

    const storedTypeParams = projection.codec.typeParams as NestedTypeParams;
    expect(Object.isFrozen(storedTypeParams)).toBe(true);
    expect(Object.isFrozen(storedTypeParams.options)).toBe(true);
    expect(Object.isFrozen(storedTypeParams.options.labels)).toBe(true);
    expect(() => {
      storedTypeParams.options.precision = 1;
    }).toThrow(TypeError);
    expect(() => {
      storedTypeParams.options.labels.push('blocked');
    }).toThrow(TypeError);
  });

  it('exposes stable kind discriminants', () => {
    const variants = projections(ColumnRef.of('record', 'value'));
    const kinds: ReadonlyArray<AnyJsonValueProjection['kind']> = [
      variants.codec.kind,
      variants.native.kind,
      variants.document.kind,
    ];

    expect(kinds).toEqual(['codec', 'native', 'document']);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
