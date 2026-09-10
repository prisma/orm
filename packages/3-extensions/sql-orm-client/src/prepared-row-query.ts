import type { RuntimeExecuteOptions } from '@internal/framework-components/runtime';
import type { PreparedStatement, RuntimeQueryable } from '@internal/sql-runtime';
import type { RowQuery } from './collection-dispatch';

export interface PreparedRowQuery<Params, Result> {
  query(target: RuntimeQueryable, params: Params, options?: RuntimeExecuteOptions): Result;
}

export function createPreparedRowQuery<Params, DbRow, Result>(
  description: RowQuery<DbRow, Result>,
  statement: PreparedStatement<Params, DbRow>,
): PreparedRowQuery<Params, Result> {
  return Object.freeze({
    query(target: RuntimeQueryable, params: Params, options?: RuntimeExecuteOptions): Result {
      return description.consume(statement.query(target, params, options));
    },
  });
}
