import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import type { Contract } from '@internal/contract/types';
import type { SqliteBinding } from '@internal/driver-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db } from '@internal/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import { orm as ormBuilder } from '@internal/sql-orm-client';
import type { CodecTypesBase, RawSqlTag } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  PreparedFor,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  withTransaction,
} from '@internal/sql-runtime';
import sqliteTarget, {
  SqliteContractSerializer as SqlContractSerializer,
} from '@internal/target-sqlite/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { sqliteError } from '../errors';
import { buildSqliteStaticContext, type SqliteStaticContext } from '../static/sqlite-static';
import { resolveOptionalSqliteBinding, resolveSqliteBinding } from './binding';
import { SqliteRuntimeImpl } from './sqlite-runtime';

export type SqliteTargetId = 'sqlite';
type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof ormBuilder<TContract>>;

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundOrm<TContract extends Contract<SqlStorage>> =
  OrmClient<TContract>[typeof UNBOUND_NAMESPACE_ID];

function unboundOrm<TContract extends Contract<SqlStorage>>(
  orm: OrmClient<TContract>,
): UnboundOrm<TContract> {
  const value = orm[UNBOUND_NAMESPACE_ID];
  assertDefined(value, 'the unbound namespace always exists on a sqlite builder output');
  return blindCast<
    UnboundOrm<TContract>,
    'OrmClient<TContract> indexed by a literal key widens NsId to string; Collection is invariant in NsId via row/mutation-input types, so the indexed-access type cannot be proven to match the literal-keyed OrmNamespace without this cast'
  >(value);
}

export interface SqliteTransactionContext<TContract extends Contract<SqlStorage>>
  extends TransactionContext {
  readonly sql: UnboundSql<TContract>;
  readonly orm: UnboundOrm<TContract>;
  readonly enums: SqliteStaticContext<TContract>['enums'];
}

export interface SqliteClient<TContract extends Contract<SqlStorage>> {
  readonly sql: UnboundSql<TContract>;
  readonly orm: UnboundOrm<TContract>;
  readonly enums: SqliteStaticContext<TContract>['enums'];
  readonly raw: RawSqlTag;
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly stack: SqlExecutionStackWithDriver<SqliteTargetId>;
  connect(bindingInput?: { readonly path: string }): Promise<Runtime>;
  runtime(): Runtime;
  prepare<D extends Declaration<CT>, Row, CT extends CodecTypesBase = ExtractCodecTypes<TContract>>(
    declaration: D,
    callback: (sql: UnboundSql<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
  ): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>>;
  transaction<R>(fn: (tx: SqliteTransactionContext<TContract>) => PromiseLike<R>): Promise<R>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface SqliteOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SqliteTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
}

export type SqliteOptionsWithContract<TContract extends Contract<SqlStorage>> = {
  readonly path?: string;
} & SqliteOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type SqliteOptionsWithContractJson<TContract extends Contract<SqlStorage>> = {
  readonly path?: string;
  readonly _contract?: TContract;
} & SqliteOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
  };

export type SqliteOptions<TContract extends Contract<SqlStorage>> =
  | SqliteOptionsWithContract<TContract>
  | SqliteOptionsWithContractJson<TContract>;

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: SqliteOptions<TContract>,
): TContract {
  const serializer = new SqlContractSerializer();
  if ('contractJson' in options && options.contractJson !== undefined) {
    return serializer.deserializeContract(options.contractJson) as TContract;
  }
  const contract = (options as SqliteOptionsWithContract<TContract>).contract;
  return serializer.deserializeContract(serializer.serializeContract(contract)) as TContract;
}

