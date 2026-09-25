import { type AnyExpression, isOrderByNulls, OrderByItem } from '@internal/sql-relational-core/ast';
import { ormError } from './orm-errors';

export function assertCursorKeyable(orderBy: readonly OrderByItem[] | undefined): void {
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

export function assertDistinctOnOrderable(orderBy: readonly OrderByItem[] | undefined): void {
  (orderBy ?? []).forEach((item, index) => {
    const position = index + 1;
    if (item.expr.kind !== 'column-ref') {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `distinctOn() cannot be combined with orderBy item ${position}: it orders by an expression rather than a column, and relation orders, relation counts and operation results are not distinct-on-able. Order by the model's own columns when using distinctOn().`,
        { meta: { method: 'distinctOn', position } },
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
