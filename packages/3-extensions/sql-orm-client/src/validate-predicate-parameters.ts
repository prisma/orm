import {
  type AnyExpression,
  BinaryExpr,
  type ExprVisitor,
  type PreparedParamRef,
} from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';

export function normalizePredicateParameters(expr: AnyExpression): AnyExpression {
  return expr.rewrite({
    binary(comparison) {
      const ref = nullableOperand(comparison.left) ?? nullableOperand(comparison.right);
      if (!ref) return comparison;
      if (comparison.op === 'eq' || comparison.op === 'neq') {
        return new BinaryExpr(
          comparison.op === 'eq' ? 'isNotDistinctFrom' : 'isDistinctFrom',
          comparison.left,
          comparison.right,
        );
      }
      if (comparison.op === 'isNotDistinctFrom' || comparison.op === 'isDistinctFrom') {
        return comparison;
      }
      throw ormError(
        'ORM.FILTER_UNSUPPORTED',
        `Structured ORM ${comparison.op} comparisons do not support nullable prepared parameter "${ref.name}"`,
        { meta: { parameter: ref.name } },
      );
    },
  });
}

function nullableOperand(expr: AnyExpression | undefined): PreparedParamRef | undefined {
  return expr?.accept(nullableVisitor);
}

function nullableOperands(exprs: readonly AnyExpression[]): PreparedParamRef | undefined {
  for (const expr of exprs) {
    const ref = nullableOperand(expr);
    if (ref) return ref;
  }
  return undefined;
}

const nullableVisitor: ExprVisitor<PreparedParamRef | undefined> = {
  columnRef: () => undefined,
  identifierRef: () => undefined,
  literal: () => undefined,
  param: () => undefined,
  rawExpr: () => undefined,
  preparedParam: (ref) => (ref.nullable ? ref : undefined),
  binary: () => undefined,
  exists: () => undefined,
  nullCheck: () => undefined,
  list: (expr) => nullableOperands(expr.values),
  and: (expr) => nullableOperands(expr.exprs),
  or: (expr) => nullableOperands(expr.exprs),
  not: (expr) => nullableOperand(expr.expr),
  cast: (expr) => nullableOperand(expr.expr),
  aggregate: (expr) => nullableOperand(expr.expr),
  functionCall: (expr) => nullableOperands(expr.args),
  operation: (expr) => nullableOperands([expr.self, ...(expr.args ?? [])]),
  case: (expr) =>
    nullableOperands(expr.branches.map((branch) => branch.value)) ?? nullableOperand(expr.elseExpr),
  windowFunc: (expr) => nullableOperands(expr.args ?? []),
  jsonObject: (expr) => nullableOperands(expr.entries.map((entry) => entry.value.value)),
  jsonArrayAgg: (expr) => nullableOperand(expr.expr.value),
  subquery: (expr) => nullableOperands(expr.query.projection.map((item) => item.expr)),
};
