import type {
  AsyncIterableResult,
  ResultType,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import type { CodecTypesBase } from '@internal/sql-relational-core/expression';
import type { Preparable } from '@internal/sql-relational-core/plan';
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
import type { RowQuery } from './collection-dispatch';

export interface PreparedRowQuery<Params, Result> {
  query(target: RuntimeQueryable, params: Params, options?: RuntimeExecuteOptions): Result;
}

export type PreparedFrom<Params, Q extends Preparable> = Q extends {
  consume(rows: AsyncIterableResult<never>): infer Result;
}
  ? PreparedRowQuery<Params, Result>
  : PreparedFor<Params, ResultType<Q>>;

export async function prepareQuery<
  D extends Declaration<CT>,
  Q extends Preparable,
  CT extends CodecTypesBase,
>(
  runtime: Runtime,
  declaration: D,
  callback: (params: BindSiteParams<D>) => Q,
): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>> {
  let consume: Preparable['consume'];
  const statement = await runtime.prepare<D, ResultType<Q>, CT>(declaration, (params) => {
    const authored = callback(params);
    consume = authored.consume;
    return { ast: authored.ast, params: authored.params, meta: authored.meta };
  });
  const prepared = consume
    ? createPreparedRowQuery(
        { consume },
        blindCast<
          PreparedStatement<ParamsFromDeclaration<D, CT>, ResultType<Q>>,
          'custom consumers describe row-returning SQL plans'
        >(statement),
      )
    : statement;
  return blindCast<
    PreparedFrom<ParamsFromDeclaration<D, CT>, Q>,
    'required consumer selects custom consumption; otherwise the SQL runtime preserves the declared result kind'
  >(prepared);
}

export function createPreparedRowQuery<Params, DbRow, Result>(
  description: Pick<RowQuery<DbRow, Result>, 'consume'>,
  statement: PreparedStatement<Params, DbRow>,
): PreparedRowQuery<Params, Result> {
  return Object.freeze({
    query(target: RuntimeQueryable, params: Params, options?: RuntimeExecuteOptions): Result {
      return description.consume(statement.query(target, params, options));
    },
  });
}
