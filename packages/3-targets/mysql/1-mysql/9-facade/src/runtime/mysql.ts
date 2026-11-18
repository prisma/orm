import mysqlAdapter from '@internal/adapter-mysql/runtime';
import type { Contract } from '@internal/contract/types';
import type {
  MysqlBinding,
  MysqlDriverCreateOptions,
  MysqlPoolOptions,
  MysqlRuntimeDriver,
} from '@internal/driver-mysql/runtime';
import mysqlDriver from '@internal/driver-mysql/runtime';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createRawLane, sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import {
  type CollectionClasses,
  type NoCollectionClasses,
  type OrmClientRootMembers,
  orm as ormBuilder,
  type PreparedFrom,
  type PrepareMember,
  prepareQuery,
} from '@internal/sql-orm-client';
import type { CodecTypesBase, RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  Runtime,
  SqlExecutionOptions,
  SqlExecutionStackWithDriver,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  ToSqlMember,
  TransactionContext,
} from '@internal/sql-runtime';
import {
  activitySource,
  createExecutionContext,
  createSqlExecutionStack,
  delegatingActivitySource,
  delegatingRuntime,
  toRuntimeOptions,
  withTransaction,
  withTransactionMembers,
} from '@internal/sql-runtime';
import mysqlTarget, { type MysqlRuntimeTargetDescriptor } from '@internal/target-mysql/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { mysqlClientError } from '../errors';
import { createMysqlContractValidation } from '../static/contract-from-json';
import { buildMysqlStaticContext, type MysqlStaticContext } from '../static/mysql-static';
import { resolveMysqlBinding, resolveOptionalMysqlBinding } from './binding';
import {
  type MysqlTransactionOptions,
  validateStreamOption,
  validateTransactionOptions,
} from './mysql-options';
import { MysqlRuntimeImpl } from './mysql-runtime';

export type MysqlTargetId = 'mysql';
type OrmClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
> = ReturnType<typeof ormBuilder<TContract, TCollections>>;

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundOrm<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
> = OrmClient<TContract, TCollections>[typeof UNBOUND_NAMESPACE_ID];

/** The models of MySQL's single namespace, and `fragment` unless a model is named `fragment`. */
export type MysqlOrm<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = 'fragment' extends keyof UnboundOrm<TContract, TCollections>
  ? UnboundOrm<TContract, TCollections>
  : UnboundOrm<TContract, TCollections> & OrmClientRootMembers<TContract>;

function mysqlOrm<TContract extends Contract<SqlStorage>, TCollections extends CollectionClasses>(
  orm: OrmClient<TContract, TCollections>,
): MysqlOrm<TContract, TCollections> {
  const namespace = orm[UNBOUND_NAMESPACE_ID];
  assertDefined(namespace, 'the unbound namespace always exists on a mysql builder output');
  const withFragment: object =
    Reflect.get(namespace, 'fragment') === undefined
      ? Object.create(namespace, { fragment: { value: Reflect.get(orm, 'fragment') } })
      : namespace;
  return blindCast<
    MysqlOrm<TContract, TCollections>,
    'OrmClient<TContract> indexed by a literal key widens NsId to string; Collection is invariant in NsId via row/mutation-input types, so the indexed-access type cannot be proven to match the literal-keyed OrmNamespace without this cast'
  >(withFragment);
}

/** The query members of a MySQL client, which its transactions offer with the same types. */
export interface MysqlQueryMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PrepareMember<TContract>,
    RuntimeScope,
    ToSqlMember {
  readonly sql: UnboundSql<TContract>;
  readonly orm: MysqlOrm<TContract, TCollections>;
  readonly raw: RawLane<TContract>;
}

export interface MysqlTransactionContext<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends TransactionContext,
    MysqlQueryMembers<TContract, TCollections> {
  readonly enums: MysqlStaticContext<TContract>['enums'];
}

export interface MysqlStaticMembers<
  TContract extends Contract<SqlStorage>,
  TargetId extends string = MysqlTargetId,
> extends MysqlStaticContext<TContract> {
  readonly stack: SqlExecutionStackWithDriver<TargetId>;
}

export interface MysqlClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
  TargetId extends string = MysqlTargetId,
