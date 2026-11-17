import mysqlAdapter from '@internal/adapter-mysql/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createRawLane, sql } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  ExecutionContext,
  SqlExecutionStack,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeExtensionDescriptor,
  ToSqlMember,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  createToSql,
} from '@internal/sql-runtime';
import mysqlTarget, { type MysqlRuntimeTargetDescriptor } from '@internal/target-mysql/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { mysqlContractValidation } from './contract-from-json';

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundEnums<TContract extends Contract<SqlStorage>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

export interface MysqlStaticContext<TContract extends Contract<SqlStorage>> extends ToSqlMember {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly sql: UnboundSql<TContract>;
  readonly raw: RawLane<TContract>;
}

export function buildMysqlStaticContext<
  TContract extends Contract<SqlStorage>,
  TargetId extends string,
>(
  contract: TContract,
  context: ExecutionContext<TContract>,
  stack: SqlExecutionStack<TargetId>,
): MysqlStaticContext<TContract> {
  const { rawCodecInferer } = stack.adapter;
  const sqlNamespace = sql<TContract>({ context, rawCodecInferer })[UNBOUND_NAMESPACE_ID];
  assertDefined(sqlNamespace, 'the unbound namespace always exists on a mysql builder output');
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
  assertDefined(enums, 'the unbound namespace always exists on a mysql builder output');
  return { context, contract, enums, sql: sqlDb, raw, toSql: createToSql(stack, contract) };
}

/** The components the static context of MySQL, or of a database that extends it, is built from. */
export interface MysqlStaticComponents<
  TargetId extends string,
  TAdapterInstance extends
    SqlRuntimeAdapterInstance<TargetId> = SqlRuntimeAdapterInstance<TargetId>,
> {
  readonly target: MysqlRuntimeTargetDescriptor<TargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TargetId, TAdapterInstance>;
}

/** Builds the static-context function of MySQL, or of a database that extends it. `mysqlStatic()` is this applied to MySQL's components. */
export function createMysqlStatic<
  TargetId extends string,
  TAdapterInstance extends SqlRuntimeAdapterInstance<TargetId>,
>(components: MysqlStaticComponents<TargetId, TAdapterInstance>) {
  const { validateContract } = mysqlContractValidation(components.target.targetId);
  return function staticContext<TContract extends Contract<SqlStorage>>(options: {
    readonly contract: TContract;
    readonly extensions?: readonly SqlRuntimeExtensionDescriptor<TargetId>[];
  }): MysqlStaticContext<TContract> {
    const contract = validateContract(options.contract);
    const stack = createSqlExecutionStack({
      target: components.target,
      adapter: components.adapter,
      extensions: options.extensions ?? [],
    });
    const context = createExecutionContext({ contract, stack });
    return buildMysqlStaticContext(contract, context, stack);
  };
}

/**
 * The query surfaces of a MySQL client without a driver: `sql`, `raw`, `enums` and `toSql`. Use
 * it where loading the MySQL driver is not wanted.
 *
 * @example
 * ```ts
 * const { enums } = mysqlStatic({ contract: contractFromJson<Contract>(contractJson) });
 * ```
 */
const mysqlStatic = createMysqlStatic({ target: mysqlTarget, adapter: mysqlAdapter });

export default mysqlStatic;
