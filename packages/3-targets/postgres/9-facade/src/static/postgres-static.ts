import postgresAdapter from '@internal/adapter-postgres/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import { createRawLane, sql } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  ExecutionContext,
  SqlExecutionStack,
  SqlRuntimeExtensionDescriptor,
  ToSqlMember,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  createToSql,
} from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { buildNamespacedNativeEnums, type NamespacedNativeEnums } from '../runtime/native-enums';
import type { PostgresTargetId } from '../runtime/postgres-target-id';
import { validatePostgresContract } from './contract-from-json';

export interface PostgresStaticContext<TContract extends Contract<SqlStorage>> extends ToSqlMember {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  readonly sql: Db<TContract>;
  readonly raw: RawLane<TContract>;
}

export function buildPostgresStaticContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  context: ExecutionContext<TContract>,
  stack: SqlExecutionStack<PostgresTargetId>,
): PostgresStaticContext<TContract> {
  const { rawCodecInferer } = stack.adapter;
  const sqlDb: Db<TContract> = sql<TContract>({ context, rawCodecInferer });
  const raw: RawLane<TContract> = createRawLane<TContract>({ context, rawCodecInferer });
  const enums = Object.freeze(
    buildNamespacedEnums<TContract>(context.contract.domain, (codecId) =>
      context.contractCodecs.forCodecRef({ codecId }),
    ),
  );
  const nativeEnums = blindCast<
    NamespacedNativeEnums<TContract>,
    'buildNamespacedNativeEnums returns the namespace-keyed accessor map this contract types'
  >(Object.freeze(buildNamespacedNativeEnums(context.contract.storage, context.contract.domain)));
  return {
    context,
    contract,
    enums,
    nativeEnums,
    sql: sqlDb,
    raw,
    toSql: createToSql(stack, contract),
  };
}

/**
 * The query surfaces of a Postgres client without a driver: `sql`, `raw`, `enums`, `nativeEnums`
 * and `toSql`. Use it where loading `pg` is not wanted, for example in browser code that reads
 * enums.
 *
 * @example
 * ```ts
 * const { enums } = postgresStatic({ contract: contractFromJson<Contract>(contractJson) });
 * ```
 */
export default function postgresStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contract: TContract;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
}): PostgresStaticContext<TContract> {
  const contract = validatePostgresContract(options.contract);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: options.extensions ?? [],
  });
  const context = createExecutionContext({ contract, stack });
  return buildPostgresStaticContext(contract, context, stack);
}
