import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  type AstRewriter,
  type ColumnRef,
  EqColJoinOn,
  isWhereExpr,
  type SelectAst,
  type ToWhereExpr,
  type WhereArg,
} from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';
import type { TableBinding } from './table-scope';
import { bindWhereExpr, type TableReferences } from './where-binding';

interface NormalizeWhereArgOptions {
  readonly contract: Contract<SqlStorage>;
  readonly tables: TableReferences;
  readonly rebaseOnto?: TableBinding | undefined;
}

export function normalizeWhereArg(arg: undefined): undefined;
export function normalizeWhereArg(arg: undefined, options: NormalizeWhereArgOptions): undefined;
export function normalizeWhereArg(arg: WhereArg, options?: NormalizeWhereArgOptions): AnyExpression;
export function normalizeWhereArg(
  arg: WhereArg | undefined,
  options?: NormalizeWhereArgOptions,
): AnyExpression | undefined;
export function normalizeWhereArg(
  arg: WhereArg | undefined,
  options?: NormalizeWhereArgOptions,
): AnyExpression | undefined {
  if (arg === undefined) {
    return undefined;
  }
  if (arg === null) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'WhereArg cannot be null. Pass undefined or a valid WhereExpr/ToWhereExpr payload.',
      { meta: { argument: 'where' } },
    );
  }

  const expr = isToWhereExpr(arg) ? arg.toWhereExpr() : arg;
  if (!options) {
    return expr;
  }
  return bindWhereExpr(
    options.contract,
    options.rebaseOnto ? rebaseOntoRoot(expr, options.rebaseOnto) : expr,
    options.tables,
  );
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg && !isWhereExpr(arg);
}

function declaresTable(ast: SelectAst, tableName: string): boolean {
  const sources = [
    ...(ast.from === undefined ? [] : [ast.from]),
    ...(ast.joins ?? []).map((join) => join.source),
  ];
  return sources.some(
    (source) =>
      (source.kind === 'table-source' && (source.alias ?? source.name) === tableName) ||
      (source.kind === 'derived-table-source' && source.alias === tableName),
  );
}

export function rebaseOntoRoot(expr: AnyExpression, root: TableBinding): AnyExpression {
  const { tableName } = root.storage;
  if (root.reference === tableName) {
    return expr;
  }
  const originals = new Map<ColumnRef, ColumnRef>();
  const rebase = (column: ColumnRef): ColumnRef => {
    if (column.table !== tableName) {
      return column;
    }
    const rebased = root.column(column.column);
    originals.set(rebased, column);
    return rebased;
  };
  const restore = (column: ColumnRef): ColumnRef => originals.get(column) ?? column;
  const restorer: AstRewriter = {
    columnRef: restore,
    eqColJoinOn: (on) => EqColJoinOn.of(restore(on.left), restore(on.right)),
  };
  const rebaser: AstRewriter = {
    columnRef: rebase,
    eqColJoinOn: (on) => EqColJoinOn.of(rebase(on.left), rebase(on.right)),
    select: (ast) => (declaresTable(ast, tableName) ? ast.rewrite(restorer) : ast),
  };
  return expr.rewrite(rebaser);
}
