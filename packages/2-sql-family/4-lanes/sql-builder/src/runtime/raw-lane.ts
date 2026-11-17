import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createRawSql, type RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import type { TableProxyContract } from '../types/db';
import type { RawLane, RawTagFor } from '../types/raw-query';

export interface RawLaneOptions<C extends Contract<SqlStorage> & TableProxyContract> {
  readonly context: ExecutionContext<C>;
  readonly rawCodecInferer: RawCodecInferer;
}

/**
 * Builds the raw lane a client exposes as `db.raw`.
 *
 * The tag binds the adapter's codec inferer and the contract here, once. An
 * authoring site then carries only its template, its row spec, and a
 * terminator.
 *
 * The row type is phantom: no value holds it. The target-agnostic tag types it
 * as `unknown`, and the contract says what each declared column decodes to.
 */
export function createRawLane<C extends Contract<SqlStorage> & TableProxyContract>(
  options: RawLaneOptions<C>,
): RawLane<C> {
  const tag = blindCast<
    RawTagFor<C>,
    'the row type is phantom, so no value can prove it. The builder is the same one either way. Only the contract says what the declared columns decode to'
  >(createRawSql(options.rawCodecInferer, { contract: options.context.contract }));

  return Object.freeze({ sql: tag });
}
