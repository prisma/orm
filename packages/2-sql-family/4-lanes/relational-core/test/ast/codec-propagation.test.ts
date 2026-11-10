import { describe, expect, it } from 'vitest';
import {
  AndExpr,
  BinaryExpr,
  type CodecRef,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '../../src/exports/ast';
import { shiftParamRef } from './test-helpers';

const userEmailCodec: CodecRef = {
  codecId: 'sql/varchar@1',
  typeParams: { length: 320 },
};

function selectWithEmailFilter(ref: ParamRef): SelectAst {
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('email', ColumnRef.of('user', 'email'), userEmailCodec)])
    .withWhere(AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'email'), ref)]));
}

describe('ParamRef codec — AST rewriter propagation', () => {
  it('ParamRef.rewrite with no paramRef rewriter returns the same instance (codec preserved)', () => {
    const original = ParamRef.of('a@b.com', {
      name: 'p1',
      codec: userEmailCodec,
    });
    const rewritten = original.rewrite({});
    expect(rewritten).toBe(original);
  });

  it('SelectAst.rewrite with an identity paramRef rewriter preserves codec on every ParamRef', () => {
    const ref = ParamRef.of('a@b.com', {
      name: 'p1',
      codec: userEmailCodec,
    });
    const ast = selectWithEmailFilter(ref);

    const rewritten = ast.rewrite({ paramRef: (p) => p });

    const rewrittenWhere = rewritten.where as AndExpr;
    const eq = rewrittenWhere.exprs[0] as BinaryExpr;
    const right = eq.right as ParamRef;
    expect(right.codec).toEqual(userEmailCodec);
  });

  it('SelectAst.rewrite with a non-identity paramRef rewriter that propagates codec preserves it', () => {
    const ageCodec: CodecRef = { codecId: 'sql/int@1' };
    const ref = ParamRef.of(7, {
      name: 'p1',
      codec: ageCodec,
    });
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'age'), ref)]));

    const rewritten = ast.rewrite({ paramRef: shiftParamRef(10) });

    const where = rewritten.where as AndExpr;
    const eq = where.exprs[0] as BinaryExpr;
    const right = eq.right as ParamRef;
    expect(right.value).toBe(17);
    expect(right.codec).toEqual(ageCodec);
  });

  it('SelectAst.rewrite preserves ProjectionItem codec through rewriteProjectionItem', () => {
    const ref = ParamRef.of('a@b.com', {
      name: 'p1',
      codec: userEmailCodec,
    });
    const ast = selectWithEmailFilter(ref);

    const rewritten = ast.rewrite({
      columnRef: (c) => (c.table === 'user' ? ColumnRef.of('member', c.column) : c),
    });

    const projection = rewritten.projection[0];
    expect(projection?.codec).toEqual(userEmailCodec);
  });

  it('ParamRef deep-clones and freezes nested codec.typeParams', () => {
    const mutableTypeParams = {
      dimensions: 1536,
      options: { labels: ['dense', 'cosine'] },
    };
    const ref = ParamRef.of([0], {
      codec: { codecId: 'pg/vector@1', typeParams: mutableTypeParams },
    });
    mutableTypeParams.dimensions = 99;
    mutableTypeParams.options.labels.push('mutated');

    const storedTypeParams = ref.codec!.typeParams as typeof mutableTypeParams;
    expect(storedTypeParams).toEqual({
      dimensions: 1536,
      options: { labels: ['dense', 'cosine'] },
    });
    expect(Object.isFrozen(storedTypeParams)).toBe(true);
    expect(Object.isFrozen(storedTypeParams.options)).toBe(true);
    expect(Object.isFrozen(storedTypeParams.options.labels)).toBe(true);
  });

  it('ProjectionItem deep-clones codec.typeParams so caller mutations after construction do not leak in', () => {
    const mutableTypeParams: { length: number } = { length: 1536 };
    const item = ProjectionItem.of('embedding', ColumnRef.of('doc', 'embedding'), {
      codecId: 'pg/vector@1',
      typeParams: mutableTypeParams,
    });
    mutableTypeParams.length = 99;
    expect((item.codec!.typeParams as { length: number }).length).toBe(1536);
  });

  it.each([
    {
      codec: { codecId: 'pg/vector@1' },
      expectedMany: undefined,
      hasMany: false,
    },
    {
      codec: { codecId: 'pg/vector@1', many: false },
      expectedMany: false,
      hasMany: true,
    },
    {
      codec: { codecId: 'pg/vector@1', many: true },
      expectedMany: true,
      hasMany: true,
    },
  ] satisfies ReadonlyArray<{
    codec: CodecRef;
    expectedMany: boolean | undefined;
    hasMany: boolean;
  }>)('ProjectionItem preserves codec many=$expectedMany', ({ codec, expectedMany, hasMany }) => {
    const item = ProjectionItem.of('embedding', ColumnRef.of('doc', 'embedding'), codec);

    expect(item.codec!.many).toBe(expectedMany);
    expect(Object.hasOwn(item.codec!, 'many')).toBe(hasMany);
  });

  it('ProjectionItem.withCodec replaces the stamped CodecRef', () => {
    const item = ProjectionItem.of('email', ColumnRef.of('user', 'email'), userEmailCodec);
    const replacement: CodecRef = { codecId: 'sql/varchar@1', typeParams: { length: 64 } };
    const updated = item.withCodec(replacement);
    expect(updated.codec).toEqual(replacement);
    expect(updated.alias).toBe(item.alias);
    expect(updated.expr).toBe(item.expr);
  });
});
