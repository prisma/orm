import type { RuntimeExecuteOptions } from '@internal/framework-components/runtime';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { invariant } from '@internal/utils/assertions';
import type { PreparedExecution } from './types';

export const preparedStatementExecute = Symbol('preparedStatementExecute');

export interface PreparedStatementExecuteTarget extends RuntimeScope {
  [preparedStatementExecute]<Params>(
    statement: PreparedExecution<Params>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats>;
}

function isPreparedStatementExecuteTarget(
  target: RuntimeScope,
): target is PreparedStatementExecuteTarget {
  return preparedStatementExecute in target;
}

export function runPreparedExecute<Params>(
  target: RuntimeScope,
  statement: PreparedExecution<Params>,
  params: Params,
  options?: RuntimeExecuteOptions,
): Promise<SqlStatementStats> {
  invariant(
    isPreparedStatementExecuteTarget(target),
    'RuntimeQueryable is missing the prepared statement execute bridge',
  );
  return target[preparedStatementExecute](statement, params, options);
}
