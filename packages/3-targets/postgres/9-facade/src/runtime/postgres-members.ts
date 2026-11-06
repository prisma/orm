import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import {
  type CollectionClasses,
  type NoCollectionClasses,
  orm as ormBuilder,
  type PreparedFrom,
  type PrepareMember,
  prepareQuery,
} from '@internal/sql-orm-client';
import type { CodecTypesBase } from '@internal/sql-relational-core/expression';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  Runtime,
  SqlExecutionStackWithDriver,
  ToSqlMember,
  TransactionContext,
} from '@internal/sql-runtime';
import {
  activitySource,
  delegatingActivitySource,
  delegatingRuntime,
  withTransaction,
  withTransactionMembers,
} from '@internal/sql-runtime';
import { ifDefined } from '@internal/utils/defined';
import type { PostgresStaticContext } from '../static/postgres-static';
import type { NamespacedNativeEnums } from './native-enums';
import type { PostgresTargetId } from './postgres-target-id';

type OrmClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
> = ReturnType<typeof ormBuilder<TContract, TCollections>>;

/** The query members of a Postgres client, which its transactions and Supabase's role-bound clients offer with the same types. */
export interface PostgresQueryMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PrepareMember<TContract>,
    RuntimeScope,
    ToSqlMember {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract, TCollections>;
  readonly raw: RawLane<TContract>;
}

export interface PostgresTransactionContext<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends TransactionContext,
    PostgresQueryMembers<TContract, TCollections> {
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
}

export interface PostgresQueryMembersOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
> {
  readonly context: ExecutionContext<TContract>;
  readonly collections: TCollections | undefined;
  readonly sql: Db<TContract>;
  readonly raw: RawLane<TContract>;
  readonly toSql: ToSqlMember['toSql'];
  readonly prepareRuntime: Pick<Runtime, 'prepare'>;
}

/**
 * Builds the query members of a Postgres transaction over `txCtx`, so every statement they run goes through the transaction. `query` and `execute` are the transaction's own; `sql`, `raw` and `toSql` are the client's. Preparing sends nothing to the database, so `prepare` uses `prepareRuntime`; the prepared statement runs on the queryable it is given.
 */
export function buildPostgresQueryMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
>(
  options: PostgresQueryMembersOptions<TContract, TCollections>,
  txCtx: TransactionContext,
): Omit<PostgresQueryMembers<TContract, TCollections>, keyof RuntimeScope> {
  const { context, collections, sql, raw, toSql, prepareRuntime } = options;
  return {
    toSql,
    sql,
    raw,
    orm: ormBuilder<TContract, TCollections>({
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
    prepare(declaration, callback) {
      return prepareQuery(prepareRuntime, declaration, callback);
    },
  };
}

export interface PostgresStaticMembers<TContract extends Contract<SqlStorage>>
  extends PostgresStaticContext<TContract> {
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
}

export interface PostgresRuntimeBoundMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PrepareMember<TContract> {
  readonly orm: OrmClient<TContract, TCollections>;
  runtime(): Runtime;
  transaction<R>(
    fn: (tx: PostgresTransactionContext<TContract, TCollections>) => PromiseLike<R>,
  ): Promise<R>;
}

export interface PostgresLifecycleMembers {
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface PostgresRuntimeBoundMembersOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
> {
  readonly context: ExecutionContext<TContract>;
  readonly collections: TCollections | undefined;
  readonly sql: Db<TContract>;
  readonly raw: RawLane<TContract>;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  readonly toSql: ToSqlMember['toSql'];
  readonly getRuntime: () => Runtime;
  // The runtime that ORM queries, transaction() and prepare() run on. An owner whose close() should let continuing work finish returns its runtime even after close(), so the runtime's own rule decides; otherwise it is getRuntime.
  readonly getRuntimeForWork: () => Runtime;
}

export function buildPostgresRuntimeBoundMembers<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
>(
  options: PostgresRuntimeBoundMembersOptions<TContract, TCollections>,
): PostgresRuntimeBoundMembers<TContract, TCollections> & RuntimeScope {
  const {
    context,
    collections,
    sql,
    raw,
    enums,
    nativeEnums,
    toSql,
    getRuntime,
    getRuntimeForWork,
  } = options;

  const workRuntime = delegatingRuntime(getRuntimeForWork);

  const orm: OrmClient<TContract, TCollections> = ormBuilder<TContract, TCollections>({
    runtime: workRuntime,
    context,
    ...ifDefined('collections', collections),
  });

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
    orm,

    query: workRuntime.query,

    execute: workRuntime.execute,

    runtime() {
      return getRuntime();
    },

    prepare,

    transaction<R>(
      fn: (tx: PostgresTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    ): Promise<R> {
      return withTransaction(workRuntime, (txCtx) => {
        const tx: PostgresTransactionContext<TContract, TCollections> = withTransactionMembers(
          txCtx,
          {
            ...buildPostgresQueryMembers(
              { context, collections, sql, raw, toSql, prepareRuntime: workRuntime },
              txCtx,
            ),
            enums,
            nativeEnums,
          },
        );

        return fn(tx);
      });
    },
  };
}
