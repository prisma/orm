import type { AnyExpression, BinaryOp, ExprVisitor } from '@internal/sql-relational-core/ast';

const binaryOperators: Record<BinaryOp, string> = {
  eq: '=',
  neq: '<>',
  isNotDistinctFrom: 'is not distinct from',
  isDistinctFrom: 'is distinct from',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'like',
  in: 'in',
  notIn: 'not in',
};

function printValue(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function printKind(expr: { readonly kind: string }): string {
  return `<${expr.kind}>`;
}

export function printExpression(expr: AnyExpression, tableName: string): string {
  const print = (inner: AnyExpression): string => inner.accept(printer);
  const printer: ExprVisitor<string> = {
    columnRef: (ref) => (ref.table === tableName ? ref.column : `${ref.table}.${ref.column}`),
    identifierRef: (ref) => ref.name,
    param: (param) => printValue(param.value),
    literal: (literal) => printValue(literal.value),
    list: (list) => `(${list.values.map(print).join(', ')})`,
    binary: (binary) =>
      `${print(binary.left)} ${binaryOperators[binary.op]} ${print(binary.right)}`,
    and: (and) => (and.exprs.length === 0 ? 'true' : `(${and.exprs.map(print).join(' and ')})`),
    or: (or) => (or.exprs.length === 0 ? 'false' : `(${or.exprs.map(print).join(' or ')})`),
    not: (not) => `not (${print(not.expr)})`,
    nullCheck: (check) => `${print(check.expr)} ${check.isNull ? 'is null' : 'is not null'}`,
    exists: printKind,
    subquery: printKind,
    operation: printKind,
    aggregate: printKind,
    windowFunc: printKind,
    functionCall: printKind,
    cast: printKind,
    case: printKind,
    jsonObject: printKind,
    jsonArrayAgg: printKind,
    preparedParam: printKind,
    rawExpr: printKind,
  };
  return print(expr);
}
