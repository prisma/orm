import type { Contract } from '@internal/contract/types';
import type { ActivityParent } from '@internal/framework-components/runtime';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { type PostgresRuntime, PostgresRuntimeImpl } from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  SqlConnection,
  SqlQueryable,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { SqlOrmPlan } from '@internal/sql-relational-core/types';
import type {
  ActivityExecuteOptions,
  ActivityRoute,
  ActivitySourceTarget,
  PreparedExecution,
  PreparedExecutionImpl,
  PreparedStatement,
  PreparedStatementImpl,
  RuntimeConnection,
  RuntimeQueryable,
  RuntimeTransaction,
} from '@internal/sql-runtime';
import { activitySource } from '@internal/sql-runtime';
import type {
  PreparedStatementExecuteTarget,
  PreparedStatementQueryTarget,
  TransactionStartTarget,
} from '@internal/sql-runtime/internal/prepared-query';
import {
  createTransactionStart,
  preparedStatementExecute,
  preparedStatementQuery,
  transactionStart,
} from '@internal/sql-runtime/internal/prepared-query';
import { blindCast } from '@internal/utils/casts';
import type { SupabaseRole } from '../contract/roles';

export interface SupabaseRuntime extends PostgresRuntime {
  /** The operations of this runtime under `binding`: each statement runs on a session bound to the role. A transaction runs on a session from `connection()`, as `withTransaction` and the ORM open it. */
  forRole(binding: SupabaseRoleBinding): SupabaseRoleScope;
}

/** The operations of a Supabase runtime under one role. */
export interface SupabaseRoleScope
  extends RuntimeQueryable,
    PreparedStatementQueryTarget,
    PreparedStatementExecuteTarget {
  /** Opens a session bound to the role; the caller releases it. */
  connection(): Promise<RoleSession>;
}

type BoundSession = RoleSession & PreparedStatementQueryTarget & PreparedStatementExecuteTarget;

export interface SupabaseRoleBinding {
  readonly role: SupabaseRole;
  readonly claims?: Record<string, unknown>;
}

/**
 * A connection with a Supabase role already bound via session-scoped set_config.
 * Implements `RuntimeConnection` so it plugs into ORM scope machinery and `withTransaction`.
 */
export interface RoleSession extends RuntimeConnection {}

type RoleScopeBuilder = <C extends Contract<SqlStorage>>(
  runtime: () => SupabaseRuntimeImpl<C>,
  binding: SupabaseRoleBinding,
) => SupabaseRoleScope & ActivitySourceTarget;

// Assigned in the class's static block, which may call the runtime's private and protected methods.
let buildRoleScope: RoleScopeBuilder;

/**
 * The operations under `binding` of the runtime `runtime()` returns. Each operation calls `runtime()` when it runs, so a client can build its role scope before its runtime exists; when `runtime()` throws, the operation rejects. For the facade only; the package entry does not export it.
 */
export function roleScope<C extends Contract<SqlStorage>>(
  runtime: () => SupabaseRuntimeImpl<C>,
  binding: SupabaseRoleBinding,
): SupabaseRoleScope & ActivitySourceTarget {
  return buildRoleScope(runtime, binding);
}

export class SupabaseRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends PostgresRuntimeImpl<TContract> {
  /**
   * Opens a raw connection and applies role + JWT claims via session-scoped set_config. On bind failure, destroys the connection before rethrowing — no leaked connections. Every operation of `forRole(binding)` runs on a session opened here.
   */
  async openRoleSession(binding: SupabaseRoleBinding): Promise<RoleSession> {
    return (await this.openRoleConnection(binding)).session;
  }

  private async openRoleConnection(
    binding: SupabaseRoleBinding,
    options?: Pick<ActivityExecuteOptions, 'activityParent'>,
  ): Promise<{
    readonly conn: SqlConnection;
    readonly session: BoundSession & TransactionStartTarget;
  }> {
    const conn = await this.acquireRawConnection(options);

    try {
      await conn.execute({
        sql: 'SELECT set_config($1, $2, false)',
        params: ['role', binding.role],
      });
      await conn.execute({
        sql: 'SELECT set_config($1, $2, false)',
        params: ['request.jwt.claims', JSON.stringify(binding.claims ?? {})],
      });
    } catch (err) {
      await conn.destroy(err).catch(() => undefined);
      throw err;
    }

    const self = this;

    const session: RoleSession &
      TransactionStartTarget &
      ActivitySourceTarget &
      PreparedStatementQueryTarget &
      PreparedStatementExecuteTarget = {
      [transactionStart]: createTransactionStart(),
      [activitySource]: self.connectionActivitySource(conn, () => session),
      query<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: ActivityExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.queryAgainstQueryable<Row>(plan, conn, { ...options, scope: 'connection' });
      },
      execute(
        plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
        options?: ActivityExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.executeStatisticsAgainstQueryable(plan, conn, {
          ...options,
          scope: 'connection',
        });
      },
      [preparedStatementQuery]<Params, Row>(
        prepared: PreparedStatement<Params, Row>,
        params: Params,
        options?: ActivityExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.runPreparedQueryAgainstRoleQueryable(prepared, params, conn, options);
      },
      [preparedStatementExecute]<Params>(
        prepared: PreparedExecution<Params>,
        params: Params,
        options?: ActivityExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.runPreparedExecuteAgainstRoleQueryable(prepared, params, conn, options);
      },

      async transaction(): Promise<RuntimeTransaction> {
        return self.beginTransactionOn(conn, session, undefined);
      },

      /**
       * Resets all session-local config and the role (`RESET ALL` leaves `role` alone), then releases the connection back to the pool. If a reset fails, destroys the connection instead — pool-poisoning guarantee.
       */
      async release(): Promise<void> {
        try {
          await conn.execute({ sql: 'RESET ALL' });
          await conn.execute({ sql: 'RESET ROLE' });
          await conn.release();
        } catch (resetError) {
          await conn.destroy(resetError).catch(() => undefined);
        }
      },

      async destroy(reason?: unknown): Promise<void> {
        await conn.destroy(reason);
      },
    };

