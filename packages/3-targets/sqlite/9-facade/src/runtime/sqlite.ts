import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import type { Contract } from '@internal/contract/types';
import type { SqliteBinding } from '@internal/driver-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
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
  Log,
  ParamsFromDeclaration,
  Runtime,
  RuntimeMode,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  ToSqlMember,
  TransactionContext,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import {
  activitySource,
  createExecutionContext,
  createSqlExecutionStack,
  delegatingActivitySource,
  delegatingRuntime,
  withTransaction,
  withTransactionMembers,
} from '@internal/sql-runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { sqliteError } from '../errors';
import { validateSqliteContract } from '../static/contract-from-json';
import { buildSqliteStaticContext, type SqliteStaticContext } from '../static/sqlite-static';
import { resolveOptionalSqliteBinding, resolveSqliteBinding } from './binding';
import { SqliteRuntimeImpl } from './sqlite-runtime';

export type SqliteTargetId = 'sqlite';
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

/** The models of SQLite's single namespace, and `fragment` unless a model is named `fragment`. */
export type SqliteOrm<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = 'fragment' extends keyof UnboundOrm<TContract, TCollections>
  ? UnboundOrm<TContract, TCollections>
  : UnboundOrm<TContract, TCollections> & OrmClientRootMembers<TContract>;

function sqliteOrm<TContract extends Contract<SqlStorage>, TCollections extends CollectionClasses>(
  orm: OrmClient<TContract, TCollections>,
): SqliteOrm<TContract, TCollections> {
  const namespace = orm[UNBOUND_NAMESPACE_ID];
  assertDefined(namespace, 'the unbound namespace always exists on a sqlite builder output');
  const withFragment: object =
    Reflect.get(namespace, 'fragment') === undefined
      ? Object.create(namespace, { fragment: { value: Reflect.get(orm, 'fragment') } })
      : namespace;
  return blindCast<
    SqliteOrm<TContract, TCollections>,
    'OrmClient<TContract> indexed by a literal key widens NsId to string; Collection is invariant in NsId via row/mutation-input types, so the indexed-access type cannot be proven to match the literal-keyed OrmNamespace without this cast'
  >(withFragment);
}

/** The query members of a SQLite client, which its transactions offer with the same types. */
export interface SqliteQueryMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PrepareMember<TContract>,
    RuntimeScope,
    ToSqlMember {
  readonly sql: UnboundSql<TContract>;
  readonly orm: SqliteOrm<TContract, TCollections>;
  readonly raw: RawLane<TContract>;
}

export interface SqliteTransactionContext<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends TransactionContext,
    SqliteQueryMembers<TContract, TCollections> {
  readonly enums: SqliteStaticContext<TContract>['enums'];
}

export interface SqliteStaticMembers<TContract extends Contract<SqlStorage>>
  extends SqliteStaticContext<TContract> {
  readonly stack: SqlExecutionStackWithDriver<SqliteTargetId>;
}

