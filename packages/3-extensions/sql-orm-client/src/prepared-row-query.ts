import type { ResultType, RuntimeExecuteOptions } from '@internal/framework-components/runtime';
import type { CodecTypesBase } from '@internal/sql-relational-core/expression';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ParamsFromDeclaration,
  PreparedFor,
  PreparedStatement,
  Runtime,
  RuntimeQueryable,
} from '@internal/sql-runtime';
import { blindCast } from '@internal/utils/casts';

export interface PreparedRowQuery<Params, Result> {
  query(target: RuntimeQueryable, params: Params, options?: RuntimeExecuteOptions): Result;
}

export type PreparedFrom<Params, Q extends SqlQueryPlan | Preparable<unknown, unknown>> =
  Q extends Preparable<unknown, infer Result>
    ? PreparedRowQuery<Params, Result>
    : PreparedFor<Params, ResultType<Q>>;

export async function prepareQuery<
  D extends Declaration<CT>,
  Q extends SqlQueryPlan | Preparable<unknown, unknown>,
  CT extends CodecTypesBase,
>(
  runtime: Runtime,
  declaration: D,
  callback: (params: BindSiteParams<D>) => Q,
): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>> {
  let description: Preparable<unknown, unknown> | undefined;
  const statement = await runtime.prepare<D, unknown, CT>(declaration, (params) => {
    const authored = callback(params);
    if ('plan' in authored) {
      description = authored;
      return authored.plan;
    }
    return authored;
  });
  const prepared = description ? createPreparedRowQuery(description, statement) : statement;
  return blindCast<
    PreparedFrom<ParamsFromDeclaration<D, CT>, Q>,
    'compositional description selects custom consumption; plain SQL preserves the declared result kind'
  >(prepared);
}

export function createPreparedRowQuery<Params, DbRow, Result>(
  description: Preparable<DbRow, Result>,
  statement: PreparedStatement<Params, DbRow>,
): PreparedRowQuery<Params, Result> {
  return Object.freeze({
    query(target: RuntimeQueryable, params: Params, options?: RuntimeExecuteOptions): Result {
      return description.consume(statement.query(target, params, options));
    },
  });
}
