import type {
  AnyExpression,
  AnyFromSource,
  ExprVisitor,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';

export function validatePredicateParameters(expr: AnyExpression): void {
  visit(expr, false);
}

function visit(expr: AnyExpression | undefined, comparison: boolean): void {
  expr?.accept(visitor(comparison));
}

function visitor(comparison: boolean): ExprVisitor<void> {
  const child = (expr: AnyExpression | undefined) => visit(expr, comparison);
  return {
    columnRef() {},
    identifierRef() {},
    literal() {},
    param() {},
    rawExpr() {},
    preparedParam(ref) {
      if (comparison && ref.nullable) {
        throw ormError(
          'ORM.FILTER_UNSUPPORTED',
          `Structured ORM comparisons do not support nullable prepared parameter "${ref.name}"`,
          { meta: { parameter: ref.name } },
        );
      }
    },
    binary(expr) {
      visit(expr.left, true);
      visit(expr.right, true);
    },
    list: (expr) => expr.values.forEach(child),
    and: (expr) => expr.exprs.forEach(child),
    or: (expr) => expr.exprs.forEach(child),
    not: (expr) => child(expr.expr),
    nullCheck: (expr) => child(expr.expr),
    cast: (expr) => child(expr.expr),
    aggregate: (expr) => child(expr.expr),
    functionCall: (expr) => expr.args.forEach(child),
    operation(expr) {
      child(expr.self);
      expr.args?.forEach(child);
    },
    case(expr) {
      for (const branch of expr.branches) {
        child(branch.condition);
        child(branch.value);
      }
      child(expr.elseExpr);
    },
    windowFunc(expr) {
      expr.args?.forEach(child);
      expr.partitionBy?.forEach(child);
      for (const item of expr.orderBy ?? []) child(item.expr);
    },
    jsonObject(expr) {
      for (const entry of expr.entries) child(entry.value.value);
    },
    jsonArrayAgg(expr) {
      child(expr.expr.value);
      for (const item of expr.orderBy ?? []) child(item.expr);
    },
    subquery: (expr) => visitSelect(expr.query, comparison),
    exists: (expr) => visitSelect(expr.subquery),
  };
}

function visitSource(source: AnyFromSource | undefined): void {
  if (source?.kind === 'derived-table-source') visitSelect(source.query);
  if (source?.kind === 'function-source') source.args.forEach(validatePredicateParameters);
}

function visitSelect(ast: SelectAst, comparison = false): void {
  visitSource(ast.from);
  for (const join of ast.joins ?? []) {
    visitSource(join.source);
    if (join.on.kind !== 'eq-col-join-on') validatePredicateParameters(join.on);
  }
  for (const item of ast.projection) visit(item.expr, comparison);
  visit(ast.where, false);
  visit(ast.having, false);
  for (const item of ast.orderBy ?? []) validatePredicateParameters(item.expr);
  ast.groupBy?.forEach(validatePredicateParameters);
  ast.distinctOn?.forEach(validatePredicateParameters);
  if (typeof ast.limit === 'object') validatePredicateParameters(ast.limit);
  if (typeof ast.offset === 'object') validatePredicateParameters(ast.offset);
}