    return { conn, session };
  }

  forRole(binding: SupabaseRoleBinding): SupabaseRoleScope & ActivitySourceTarget {
    return buildRoleScope(() => this, binding);
  }

  static {
    buildRoleScope = (runtime, binding) => {
      const open = (options: ActivityExecuteOptions | undefined) => async () =>
        (await runtime().openRoleConnection(binding, options)).session;
      const scope: SupabaseRoleScope & ActivitySourceTarget = {
        query<Row>(
          plan: SqlOrmPlan<Row>,
          options?: ActivityExecuteOptions,
        ): AsyncIterableResult<Row> {
          return streamOnSession(open(options), (session) => session.query<Row>(plan, options));
        },
        execute(plan: SqlOrmPlan, options?: ActivityExecuteOptions): Promise<SqlStatementStats> {
          return executeOnSession(open(options), (session) => session.execute(plan, options));
        },
        [preparedStatementQuery]<Params, Row>(
          statement: PreparedStatement<Params, Row>,
          params: Params,
          options?: ActivityExecuteOptions,
        ): AsyncIterableResult<Row> {
          return streamOnSession<Row>(open(options), (session) =>
            session[preparedStatementQuery](statement, params, options),
          );
        },
        [preparedStatementExecute]<Params>(
          statement: PreparedExecution<Params>,
          params: Params,
          options?: ActivityExecuteOptions,
        ): Promise<SqlStatementStats> {
          return executeOnSession(open(options), (session) =>
            session[preparedStatementExecute](statement, params, options),
          );
        },
        connection: open(undefined),
        [activitySource]: {
          startActivity: async (activity) =>
            runtime().startActivityOnRoute(route, activity, undefined),
          planContentHash: async (plan) =>
            runtime().planContentHashFor(plan, 'connection', undefined),
        },
      };
      // Each statement of a role-bound activity runs on a role session of its own, as a role-bound query does; its transaction holds one session until it settles.
      const route: ActivityRoute = {
        scope: 'connection',
        parent: () => undefined,
        runtimeWork: true,
        query: (plan, options) => scope.query(plan, options),
        execute: (plan, options) => scope.execute(plan, options),
        preparedQuery: (statement, params, options) =>
          scope[preparedStatementQuery](statement, params, options),
        preparedExecute: (statement, params, options) =>
          scope[preparedStatementExecute](statement, params, options),
        transaction: (parent) => runtime().beginRoleTransaction(binding, parent),
      };
      return scope;
    };
  }

  private async beginRoleTransaction(
    binding: SupabaseRoleBinding,
    parent: ActivityParent,
  ): Promise<RuntimeTransaction> {
    const { conn, session } = await this.openRoleConnection(binding, { activityParent: parent });
    return this.ownTransaction(session, () => this.beginTransactionOn(conn, session, parent));
  }

  private runPreparedExecuteAgainstRoleQueryable<Params>(
    prepared: PreparedExecution<Params>,
    params: Params,
    queryable: SqlQueryable,
    options: ActivityExecuteOptions | undefined,
  ): Promise<SqlStatementStats> {
    return this.runPreparedExecuteAgainstQueryable<Params>(
      blindCast<
        PreparedExecutionImpl<Params>,
        'SQL runtime prepare returns PreparedExecutionImpl instances for statistics plans'
      >(prepared),
      blindCast<Record<string, unknown>, 'Prepared params follow their declared record shape'>(
        params,
      ),
      queryable,
      { ...options, scope: 'connection' },
    );
  }

  private runPreparedQueryAgainstRoleQueryable<Params, Row>(
    prepared: PreparedStatement<Params, Row>,
    params: Params,
    queryable: SqlQueryable,
    options: ActivityExecuteOptions | undefined,
  ): AsyncIterableResult<Row> {
    return this.runPreparedQueryAgainstQueryable<Params, Row>(
      blindCast<
        PreparedStatementImpl<Params, Row>,
        'SQL runtime prepare returns PreparedStatementImpl instances'
      >(prepared),
      blindCast<Record<string, unknown>, 'Prepared params follow their declared record shape'>(
        params,
      ),
      queryable,
      { ...options, scope: 'connection' },
    );
  }
}

// Opens a session when the stream is first read, releases it after the stream drains, and destroys it on a mid-stream error.
function streamOnSession<Row>(
  open: () => Promise<BoundSession>,
  rows: (session: BoundSession) => AsyncIterable<Row>,
): AsyncIterableResult<Row> {
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const session = await open();
    let errored = false;
    try {
      for await (const row of rows(session)) {
        yield row;
      }
    } catch (err) {
      errored = true;
      await session.destroy(err).catch(() => undefined);
      throw err;
    } finally {
      if (!errored) {
        await session.release();
      }
    }
  };
  return new AsyncIterableResult(generator());
}

async function executeOnSession(
  open: () => Promise<BoundSession>,
  run: (session: BoundSession) => Promise<SqlStatementStats>,
): Promise<SqlStatementStats> {
  const session = await open();
  try {
    const stats = await run(session);
    await session.release();
    return stats;
  } catch (err) {
    await session.destroy(err).catch(() => undefined);
    throw err;
  }
}