> extends MysqlQueryMembers<TContract, TCollections>,
    MysqlStaticMembers<TContract, TargetId> {
  connect(bindingInput?: { readonly url: string }): Promise<Runtime>;
  runtime(): Runtime;
  transaction<R>(
    fn: (tx: MysqlTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    options?: MysqlTransactionOptions,
  ): Promise<R>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

interface MysqlTransactionMembersOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
> {
  readonly context: ExecutionContext<TContract>;
  readonly collections: TCollections | undefined;
  readonly rawCodecInferer: RawCodecInferer;
  readonly enums: MysqlStaticContext<TContract>['enums'];
  readonly toSql: ToSqlMember['toSql'];
  readonly prepareRuntime: Pick<Runtime, 'prepare'>;
}

/**
 * Builds the members of a MySQL transaction over `txCtx`, so every statement they run goes through the transaction. Preparing sends nothing to the database, so `prepare` uses `prepareRuntime`; the prepared statement runs on the queryable it is given.
 */
function buildMysqlTransactionMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
>(
  options: MysqlTransactionMembersOptions<TContract, TCollections>,
  txCtx: TransactionContext,
): Omit<MysqlTransactionContext<TContract, TCollections>, keyof TransactionContext> {
  const { context, collections, rawCodecInferer, enums, toSql, prepareRuntime } = options;
  const sqlNamespace = sqlBuilder<TContract>({ context, rawCodecInferer })[UNBOUND_NAMESPACE_ID];
  assertDefined(sqlNamespace, 'the unbound namespace always exists on a mysql builder output');
  return {
    sql: blindCast<
      UnboundSql<TContract>,
      'Db<TContract> indexed by a literal key widens NsId to string; TableProxy is invariant in NsId via insert()/update() parameter positions, so the indexed-access type cannot be proven to match the literal-keyed Namespace without this cast'
    >(sqlNamespace),
    orm: mysqlOrm(
      ormBuilder<TContract, TCollections>({
        runtime: {
          query(plan) {
            return txCtx.query(plan);
          },
          execute(plan) {
            return txCtx.execute(plan);
          },
          [activitySource]: delegatingActivitySource(() => txCtx),
        },
        context,
        ...ifDefined('collections', collections),
      }),
    ),
    raw: createRawLane<TContract>({ context, rawCodecInferer }),
    enums,
    toSql,
    prepare(declaration, callback) {
      return prepareQuery(prepareRuntime, declaration, callback);
    },
  };
}

export interface MysqlOptionsBase<TargetId extends string = MysqlTargetId>
  extends SqlExecutionOptions<TargetId> {
  /**
   * Stream each query's rows as they arrive. Unset reads the whole result before the first row, as the Postgres facade does without `cursor`. It is a boolean, not Postgres's `cursor: { batchSize }`, because MySQL has no server-side cursor for a query: the server sends the whole result and the driver reads it from the socket as the caller asks for rows. A value that is not a boolean fails the factory call. While a stream on a connection is open, a statement sent on the same connection waits for it, so one awaited inside the loop over a stream in a transaction never finishes.
   */
  readonly stream?: boolean;
  readonly poolOptions?: MysqlPoolOptions;
  readonly transactionOptions?: MysqlTransactionOptions | undefined;
}

export type MysqlOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
  TargetId extends string = MysqlTargetId,
> = MysqlOptionsBase<TargetId> & {
  readonly contract: TContract;
  readonly collections?: TCollections;
  readonly url?: string;
};

/** The URL schemes `mysql()` accepts, which a target that extends MySQL accepts too. */
export const mysqlUrlSchemes: readonly string[] = ['mysql'];

/** The components a client of MySQL, or of a target that extends it, is built from, and the URL schemes it accepts. The client names the database by the target's display name. */
export interface MysqlClientComponents<
  TargetId extends string,
  TAdapterInstance extends
    SqlRuntimeAdapterInstance<TargetId> = SqlRuntimeAdapterInstance<TargetId>,
> {
  readonly target: MysqlRuntimeTargetDescriptor<TargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TargetId, TAdapterInstance>;
  readonly driver: RuntimeDriverDescriptor<
    'sql',
    TargetId,
    MysqlDriverCreateOptions,
    MysqlRuntimeDriver<TargetId>
  >;
  /** The URL schemes the client accepts, without the colon, as in `mysql`. */
  readonly urlSchemes: readonly string[];
}

/** A client function of `TargetId`: `mysql`, or the function of a target that extends MySQL. */
export type MysqlClientFactory<TargetId extends string> = <
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
>(
  options: MysqlOptions<TContract, TCollections, TargetId>,
) => MysqlClient<TContract, TCollections, TargetId>;

/**
 * Builds the client function of MySQL, or of a target that extends it, from its components. `mysql()` is this applied to MySQL's.
 */
export function createMysqlClient<
  TargetId extends string,
  TAdapterInstance extends SqlRuntimeAdapterInstance<TargetId>,
>(components: MysqlClientComponents<TargetId, TAdapterInstance>): MysqlClientFactory<TargetId> {
  const { target, urlSchemes } = components;
  const { validateContract } = createMysqlContractValidation(target.targetId);
  return function createClient<
    TContract extends Contract<SqlStorage>,
    TCollections extends CollectionClasses = NoCollectionClasses,
  >(
    options: MysqlOptions<TContract, TCollections, TargetId>,
  ): MysqlClient<TContract, TCollections, TargetId> {
    const stream = validateStreamOption(options.stream, target.targetId);
    const transactionOptions = validateTransactionOptions(
      options.transactionOptions,
      target.targetId,
    );
    const contract = validateContract(options.contract);
    let binding = resolveOptionalMysqlBinding(options, target, urlSchemes);

    const stack = createSqlExecutionStack({
      target: components.target,
      adapter: components.adapter,
      driver: components.driver,
      extensions: options.extensions ?? [],
    });

    const context = createExecutionContext<TContract, TargetId>({
      contract,
      stack,
      driver: components.driver,
    });
    const {
      sql,
      raw: rawSqlTag,
      enums,
      toSql,
    }: MysqlStaticContext<TContract> = buildMysqlStaticContext<TContract, TargetId>(
      contract,
      context,
      stack,
    );

    let runtimeInstance: Runtime | undefined;
    let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
    let driverConnected = false;
    let connectPromise: Promise<void> | undefined;
    let closePromise: Promise<void> | undefined;
    let backgroundConnectError: unknown;
    let closed = false;
    let ownedDispose: (() => Promise<void>) | undefined;

    const closedError = () =>
      mysqlClientError('DRIVER.NOT_CONNECTED', `${target.displayName} client is closed`, {
        meta: { extension: target.targetId },
      });

    const connectDriver = async (resolvedBinding: MysqlBinding): Promise<void> => {
      if (driverConnected) return;
      if (!runtimeDriver) throw new InternalError(`${target.displayName} runtime driver missing`);
      if (connectPromise) return connectPromise;
      connectPromise = runtimeDriver
        .connect(resolvedBinding)
        .then(() => {
          driverConnected = true;
        })
        .catch((err) => {
          backgroundConnectError = err;
          connectPromise = undefined;
          throw err;
        });
      return connectPromise;
    };

    const getRuntime = (): Runtime => {
      if (closed) {
        throw closedError();
      }

      if (backgroundConnectError !== undefined) {
        throw backgroundConnectError;
      }

      if (runtimeInstance) {
        return runtimeInstance;
      }

      const adapter = stack.adapter.create(stack);
      const driverDescriptor = stack.driver;

      const driver = driverDescriptor.create({
        stream,
        ...ifDefined('poolOptions', options.poolOptions),
      });
      ownedDispose = () => driver.close();
      runtimeDriver = driver;
      if (binding !== undefined) {
        void connectDriver(binding).catch(() => undefined);
      }

      runtimeInstance = new MysqlRuntimeImpl({
        context,
        adapter,
        driver,
        ...toRuntimeOptions(options),
        closeRefusal: 'at-once',
      });

      return runtimeInstance;
    };

    const workRuntime = delegatingRuntime(getRuntime);

    const orm: MysqlOrm<TContract, TCollections> = mysqlOrm(
      ormBuilder<TContract, TCollections>({
        context,
        ...ifDefined('collections', options.collections),
        runtime: workRuntime,
        implicitTransactionOptions: { isolationLevel: 'ReadCommitted' },
      }),
    );

    function prepare<
      D extends Declaration<CT>,
      Q extends SqlQueryPlan | Preparable<unknown, unknown>,
      CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
    >(
      declaration: D,
      callback: (params: BindSiteParams<D>) => Q,
    ): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>> {
      return prepareQuery<D, Q, CT>(workRuntime, declaration, callback);
    }

    return {
      sql,
      orm,
      enums,
      raw: rawSqlTag,
      toSql,
      context,
      contract,
      stack,
      query(plan, execOptions) {
        return workRuntime.query(plan, execOptions);
      },
      execute(plan, execOptions) {
        return workRuntime.execute(plan, execOptions);
      },
      async connect(bindingInput) {
        if (closed) {
          throw closedError();
        }

        if (driverConnected || connectPromise) {
          if (bindingInput !== undefined) {
            throw mysqlClientError(
              'DRIVER.ALREADY_CONNECTED',
              `${target.displayName} client is already bound`,
              {
                why: 'connect() was given options after the client was bound to a database.',
                fix: 'Call connect() without options, or create a new client for another database.',
                meta: { extension: target.targetId },
              },
            );
          }
          const runtime = getRuntime();
          await connectPromise;
          if (closed) throw closedError();
          return runtime;
        }

        backgroundConnectError = undefined;

        if (bindingInput !== undefined) {
          binding = resolveMysqlBinding(bindingInput, target, urlSchemes);
        }

        if (binding === undefined) {
          throw mysqlClientError(
            'RUNTIME.BINDING_MISSING',
            `${target.displayName} binding not configured. Pass url to ${target.targetId}(...) or call db.connect({ url }).`,
            { meta: { extension: target.targetId } },
          );
        }

        const runtime = getRuntime();
        if (driverConnected) {
          return runtime;
        }

        await connectDriver(binding);
        if (closed) throw closedError();
        return runtime;
      },
      runtime() {
        return getRuntime();
      },
      prepare,

      async transaction<R>(
        fn: (tx: MysqlTransactionContext<TContract, TCollections>) => PromiseLike<R>,
        localOptions?: MysqlTransactionOptions,
      ): Promise<R> {
        const local = validateTransactionOptions(localOptions, target.targetId);
        const isolationLevel =
          local?.isolationLevel !== undefined
            ? local.isolationLevel
            : transactionOptions?.isolationLevel;
        const timeout = local?.timeout !== undefined ? local.timeout : transactionOptions?.timeout;
        return withTransaction(
          workRuntime,
          (txCtx) => {
            const tx: MysqlTransactionContext<TContract, TCollections> = withTransactionMembers(
              txCtx,
              buildMysqlTransactionMembers<TContract, TCollections>(
                {
                  context,
                  collections: options.collections,
                  rawCodecInferer: stack.adapter.rawCodecInferer,
                  enums,
                  toSql,
                  prepareRuntime: workRuntime,
                },
                txCtx,
              ),
            );

            return fn(tx);
          },
          { isolationLevel, timeout },
        );
      },

      close(): Promise<void> {
        if (closePromise) return closePromise;
        closed = true;
        closePromise = (async () => {
          await connectPromise?.catch(() => undefined);
          await ownedDispose?.();
        })();
        return closePromise;
      },

      [Symbol.asyncDispose](): Promise<void> {
        return this.close();
      },
    };
  };
}

/**
 * Creates a lazy MySQL client. The client infers its contract type from `contract`: a value from
 * `contractFromJson` for an emitted contract, or a TypeScript-authored contract. A contract is
 * validated once, however many clients are built from it. The database opens on the first query
 * or `connect()`.
 *
 * @example
 * ```ts
 * import { contractFromJson } from '@prisma/orm-mysql/static';
 * import mysql from '@prisma/orm-mysql/runtime';
 * import type { Contract } from './contract.d';
 * import contractJson from './contract.json' with { type: 'json' };
 *
 * export const contract = contractFromJson<Contract>(contractJson);
 * export const db = mysql({ contract, url: process.env.DATABASE_URL });
 * ```
 */
const mysql: MysqlClientFactory<MysqlTargetId> = createMysqlClient({
  target: mysqlTarget,
  adapter: mysqlAdapter,
  driver: mysqlDriver,
  urlSchemes: mysqlUrlSchemes,
});

export default mysql;
