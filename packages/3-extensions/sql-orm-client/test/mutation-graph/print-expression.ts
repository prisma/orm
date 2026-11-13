import type {
  AnyExpression,
  AnyFromSource,
  BinaryOp,
  ExprVisitor,
  JoinAst,
  SelectAst,
} from '@internal/sql-relational-core/ast';

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

function sourceOf(source: AnyFromSource | undefined): { name: string; alias: string } {
  const name = source?.kind === 'table-source' ? source.name : '';
  return { name, alias: source?.kind === 'table-source' ? (source.alias ?? name) : '' };
}

function printJoin(join: JoinAst, alias: string): string {
  const { name, alias: joined } = sourceOf(join.source);
  const source = joined === name ? name : `${name} ${joined}`;
  const on =
    join.on.kind === 'eq-col-join-on'
      ? `${join.on.left.table}.${join.on.left.column} = ${join.on.right.table}.${join.on.right.column}`
      : printExpression(join.on, alias);
  return ` ${join.joinType} join ${source} on ${on}`;
}

function printSelect(query: SelectAst): string {
  const { name, alias } = sourceOf(query.from);
  const source = alias === name ? name : `${name} ${alias}`;
  const columns = query.projection.map((item) => printExpression(item.expr, alias));
  const joins = (query.joins ?? []).map((join) => printJoin(join, alias)).join('');
  const where = query.where === undefined ? '' : ` where ${printExpression(query.where, alias)}`;
  return `(select ${columns.join(', ')} from ${source}${joins}${where})`;
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
    exists: ({ subquery, notExists }) =>
      `${notExists ? 'not exists' : 'exists'} ${printSelect(subquery)}`,
    subquery: ({ query }) => printSelect(query),
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