export interface SqliteClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends SqliteQueryMembers<TContract, TCollections>,
    SqliteStaticMembers<TContract> {
  connect(bindingInput?: { readonly path: string }): Promise<Runtime>;
  runtime(): Runtime;
  transaction<R>(
    fn: (tx: SqliteTransactionContext<TContract, TCollections>) => PromiseLike<R>,
  ): Promise<R>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

interface SqliteTransactionMembersOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
> {
  readonly context: ExecutionContext<TContract>;
  readonly collections: TCollections | undefined;
  readonly rawCodecInferer: RawCodecInferer;
  readonly enums: SqliteStaticContext<TContract>['enums'];
  readonly toSql: ToSqlMember['toSql'];
  readonly prepareRuntime: Pick<Runtime, 'prepare'>;
}

/**
 * Builds the members of a SQLite transaction over `txCtx`, so every statement they run goes through the transaction. Preparing sends nothing to the database, so `prepare` uses `prepareRuntime`; the prepared statement runs on the queryable it is given.
 */
function buildSqliteTransactionMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
>(
  options: SqliteTransactionMembersOptions<TContract, TCollections>,
  txCtx: TransactionContext,
): Omit<SqliteTransactionContext<TContract, TCollections>, keyof TransactionContext> {
  const { context, collections, rawCodecInferer, enums, toSql, prepareRuntime } = options;
  const sqlNamespace = sqlBuilder<TContract>({ context, rawCodecInferer })[UNBOUND_NAMESPACE_ID];
  assertDefined(sqlNamespace, 'the unbound namespace always exists on a sqlite builder output');
  return {
    sql: blindCast<
      UnboundSql<TContract>,
      'Db<TContract> indexed by a literal key widens NsId to string; TableProxy is invariant in NsId via insert()/update() parameter positions, so the indexed-access type cannot be proven to match the literal-keyed Namespace without this cast'
    >(sqlNamespace),
    orm: sqliteOrm(
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

export interface SqliteOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SqliteTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly log?: Log;
  readonly mode?: RuntimeMode;
}

export type SqliteOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = SqliteOptionsBase & {
  readonly contract: TContract;
  readonly collections?: TCollections;
  readonly path?: string;
};

/**
 * Creates a lazy SQLite client. The client infers its contract type from `contract`: a value from
 * `contractFromJson` for an emitted contract, or a TypeScript-authored contract. A contract is
 * validated once, however many clients are built from it. The database opens on the first query
 * or `connect()`.
 *
 * @example
 * ```ts
 * import { contractFromJson } from '@prisma/orm-sqlite/static';
 * import sqlite from '@prisma/orm-sqlite/runtime';
 * import type { Contract } from './contract.d';
 * import contractJson from './contract.json' with { type: 'json' };
 *
 * export const contract = contractFromJson<Contract>(contractJson);
 * export const db = sqlite({ contract, path: './dev.db' });
 * ```
 */
export default function sqlite<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
>(options: SqliteOptions<TContract, TCollections>): SqliteClient<TContract, TCollections> {
  const contract = validateSqliteContract(options.contract);
  let binding = resolveOptionalSqliteBinding(options);

  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions: options.extensions ?? [],
  });

  const context = createExecutionContext<TContract, SqliteTargetId>({
    contract,
    stack,
    driver: sqliteDriver,
  });
  const {
    sql,
    raw: rawSqlTag,
    enums,
    toSql,
  }: SqliteStaticContext<TContract> = buildSqliteStaticContext<TContract>(contract, context, stack);

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const closedError = () =>
    sqliteError('DRIVER.NOT_CONNECTED', 'SQLite client is closed', {
      meta: { extension: 'sqlite' },
    });

  const connectDriver = async (resolvedBinding: SqliteBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new InternalError('SQLite runtime driver missing');
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

    const driver = driverDescriptor.create();
    ownedDispose = () => driver.close();
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = new SqliteRuntimeImpl({
      context,
      adapter,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...ifDefined('middleware', options.middleware),
      ...ifDefined('log', options.log),
      ...ifDefined('mode', options.mode),
      closeRefusal: 'at-once',
    });

    return runtimeInstance;
  };

  const workRuntime = delegatingRuntime(getRuntime);

  const orm: SqliteOrm<TContract, TCollections> = sqliteOrm(
    ormBuilder<TContract, TCollections>({
      context,
      ...ifDefined('collections', options.collections),
      runtime: workRuntime,
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
          throw sqliteError('DRIVER.ALREADY_CONNECTED', 'SQLite client is already bound', {
            why: 'connect() was given options after the client was bound to a database.',
            fix: 'Call connect() without options, or create a new client for another database.',
            meta: { extension: 'sqlite' },
          });
        }
        const runtime = getRuntime();
        await connectPromise;
        if (closed) throw closedError();
        return runtime;
      }

      backgroundConnectError = undefined;

      if (bindingInput !== undefined) {
        binding = resolveSqliteBinding(bindingInput);
      }

      if (binding === undefined) {
        throw sqliteError(
          'RUNTIME.BINDING_MISSING',
          'SQLite binding not configured. Pass path to sqlite(...) or call db.connect({ path }).',
          { meta: { extension: 'sqlite' } },
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

    transaction<R>(
      fn: (tx: SqliteTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    ): Promise<R> {
      return withTransaction(workRuntime, (txCtx) => {
        const tx: SqliteTransactionContext<TContract, TCollections> = withTransactionMembers(
          txCtx,
          buildSqliteTransactionMembers<TContract, TCollections>(
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
      });
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
}
