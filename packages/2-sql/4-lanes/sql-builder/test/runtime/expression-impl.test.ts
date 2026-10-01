import { BinaryExpr, ColumnRef, LiteralExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { ExpressionImpl } from '../../src/runtime/expression-impl';
import type { ScopeField } from '../../src/scope';

describe('ExpressionImpl', () => {
  it('wraps an AST node with field metadata', () => {
    const col = ColumnRef.of('users', 'id');
    const scopeField: ScopeField = { codecId: 'pg/int4@1', nullable: false };
    const expr = new ExpressionImpl(col, scopeField);

    expect(expr).toBeInstanceOf(ExpressionImpl);
    expect(expr.buildAst()).toBe(col);
    expect(expr.returnType).toEqual(scopeField);
  });

  it('keeps codec metadata only on returnType', () => {
    const scopeField = {
      codecId: 'pgvector/vector@1',
      nullable: false,
      codec: { codecId: 'pgvector/vector@1', typeParams: { length: 1536 } },
    };
    const expr = new ExpressionImpl(ColumnRef.of('posts', 'embedding'), scopeField);

    expect(expr.returnType).toBe(scopeField);
    expect(expr).not.toHaveProperty('codec');
  });

  it('uses the third argument only for projection rendering', () => {
    const ast = LiteralExpr.of(42);
    const projectionAst = LiteralExpr.of('42');
    const expr = new ExpressionImpl(ast, { codecId: 'pg/int8@1', nullable: false }, projectionAst);

    expect(expr.buildAst()).toBe(ast);
    expect(expr.buildProjectionAst()).toBe(projectionAst);
  });

  it('wraps a predicate Expression node', () => {
    const binary = BinaryExpr.eq(ColumnRef.of('users', 'id'), ParamRef.of(1));
    const scopeField: ScopeField = { codecId: 'pg/bool@1', nullable: false };
    const expr = new ExpressionImpl(binary, scopeField);

    expect(expr.buildAst()).toBe(binary);
  });
});
