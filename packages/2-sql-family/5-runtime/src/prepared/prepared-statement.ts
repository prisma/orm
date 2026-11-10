import type { PlanMeta } from '@internal/contract/types';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import type {
  AnyQueryAst,
  LoweredParam,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import type { DecodeContext } from '../codecs/decoding';
import type { ParamMetadata } from '../codecs/encoding';
import { runPreparedExecute } from './prepared-execute';
import { runPreparedQuery } from './prepared-query';
import type { ParamsFromDeclaration, PreparedExecution, PreparedStatement } from './types';

export interface PreparedStatementInternals {
  readonly sql: string;
  readonly ast: AnyQueryAst;
  readonly meta: PlanMeta;
  readonly slots: readonly LoweredParam[];
  readonly decodeContext: DecodeContext;
  readonly paramMetadata: readonly ParamMetadata[];
}

export class PreparedStatementImpl<Params, Row>
  implements PreparedStatement<Params, Row>, PreparedStatementInternals
{
  readonly sql: string;
  readonly ast: AnyQueryAst;
  readonly meta: PlanMeta;
  readonly slots: readonly LoweredParam[];
  readonly decodeContext: DecodeContext;
  readonly paramMetadata: readonly ParamMetadata[];

  constructor(internals: PreparedStatementInternals) {
    this.sql = internals.sql;
    this.ast = internals.ast;
    this.meta = internals.meta;
    this.slots = internals.slots;
    this.decodeContext = internals.decodeContext;
    this.paramMetadata = internals.paramMetadata;
    Object.freeze(this);
  }

  query(
    target: RuntimeScope,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return runPreparedQuery(target, this, params, options);
  }
}

/**
 * The statistics-reporting sibling of {@link PreparedStatementImpl}. A plan
 * declaring an affected-row count prepares into one of these, which carries
 * the same lowered statement and bind slots and is consumed by executing it.
 *
 * The two classes are separate so the consumption a plan did not declare is
 * absent from the value, not merely from its type.
 */
export class PreparedExecutionImpl<Params>
  implements PreparedExecution<Params>, PreparedStatementInternals
{
  readonly sql: string;
  readonly ast: AnyQueryAst;
  readonly meta: PlanMeta;
  readonly slots: readonly LoweredParam[];
  readonly decodeContext: DecodeContext;
  readonly paramMetadata: readonly ParamMetadata[];

  constructor(internals: PreparedStatementInternals) {
    this.sql = internals.sql;
    this.ast = internals.ast;
    this.meta = internals.meta;
    this.slots = internals.slots;
    this.decodeContext = internals.decodeContext;
    this.paramMetadata = internals.paramMetadata;
    Object.freeze(this);
  }

  execute(
    target: RuntimeScope,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    return runPreparedExecute(target, this, params, options);
  }
}

export type { ParamsFromDeclaration };
