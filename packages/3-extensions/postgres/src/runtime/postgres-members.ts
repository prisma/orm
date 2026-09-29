import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import { sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db } from '@internal/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import { orm as ormBuilder, type PreparedFrom, prepareQuery } from '@internal/sql-orm-client';
import type { CodecTypesBase, RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  Runtime,
  SqlExecutionStackWithDriver,
  TransactionContext,
} from '@internal/sql-runtime';
import { withTransaction } from '@internal/sql-runtime';
import { castAs } from '@internal/utils/casts';
import type { PostgresStaticContext } from '../static/postgres-static';
import type { NamespacedNativeEnums } from './native-enums';
import type { PostgresTargetId } from './postgres-target-id';

type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof ormBuilder<TContract>>;

export interface PostgresTransactionContext<TContract extends Contract<SqlStorage>>
  extends TransactionContext {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
}

export interface PostgresStaticMembers<TContract extends Contract<SqlStorage>>
  extends PostgresStaticContext<TContract> {
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
}

export interface PostgresRuntimeBoundMembers<TContract extends Contract<SqlStorage>> {
  readonly orm: OrmClient<TContract>;
  runtime(): Runtime;
  transaction<R>(fn: (tx: PostgresTransactionContext<TContract>) => PromiseLike<R>): Promise<R>;
  prepare<
    D extends Declaration<CT>,
    Q extends SqlQueryPlan | Preparable<unknown, unknown>,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
  >(
    declaration: D,
    callback: (params: BindSiteParams<D>) => Q,
  ): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>>;
}

export interface PostgresLifecycleMembers {
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface PostgresRuntimeBoundMembersOptions<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly rawCodecInferer: RawCodecInferer;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  readonly getRuntime: () => Runtime;
}

export function buildPostgresRuntimeBoundMembers<TContract extends Contract<SqlStorage>>(
  options: PostgresRuntimeBoundMembersOptions<TContract>,
): PostgresRuntimeBoundMembers<TContract> {
  const { context, rawCodecInferer, enums, nativeEnums, getRuntime } = options;

  const orm: OrmClient<TContract> = ormBuilder({
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
    context,
  });

  function prepare<
    D extends Declaration<CT>,
    Q extends SqlQueryPlan | Preparable<unknown, unknown>,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
  >(
    declaration: D,
    callback: (params: BindSiteParams<D>) => Q,
  ): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>> {
    return prepareQuery<D, Q, CT>(getRuntime(), declaration, callback);
  }

  return {
    orm,

    runtime() {
      return getRuntime();
    },

    prepare,

    transaction<R>(fn: (tx: PostgresTransactionContext<TContract>) => PromiseLike<R>): Promise<R> {
      return withTransaction(getRuntime(), (txCtx) => {
        const txSql: Db<TContract> = sqlBuilder<TContract>({
          context,
          rawCodecInferer,
        });

        const txOrm: OrmClient<TContract> = ormBuilder({
          runtime: {
            query(plan) {
              return txCtx.query(plan);
            },
            execute(plan) {
              return txCtx.execute(plan);
            },
          },
          context,
        });

        // Use `txCtx` as the prototype instead of spreading it so that live
        // accessors (notably the `invalidated` getter, which reads a closure
        // variable in `withTransaction`) remain wired to the original object.
        // Spreading would evaluate the getter once and freeze its value.
        const tx: PostgresTransactionContext<TContract> = Object.assign(
          castAs<TransactionContext>(Object.create(txCtx)),
          { sql: txSql, orm: txOrm, enums, nativeEnums },
        );

        return fn(tx);
      });
    },
  };
}
