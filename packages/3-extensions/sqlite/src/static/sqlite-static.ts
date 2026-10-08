import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createRawLane, sql } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { ExecutionContext, SqlRuntimeExtensionDescriptor } from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import sqliteTarget, { SqliteContractSerializer } from '@internal/target-sqlite/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import type { SqliteTargetId } from '../runtime/sqlite';

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundEnums<TContract extends Contract<SqlStorage>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

export interface SqliteStaticContext<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly sql: UnboundSql<TContract>;
  readonly raw: RawLane<TContract>;
}

export function buildSqliteStaticContext<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer,
): SqliteStaticContext<TContract> {
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
  return { context, contract: context.contract, enums, sql: sqlDb, raw };
}

export default function sqliteStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contractJson: unknown;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SqliteTargetId>[];
}): SqliteStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'SqliteContractSerializer validates and returns a typed contract'
  >(new SqliteContractSerializer().deserializeContract(options.contractJson));
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    extensions: options.extensions ?? [],
  });
  const context = createExecutionContext({ contract, stack });
  return buildSqliteStaticContext(context, stack.adapter.rawCodecInferer);
}
