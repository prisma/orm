import { describe, expect, it } from 'vitest';
import {
  BinaryExpr,
  CaseExpr,
  CastExpr,
  type ExprVisitor,
  FunctionCallExpr,
  NullCheckExpr,
} from '../../src/exports/ast';
import { col, lit, param, shiftParamRef } from './test-helpers';

function expressionVisitor(): ExprVisitor<string> {
  return {
    columnRef: () => 'columnRef',
    identifierRef: () => 'identifierRef',
    subquery: () => 'subquery',
    operation: () => 'operation',
    aggregate: () => 'aggregate',
    windowFunc: () => 'windowFunc',
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
    param: () => 'param',
    preparedParam: () => 'preparedParam',
    list: () => 'list',
    rawExpr: () => 'rawExpr',
  };
}

describe('scalar projection expressions', () => {
  it('freezes construction inputs and dispatches each visitor arm', () => {
    const args = [col('record', 'name'), param(1, 'suffix')];
    const functionCall = FunctionCallExpr.of('concat', args);
    const cast = CastExpr.as(functionCall, 'text');
    const branch = {
      condition: BinaryExpr.eq(col('record', 'active'), param(2, 'active')),
      value: cast,
    };
    const branches = [branch];
    const caseExpr = CaseExpr.of(branches, lit('fallback'));

    args.push(col('record', 'ignored'));
    branch.value = CastExpr.as(lit('changed'), 'text');
    branches.push({
      condition: BinaryExpr.eq(col('record', 'active'), param(3, 'other')),
      value: cast,
    });

    expect(Object.isFrozen(functionCall)).toBe(true);
    expect(Object.isFrozen(functionCall.args)).toBe(true);
    expect(functionCall.args).toHaveLength(2);
    expect(Object.isFrozen(cast)).toBe(true);
    expect(Object.isFrozen(caseExpr)).toBe(true);
    expect(Object.isFrozen(caseExpr.branches)).toBe(true);
    expect(Object.isFrozen(caseExpr.branches[0])).toBe(true);
    expect(caseExpr.branches).toHaveLength(1);
    expect(caseExpr.branches[0]?.value).toBe(cast);

    const visitor = expressionVisitor();
    expect(functionCall.accept(visitor)).toBe('functionCall');
    expect(cast.accept(visitor)).toBe('cast');
    expect(caseExpr.accept(visitor)).toBe('case');
  });

  it('preserves concrete expression identity through toExpr', () => {
    const functionCall = FunctionCallExpr.of('lower', [col('record', 'name')]);
    const expressions = [
      functionCall,
      CastExpr.as(functionCall, 'text'),
      CaseExpr.of([{ condition: lit(true), value: functionCall }]),
    ];

    for (const expression of expressions) {
      expect(expression.toExpr()).toBe(expression);
    }
  });

  it('rejects an empty searched CASE and preserves an omitted ELSE', () => {
    expect(() => CaseExpr.of([])).toThrow(
      expect.objectContaining({
        name: 'StructuredError',
        code: 'RUNTIME.AST_INVALID',
        message: 'CaseExpr requires at least one branch',
        meta: { kind: 'case', field: 'branches' },
      }),
    );

    const caseExpr = CaseExpr.of([
      {
        condition: BinaryExpr.eq(col('record', 'active'), lit(true)),
        value: lit('active'),
      },
    ]);
    const rewritten = caseExpr.rewrite({});

    expect(caseExpr.elseExpr).toBeUndefined();
    expect(rewritten).toBeInstanceOf(CaseExpr);
    if (!(rewritten instanceof CaseExpr)) {
      throw new Error('Expected CaseExpr');
    }
    expect(rewritten.elseExpr).toBeUndefined();
  });

  it('rewrites nested nodes without changing their concrete classes', () => {
    const expression = CaseExpr.of(
      [
        {
          condition: BinaryExpr.eq(col('source', 'flag'), param(1, 'flag')),
          value: CastExpr.as(
            FunctionCallExpr.of('concat', [col('source', 'name'), param(2, 'suffix')]),
            'text',
          ),
        },
        {
          condition: NullCheckExpr.isNull(col('source', 'deletedAt')),
          value: FunctionCallExpr.of('coalesce', [col('source', 'fallback'), param(3, 'default')]),
        },
      ],
      param(4, 'else'),
    );

    const rewritten = expression.rewrite({
      columnRef: (column) => col('target', column.column),
      paramRef: shiftParamRef(10),
    });

    expect(rewritten).toBeInstanceOf(CaseExpr);
    if (!(rewritten instanceof CaseExpr)) {
      throw new Error('Expected CaseExpr');
    }
    const firstValue = rewritten.branches[0]?.value;
    expect(firstValue).toBeInstanceOf(CastExpr);
    if (!(firstValue instanceof CastExpr)) {
      throw new Error('Expected CastExpr');
    }
    expect(firstValue.expr).toBeInstanceOf(FunctionCallExpr);
    expect(rewritten.branches[1]?.value).toBeInstanceOf(FunctionCallExpr);
    expect(rewritten).toEqual(
      CaseExpr.of(
        [
          {
            condition: BinaryExpr.eq(col('target', 'flag'), param(11, 'flag')),
            value: CastExpr.as(
              FunctionCallExpr.of('concat', [col('target', 'name'), param(12, 'suffix')]),
              'text',
            ),
          },
          {
            condition: NullCheckExpr.isNull(col('target', 'deletedAt')),
            value: FunctionCallExpr.of('coalesce', [
              col('target', 'fallback'),
              param(13, 'default'),
            ]),
          },
        ],
        param(14, 'else'),
      ),
    );
  });

  it('folds and collects nested columns and parameters in SQL order', () => {
    const flag = col('source', 'flag');
    const flagParam = param(1, 'flag');
    const name = col('source', 'name');
    const suffixParam = param(2, 'suffix');
    const deletedAt = col('source', 'deletedAt');
    const fallback = col('source', 'fallback');
    const defaultParam = param(3, 'default');
    const elseParam = param(4, 'else');
    const expression = CaseExpr.of(
      [
        {
          condition: BinaryExpr.eq(flag, flagParam),
          value: CastExpr.as(FunctionCallExpr.of('concat', [name, suffixParam]), 'text'),
        },
        {
          condition: NullCheckExpr.isNull(deletedAt),
          value: FunctionCallExpr.of('coalesce', [fallback, defaultParam]),
        },
      ],
      elseParam,
    );

    expect(
      expression.fold<string[]>({
        empty: [],
        combine: (left, right) => [...left, ...right],
        columnRef: (column) => [`${column.table}.${column.column}`],
        paramRef: (ref) => [`$${String(ref.value)}`],
      }),
    ).toEqual([
      'source.flag',
      '$1',
      'source.name',
      '$2',
      'source.deletedAt',
      'source.fallback',
      '$3',
      '$4',
    ]);
    expect(expression.collectColumnRefs()).toEqual([flag, name, deletedAt, fallback]);
    expect(expression.collectParamRefs()).toEqual([
      flagParam,
      suffixParam,
      defaultParam,
      elseParam,
    ]);
  });
});
