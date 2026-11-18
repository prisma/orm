import { describe, expect, it } from 'vitest';
import {
  BinaryExpr,
  ColumnRef,
  ListExpression,
  PreparedParamRef,
  SelectAst,
  TableSource,
} from '../../src/ast/types';

describe('PreparedParamRef declaration metadata', () => {
  it('retains nullability and frozen codec metadata through AST rewrites', () => {
    const codec = { codecId: 'test/value@1', typeParams: { size: 4 } };
    const nullable = PreparedParamRef.of('value', codec, true);
    const required = new PreparedParamRef('required', codec, false);
    expect(nullable.nullable).toBe(true);
    expect(required.nullable).toBe(false);
    expect(PreparedParamRef.of('default', codec).nullable).toBe(false);
    expect(Object.isFrozen(nullable)).toBe(true);
    expect(Object.isFrozen(nullable.codec)).toBe(true);
    codec.typeParams.size = 9;
    expect(nullable.codec.typeParams).toEqual({ size: 4 });
    const ast = SelectAst.from(TableSource.named('items')).withWhere(
      BinaryExpr.in(ColumnRef.of('items', 'value'), ListExpression.of([nullable, required])),
    );
    const rewritten = ast.rewrite({});
    expect(rewritten.collectParamRefs()).toEqual([nullable, required]);
    expect(rewritten.collectParamRefs()[0]).toBe(nullable);
    const clone = nullable.rewrite({
      preparedParamRef: (ref) => new PreparedParamRef(ref.name, ref.codec, ref.nullable),
    });
    expect(clone).toEqual(nullable);
    expect(clone).not.toBe(nullable);
  });
});