export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptionsWithContract<TContract>,
): SqliteClient<TContract>;
export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptionsWithContractJson<TContract>,
): SqliteClient<TContract>;
export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptions<TContract>,
): SqliteClient<TContract> {
  const contract = resolveContract(options);
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
  }: SqliteStaticContext<TContract> = buildSqliteStaticContext<TContract>(
    context,
    stack.adapter.rawCodecInferer,
  );

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  /**
   * SQLite allows only one writer at a time. If more concurrent transactions
   * than available event-loop threads are started, the synchronous busy-handler
   * inside the driver occupies all threads waiting for the write lock while the
   * lock holder's COMMIT task has no thread available to run — causing every
   * transaction to time out with SQLITE_BUSY.
   *
   * We prevent the starvation by serialising the BEGIN…COMMIT section so that
   * at most one transaction is in-flight at a time. The overhead is negligible
   * because SQLite itself is single-writer; the serialisation just moves the
   * queue from the driver's busy-handler into async/await.
   */
  let transactionQueueTail: Promise<unknown> = Promise.resolve();

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
      throw sqliteError('DRIVER.NOT_CONNECTED', 'SQLite client is closed', {
        meta: { extension: 'sqlite' },
      });
    }

    if (backgroundConnectError !== undefined) {
      throw backgroundConnectError;
    }

    if (runtimeInstance) {
      return runtimeInstance;
    }

    const stackInstance = instantiateExecutionStack(stack);
    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new InternalError('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create();
    ownedDispose = () => driver.close();
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = new SqliteRuntimeImpl({
      context,
      adapter: stackInstance.adapter,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...ifDefined('middleware', options.middleware),
    });

    return runtimeInstance;
  };

  const orm: UnboundOrm<TContract> = unboundOrm(
    ormBuilder({
      context,
      runtime: {
        query(plan) {
          return getRuntime().query(plan);
        },
        execute(plan) {
          return getRuntime().execute(plan);
        },
        connection() {
          return getRuntime().connection();
        },
      },
    }),
  );

  return {
    sql,
    orm,
    enums,
    raw: rawSqlTag,
    context,
    contract,
    stack,
    async connect(bindingInput) {
      if (closed) {
        throw sqliteError('DRIVER.NOT_CONNECTED', 'SQLite client is closed', {
          meta: { extension: 'sqlite' },
        });
      }

      if (driverConnected || connectPromise) {
        throw sqliteError('DRIVER.ALREADY_CONNECTED', 'SQLite client already connected', {
          meta: { extension: 'sqlite' },
        });
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
      return runtime;
    },
    runtime() {
      return getRuntime();
    },
    prepare<
      D extends Declaration<CT>,
      Row,
      CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
    >(
      declaration: D,
      callback: (sql: UnboundSql<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
    ): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>> {
      return getRuntime().prepare<D, Row, CT>(declaration, (params) => callback(sql, params));
    },

    transaction<R>(fn: (tx: SqliteTransactionContext<TContract>) => PromiseLike<R>): Promise<R> {
      let runtime: ReturnType<typeof getRuntime>;
      try {
        runtime = getRuntime();
      } catch (err) {
        return Promise.reject(err);
      }

      // Serialise all transaction() calls so that at most one BEGIN…COMMIT
      // section is in-flight at a time.  SQLite only allows one writer
      // regardless, so this moves the queue from the driver's synchronous
      // busy-handler (which blocks a libuv worker thread) into the Node.js
      // event loop, preventing the thread-pool starvation described in #29870.
      const runTx = (): Promise<R> =>
        withTransaction(runtime, (txCtx) => {
          const rawCodecInferer = stack.adapter.rawCodecInferer;
          const txSqlNamespace = sqlBuilder<TContract>({ context, rawCodecInferer })[
            UNBOUND_NAMESPACE_ID
          ];
          assertDefined(
            txSqlNamespace,
            'the unbound namespace always exists on a sqlite builder output',
          );
          const txSql: UnboundSql<TContract> = blindCast<
            UnboundSql<TContract>,
            'Db<TContract> indexed by a literal key widens NsId to string; TableProxy is invariant in NsId via insert()/update() parameter positions, so the indexed-access type cannot be proven to match the literal-keyed Namespace without this cast'
          >(txSqlNamespace);

          const txOrm: UnboundOrm<TContract> = unboundOrm(
            ormBuilder({
              runtime: {
                query(plan) {
                  return txCtx.query(plan);
                },
                execute(plan) {
                  return txCtx.execute(plan);
                },
              },
              context,
            }),
          );

          // Use `txCtx` as the prototype instead of spreading it so that live
          // accessors (notably the `invalidated` getter, which reads a closure
          // variable in `withTransaction`) remain wired to the original object.
          // Spreading would evaluate the getter once and freeze its value.
          const tx: SqliteTransactionContext<TContract> = Object.assign(
            castAs<TransactionContext>(Object.create(txCtx)),
            { sql: txSql, orm: txOrm, enums },
          );

          return fn(tx);
        });

      // Append to the tail of the serialisation chain.  Each call waits for
      // its predecessor to settle (resolve *or* reject) before it begins, so
      // failures never block subsequent transactions.
      const txPromise = transactionQueueTail.then(
        () => runTx(),
        () => runTx(),
      );
      // Update the tail without propagating the rejection upward from the chain
      // itself (the caller already holds a reference to `txPromise`).
      transactionQueueTail = txPromise.then(
        () => undefined,
        () => undefined,
      );
      return txPromise;
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
