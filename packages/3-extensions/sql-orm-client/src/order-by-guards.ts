import { type AnyExpression, isOrderByNulls, OrderByItem } from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';

/**
 * A keyset needs a cursor value for every order axis, so each active order must be a plain column without null placement.
 */
export function assertCursorCompatibleOrder(orderBy: readonly OrderByItem[] | undefined): void {
  (orderBy ?? []).forEach((item, index) => {
    const position = index + 1;
    if (item.expr.kind !== 'column-ref') {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `cursor() cannot key on orderBy item ${position}: it orders by an expression rather than a column, and relation orders, relation counts and operation results are not cursorable. Order by the model's own columns to paginate with a cursor.`,
        { meta: { method: 'cursor', position } },
      );
    }
    if (item.nulls !== undefined) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `cursor() cannot key on orderBy item ${position}: an order with nulls placement is not cursorable. Remove the nulls option to paginate with a cursor.`,
        { meta: { method: 'cursor', position, nulls: item.nulls } },
      );
    }
  });
}

/**
 * Postgres requires the leading `ORDER BY` items to match the `DISTINCT ON` expressions, so the first `distinctOnCount` items must be plain columns; later items only choose which row represents each group and may be any expression.
 */
export function assertDistinctOnCompatibleOrder(
  orderBy: readonly OrderByItem[] | undefined,
  distinctOnCount: number,
): void {
  (orderBy ?? []).slice(0, distinctOnCount).forEach((item, index) => {
    const position = index + 1;
    if (item.expr.kind !== 'column-ref') {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `distinctOn() needs its ${distinctOnCount} column(s) as the first orderBy items, but orderBy item ${position} orders by an expression rather than a column. Put the distinctOn columns first; relation orders, relation counts and operation results may follow them.`,
        { meta: { method: 'distinctOn', position, distinctOnCount } },
      );
    }
  });
}

export function checkedOrderByItem(
  dir: OrderByItem['dir'],
  expr: AnyExpression,
  options: { readonly nulls?: unknown } | undefined,
): OrderByItem {
  const nulls = options?.nulls;
  if (nulls !== undefined && !isOrderByNulls(nulls)) {
    throw ormError('ORM.ARGUMENT_INVALID', `${dir}() nulls must be "first" or "last"`, {
      meta: { method: dir, nulls: String(nulls) },
    });
  }
  return new OrderByItem(expr, dir, nulls);
}
