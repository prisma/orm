import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression, ToWhereExpr, WhereArg } from '@internal/sql-relational-core/ast';
import { isWhereExpr } from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';
import { bindWhereExpr } from './where-binding';

interface NormalizeWhereArgOptions {
  readonly contract?: Contract<SqlStorage>;
  readonly namespaceId?: string | undefined;
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

  if (options?.contract) {
    return bindWhereExpr(options.contract, arg, options.namespaceId);
  }
  return arg;
}

function isToWhereExprInput(value: unknown): value is ToWhereExpr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toWhereExpr' in value &&
    typeof value.toWhereExpr === 'function'
  );
}

export function isWhereDirectInput(value: unknown): value is WhereArg {
  return (
    (isWhereExpr(value) &&
      typeof value === 'object' &&
      value !== null &&
      'accept' in value &&
      typeof value.accept === 'function') ||
    isToWhereExprInput(value)
  );
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg && !isWhereExpr(arg);
}
