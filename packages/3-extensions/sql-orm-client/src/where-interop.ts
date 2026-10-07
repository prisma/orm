import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression, ToWhereExpr, WhereArg } from '@internal/sql-relational-core/ast';
import { isWhereExpr } from '@internal/sql-relational-core/ast';
import { rebaseOntoRoot } from './collection-tables';
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

  if (isToWhereExpr(arg)) {
    const expr = arg.toWhereExpr();
    return options?.rebaseOnto ? rebaseOntoRoot(expr, options.rebaseOnto) : expr;
  }

  if (options) {
    return bindWhereExpr(
      options.contract,
      options.rebaseOnto ? rebaseOntoRoot(arg, options.rebaseOnto) : arg,
      options.tables,
    );
  }
  return arg;
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg && !isWhereExpr(arg);
}
