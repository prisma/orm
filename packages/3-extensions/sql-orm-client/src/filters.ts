import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { getFieldToColumnMap, modelOf, resolveModelTableName } from './collection-contract';
import { ormError } from './orm-errors';
import type { ShorthandWhereFilter } from './types';

export function and(...exprs: AnyExpression[]): AndExpr {
  return AndExpr.of(exprs);
}

export function or(...exprs: AnyExpression[]): OrExpr {
  return OrExpr.of(exprs);
}

export function not(expr: AnyExpression): AnyExpression {
  return expr.not();
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
  const fieldToColumn = getFieldToColumnMap(contract, namespaceId, modelName);

  const exprs: AnyExpression[] = [];
  for (const [fieldName, value] of Object.entries(filters)) {
    if (value === undefined) {
      continue;
    }

    const columnName = fieldToColumn[fieldName] ?? fieldName;
    const left = ColumnRef.of(tableName, columnName);

    if (value === null) {
      exprs.push(NullCheckExpr.isNull(left));
      continue;
    }

    assertFieldHasEqualityTrait(context, namespaceId, modelName, fieldName);
    exprs.push(BinaryExpr.eq(left, LiteralExpr.of(value)));
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
  const traits = codecId ? (context.codecDescriptors.descriptorFor(codecId)?.traits ?? []) : [];
  if (!traits.includes('equality')) {
    throw ormError(
      'ORM.FILTER_UNSUPPORTED',
      `Shorthand filter on "${modelName}.${fieldName}": field does not support equality comparisons`,
      { meta: { model: modelName, field: fieldName, trait: 'equality' } },
    );
  }
}
