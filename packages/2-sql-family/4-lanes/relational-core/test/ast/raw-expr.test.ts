import { describe, expect, it } from 'vitest';
import { type AnyExpression, type ExprVisitor, ParamRef, RawExpr } from '../../src/exports/ast';
import { col, lit, param } from './test-helpers';

describe('ast/RawExpr', () => {
  const returnsSpec = { codecId: 'pg/text@1', nullable: false } as const;

  it('freezes the parts array so mutation attempts throw', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    expect(() => {
      (expr.parts as string[]).push('extra');
    }).toThrow(TypeError);
  });

  it('inherits baseColumnRef throw from the base Expression class', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    expect(() => expr.baseColumnRef()).toThrow('RawExpr does not expose a base column reference');
  });

  it('dispatches to the rawSql arm of ExprVisitor', () => {
    const ref = param(1, 'x');
    const expr = new RawExpr({ parts: ['x = ', ref], returns: returnsSpec });

    const visited: string[] = [];
    // ExprVisitor.rawSql is a required arm — this object satisfies the full interface.
    // (Structural compile-time property: omitting rawSql would be a TypeScript error.)
    const visitor: ExprVisitor<string> = {
      columnRef: () => 'columnRef',
      identifierRef: () => 'identifierRef',
      subquery: () => 'subquery',
      operation: () => 'operation',
      aggregate: () => 'aggregate',
      functionCall: () => 'functionCall',
      cast: () => 'cast',
      case: () => 'case',
      jsonObject: () => 'jsonObject',
      jsonArrayAgg: () => 'jsonArrayAgg',
      binary: () => 'binary',
      and: () => 'and',
      or: () => 'or',
      exists: () => 'exists',
      nullCheck: () => 'nullCheck',
      not: () => 'not',
      literal: () => 'literal',
      param: (e) => {
        visited.push(`param:${String(e.value)}`);
        return 'param';
      },
      preparedParam: () => 'preparedParam',
      list: () => 'list',
      windowFunc: () => 'windowFunc',
      rawExpr: (e) => {
        visited.push(`rawExpr:${e.parts.length}`);
        return 'rawExpr';
      },
    };

    const result = expr.accept(visitor);
    expect(result).toBe('rawExpr');
    expect(visited).toEqual(['rawExpr:2']);
  });

  it('rewrites expression parts through the optional rawExpr rewriter arm', () => {
    const ref = param(1, 'x');
    const expr = new RawExpr({ parts: ['prefix ', ref, ' suffix'], returns: returnsSpec });

    const newRef = param(99, 'x');
    const rewritten = expr.rewrite({
      rawExpr: (e) =>
        new RawExpr({
          parts: e.parts.map((p) => (p instanceof ParamRef ? newRef : p)) as ReadonlyArray<
            string | AnyExpression
          >,
          returns: e.returns,
        }),
    });

    expect(rewritten).toBeInstanceOf(RawExpr);
    expect((rewritten as RawExpr).parts[1]).toBe(newRef);
  });

  it('returns self from rewrite when no rawExpr arm is provided', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });
    const rewritten = expr.rewrite({});
    expect(rewritten).toBe(expr);
  });

  it('folds using the optional rawExpr folder arm when provided', () => {
    const ref = param(1, 'x');
    const expr = new RawExpr({ parts: ['prefix ', ref], returns: returnsSpec });

    const result = expr.fold<string>({
      empty: '',
      combine: (a, b) => `${a}+${b}`,
      rawExpr: (e) => `raw:${e.parts.length}`,
    });

    expect(result).toBe('raw:2');
  });

  it('falls back to empty when no rawExpr folder arm is provided', () => {
    const expr = new RawExpr({ parts: ['now()'], returns: returnsSpec });

    const result = expr.fold<string[]>({
      empty: [],
      combine: (a, b) => [...a, ...b],
    });

    expect(result).toEqual([]);
  });

  it('collects param refs from expression elements in parts', () => {
    const ref1 = param(1, 'x');
    const ref2 = col('user', 'id');
    const ref3 = param(2, 'y');

    const expr = new RawExpr({
      parts: [ref1, ref2, ref3],
      returns: returnsSpec,
    });

    const collected = expr.collectParamRefs();
    expect(collected).toContain(ref1);
    expect(collected).toContain(ref3);
  });

  it('preserves empty-string parts from back-to-back interpolations', () => {
    const a = lit(1);
    const b = lit(2);
    const expr = new RawExpr({
      parts: ['', a, '', b, ''],
      returns: returnsSpec,
    });
    expect(expr.parts).toEqual(['', a, '', b, '']);
  });
});
