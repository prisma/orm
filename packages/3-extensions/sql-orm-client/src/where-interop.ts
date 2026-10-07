import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression, ToWhereExpr, WhereArg } from '@internal/sql-relational-core/ast';
import { isWhereExpr } from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';
import { bindWhereExpr, type TableReferences } from './where-binding';

interface NormalizeWhereArgOptions {
  readonly contract: Contract<SqlStorage>;
  readonly tables: TableReferences;
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
    return arg.toWhereExpr();
  }

  if (options) {
    return bindWhereExpr(options.contract, arg, options.tables);
  }
  return arg;
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg && !isWhereExpr(arg);
}
