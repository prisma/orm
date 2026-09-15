import { describe, expect, it, vi } from 'vitest';
import { ColumnRef, IdentifierRef, LiteralExpr, OperationExpr, ParamRef } from '../src/ast/types';
import { buildOperation, codecOf, type Expression, isExpression, toExpr } from '../src/expression';

const infixLowering = {
  targetFamily: 'sql',
  strategy: 'infix',
  template: '{{self}} ILIKE {{arg0}}',
} as const;

describe('toExpr', () => {
  it('throws RUNTIME.PARAM_REF_CODEC_REQUIRED for raw values without codec', () => {
    expect(() => toExpr('hello')).toThrow('Cannot construct a ParamRef');
  });

  it('wraps raw values in a ParamRef tagged with codec when provided', () => {
    const result = toExpr(42, { codecId: 'pg/int4@1' });
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBe(42);
    expect((result as ParamRef).codec).toEqual({ codecId: 'pg/int4@1' });
  });

  it('unwraps an Expression by calling its buildAst()', () => {
    const column = ColumnRef.of('users', 'email');
    const expression: Expression<{ codecId: 'pg/text@1'; nullable: false }> = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => column,
    };
    expect(toExpr(expression)).toBe(column);
  });

  it('accepts unmarked wrappers with callable buildAst', () => {
    const ast = LiteralExpr.of('hello');
    const buildAst = vi.fn(() => ast);
    const value = { buildAst, returnType: { codecId: 'pg/text@1', nullable: false } };
    expect(toExpr(value)).toBe(ast);
    expect(codecOf(value)).toEqual({ codecId: 'pg/text@1' });
    expect(isExpression(value)).toBe(true);
    expect(buildAst).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    undefined,
    42,
    'hello',
    () => LiteralExpr.of('hello'),
    {},
    { buildAst: 'not callable' },
  ])('rejects non-object or non-callable wrappers: %o', (value) => {
    expect(isExpression(value)).toBe(false);
    expect(toExpr(value, { codecId: 'pg/jsonb@1' })).toEqual(
      ParamRef.of(value, { codec: { codecId: 'pg/jsonb@1' } }),
    );
  });

  it('throws for null and undefined without codec', () => {
    expect(() => toExpr(null)).toThrow('Cannot construct a ParamRef');
    expect(() => toExpr(undefined)).toThrow('Cannot construct a ParamRef');
  });

  it('wraps null with codec as ParamRef', () => {
    const result = toExpr(null, { codecId: 'pg/text@1' });
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBeNull();
  });

  it('treats objects without buildAst as raw values', () => {
    const value = { notAnExpression: true };
    const result = toExpr(value, { codecId: 'pg/jsonb@1' });
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBe(value);
  });

  it('treats objects whose buildAst is not a function as raw values and requires codec', () => {
    const value = { buildAst: 'not a function' };
    expect(() => toExpr(value)).toThrow('Cannot construct a ParamRef');
    const result = toExpr(value, { codecId: 'pg/jsonb@1' });
    expect(result).toBeInstanceOf(ParamRef);
    expect((result as ParamRef).value).toBe(value);
  });

  it('stamps a parameterized codec ref onto the resulting ParamRef when provided', () => {
    const result = toExpr('alice@example.com', {
      codecId: 'sql/varchar@1',
      typeParams: { length: 320 },
    });
    expect(result).toBeInstanceOf(ParamRef);
    const ref = result as ParamRef;
    expect(ref.codec).toEqual({ codecId: 'sql/varchar@1', typeParams: { length: 320 } });
  });
});

describe('codecOf', () => {
  it('preserves the full returnType codec instead of falling back to codecId', () => {
    const codec = { codecId: 'pgvector/vector@1', typeParams: { length: 1536 } };
    const expr: Expression<{
      codecId: 'pgvector/vector@1';
      nullable: false;
      codec: typeof codec;
    }> = {
      returnType: { codecId: 'pgvector/vector@1', nullable: false, codec },
      buildAst: () => IdentifierRef.of('embedding'),
    };
    expect(codecOf(expr)).toEqual(codec);
  });

  it('derives CodecRef from returnType.codecId when no explicit codec metadata', () => {
    const expr: Expression<{ codecId: 'pg/text@1'; nullable: false }> = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => ColumnRef.of('user', 'email'),
    };
    expect(codecOf(expr)).toEqual({ codecId: 'pg/text@1' });
  });

  it('derives CodecRef from returnType.codecId for non-column AST expressions', () => {
    const expr: Expression<{ codecId: 'pg/text@1'; nullable: false }> = {
      returnType: { codecId: 'pg/text@1', nullable: false },
      buildAst: () => LiteralExpr.of('foo'),
    };
    expect(codecOf(expr)).toEqual({ codecId: 'pg/text@1' });
  });

  it('returns undefined for wrappers without codec metadata', () => {
    expect(codecOf({ buildAst: () => LiteralExpr.of('hello') })).toBeUndefined();
  });

  it('returns undefined for raw values', () => {
    expect(codecOf('plain string')).toBeUndefined();
    expect(codecOf(42)).toBeUndefined();
  });
});

describe('buildOperation', () => {
  it('exposes the return spec as returnType', () => {
    const self = ColumnRef.of('users', 'email');
    const returns = { codecId: 'pg/bool@1', nullable: false } as const;
    const expression = buildOperation({
      method: 'ilike',
      args: [self, LiteralExpr.of('%foo%')],
      returns,
      lowering: infixLowering,
    });
    expect(expression.returnType).toBe(returns);
  });

  it('produces an OperationExpr AST node populated from the spec', () => {
    const self = ColumnRef.of('users', 'email');
    const pattern = LiteralExpr.of('%foo%');
    const expression = buildOperation({
      method: 'ilike',
      args: [self, pattern],
      returns: { codecId: 'pg/bool@1', nullable: false },
      lowering: infixLowering,
    });

    const ast = expression.buildAst();
    expect(ast).toBeInstanceOf(OperationExpr);
    const op = ast as OperationExpr;
    expect(op.method).toBe('ilike');
    expect(op.self).toBe(self);
    expect(op.args).toEqual([pattern]);
    expect(op.returns).toEqual({ codecId: 'pg/bool@1', nullable: false });
    expect(op.lowering).toBe(infixLowering);
  });

  it('omits the args list in the AST when only self is supplied', () => {
    const self = ColumnRef.of('posts', 'body');
    const expression = buildOperation({
      method: 'length',
      args: [self],
      returns: { codecId: 'pg/int4@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'length({{self}})' },
    });

    const op = expression.buildAst() as OperationExpr;
    expect(op.self).toBe(self);
    expect(op.args).toEqual([]);
  });

  it('buildAst is idempotent — each call returns the same node', () => {
    const self = ColumnRef.of('t', 'c');
    const expression = buildOperation({
      method: 'upper',
      args: [self],
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'upper({{self}})' },
    });
    expect(expression.buildAst()).toBe(expression.buildAst());
  });

  it('result of buildOperation is itself an Expression consumable by toExpr', () => {
    const inner = buildOperation({
      method: 'upper',
      args: [ColumnRef.of('t', 'c')],
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'upper({{self}})' },
    });
    expect(toExpr(inner)).toBe(inner.buildAst());
  });
});
