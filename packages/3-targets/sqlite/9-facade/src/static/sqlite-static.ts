import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
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
import sqliteTarget from '@internal/target-sqlite/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import type { SqliteTargetId } from '../runtime/sqlite';
import { validateSqliteContract } from './contract-from-json';

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundEnums<TContract extends Contract<SqlStorage>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

export interface SqliteStaticContext<TContract extends Contract<SqlStorage>> extends ToSqlMember {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly sql: UnboundSql<TContract>;
  readonly raw: RawLane<TContract>;
}

export function buildSqliteStaticContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  context: ExecutionContext<TContract>,
  stack: SqlExecutionStack<SqliteTargetId>,
): SqliteStaticContext<TContract> {
  const { rawCodecInferer } = stack.adapter;
  const sqlNamespace = sql<TContract>({ context, rawCodecInferer })[UNBOUND_NAMESPACE_ID];
  assertDefined(sqlNamespace, 'the unbound namespace always exists on a sqlite builder output');
  const sqlDb = blindCast<
    UnboundSql<TContract>,
    'Db<TContract> indexed by a literal key widens NsId to string; TableProxy is invariant in NsId via insert()/update() parameter positions, so the indexed-access type cannot be proven to match the literal-keyed Namespace without this cast'
  >(sqlNamespace);
  const raw: RawLane<TContract> = createRawLane<TContract>({ context, rawCodecInferer });
  const enums = Object.freeze(
    buildNamespacedEnums<TContract>(context.contract.domain, (codecId) =>
      context.contractCodecs.forCodecRef({ codecId }),
    ),
  )[UNBOUND_NAMESPACE_ID];
  assertDefined(enums, 'the unbound namespace always exists on a sqlite builder output');
  return { context, contract, enums, sql: sqlDb, raw, toSql: createToSql(stack, contract) };
}

/**
 * The query surfaces of a SQLite client without a driver: `sql`, `raw`, `enums` and `toSql`. Use
 * it where loading `node:sqlite` is not wanted.
 *
 * @example
 * ```ts
 * const { enums } = sqliteStatic({ contract: contractFromJson<Contract>(contractJson) });
 * ```
 */
export default function sqliteStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contract: TContract;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SqliteTargetId>[];
}): SqliteStaticContext<TContract> {
  const contract = validateSqliteContract(options.contract);
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    extensions: options.extensions ?? [],
  });
  const context = createExecutionContext({ contract, stack });
  return buildSqliteStaticContext(contract, context, stack);
}
