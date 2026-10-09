import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  ColumnRef,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  type WhereArg,
} from '@internal/sql-relational-core/ast';
import { isExpression } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import {
  columnOfCallerField,
  getModelFieldColumns,
  modelOf,
  resolveModelTableName,
} from './collection-contract';
import { hasTrait } from './column-codec';
import { ormError } from './orm-errors';
import { predicateComparison } from './predicate-comparison';
import { predicateExpression } from './predicate-expression';
import type {
  Condition,
  FunctionCondition,
  ShorthandWhereFilter,
  WhereCallbackResult,
} from './types';

/** The filter expression of a condition: a condition from `fns` becomes its AST. */
export function conditionExpr(condition: Condition): AnyExpression {
  return isFunctionCondition(condition) ? condition.buildAst() : condition;
}

/** A `where` callback's result as a filter: a condition from `fns` becomes its AST. */
export function whereArgOf(result: WhereCallbackResult): WhereArg {
  return isFunctionCondition(result) ? result.buildAst() : result;
}

function isFunctionCondition(value: Condition | WhereCallbackResult): value is FunctionCondition {
  return isExpression(value);
}

export function and(...exprs: Condition[]): AndExpr {
  return AndExpr.of(exprs.map(conditionExpr));
}

export function or(...exprs: Condition[]): OrExpr {
  return OrExpr.of(exprs.map(conditionExpr));
}

export function not(expr: Condition): AnyExpression {
  return conditionExpr(expr).not();
}

export function all(): AnyExpression {
  return AndExpr.true();
}

export function shorthandToWhereExpr<
  TContract extends Contract<SqlStorage>,
  NsId extends string,
  ModelName extends string,
>(
  context: ExecutionContext<TContract>,
  namespaceId: NsId,
  modelName: ModelName,
  filters: ShorthandWhereFilter<TContract, NsId, ModelName>,
): AnyExpression | undefined {
  const contract = context.contract;
  const tableName = resolveModelTableName(contract, namespaceId, modelName);
  const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);

  const exprs: AnyExpression[] = [];
  for (const [fieldName, value] of Object.entries(filters)) {
    if (value === undefined) {
      continue;
    }

    const left = ColumnRef.of(
      tableName,
      columnOfCallerField(contract, namespaceId, fieldColumns, modelName, fieldName),
    );

    if (value === null) {
      exprs.push(NullCheckExpr.isNull(left));
      continue;
    }

    assertFieldHasEqualityTrait(context, namespaceId, modelName, fieldName);
    exprs.push(
      predicateComparison('eq', left, predicateExpression(value) ?? LiteralExpr.of(value)),
    );
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}

function assertFieldHasEqualityTrait(
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  fieldName: string,
): void {
  const fieldType = modelOf(context.contract, namespaceId, modelName)?.fields?.[fieldName]?.type;
  const codecId = fieldType?.kind === 'scalar' ? fieldType.codecId : undefined;
  if (codecId === undefined || !hasTrait(context, codecId, 'equality')) {
    throw ormError(
      'ORM.FILTER_UNSUPPORTED',
      `Shorthand filter on "${modelName}.${fieldName}": field does not support equality comparisons`,
      { meta: { model: modelName, field: fieldName, trait: 'equality' } },
    );
  }
}
