import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { invariant } from '@internal/utils/assertions';
import type { PreparedStatement } from './types';

export const preparedStatementQuery = Symbol('preparedStatementQuery');

export interface PreparedStatementQueryTarget extends RuntimeScope {
  [preparedStatementQuery]<Params, Row>(
    statement: PreparedStatement<Params, Row>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
}

function isPreparedStatementQueryTarget(
  target: RuntimeScope,
): target is PreparedStatementQueryTarget {
  return preparedStatementQuery in target;
}

export function runPreparedQuery<Params, Row>(
  target: RuntimeScope,
  statement: PreparedStatement<Params, Row>,
  params: Params,
  options?: RuntimeExecuteOptions,
): AsyncIterableResult<Row> {
  invariant(
    isPreparedStatementQueryTarget(target),
    'RuntimeQueryable is missing the prepared statement query bridge',
  );
  return target[preparedStatementQuery](statement, params, options);
}
