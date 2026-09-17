import type { Contract } from '@internal/contract/types';
import type { RuntimeExecuteOptions } from '@internal/framework-components/runtime';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { type PostgresRuntime, PostgresRuntimeImpl } from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  SqlQueryable,
  SqlStatementStats,
  SqlTransactionOptions,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  PreparedExecution,
  PreparedExecutionImpl,
  PreparedStatement,
  PreparedStatementImpl,
  RuntimeConnection,
  RuntimeTransaction,
} from '@internal/sql-runtime';
import type {
  PreparedStatementExecuteTarget,
  PreparedStatementQueryTarget,
} from '@internal/sql-runtime/internal/prepared-query';
import {
  preparedStatementExecute,
  preparedStatementQuery,
} from '@internal/sql-runtime/internal/prepared-query';
import { blindCast } from '@internal/utils/casts';
import type { SupabaseRole } from '../contract/roles';

export interface SupabaseRuntime extends PostgresRuntime {
  queryWithRole<Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
    binding: SupabaseRoleBinding,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  executeWithRole(
    plan: SqlExecutionPlan | SqlQueryPlan,
    binding: SupabaseRoleBinding,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats>;
}

export interface SupabaseRoleBinding {
  readonly role: SupabaseRole;
  readonly claims?: Record<string, unknown>;
}

/**
 * A connection with a Supabase role already bound via session-scoped set_config.
 * Implements `RuntimeConnection` so it plugs into ORM scope machinery and `withTransaction`.
 */
export interface RoleSession extends RuntimeConnection {}

export class SupabaseRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends PostgresRuntimeImpl<TContract> {
  /**
   * Opens a raw connection and applies role + JWT claims via session-scoped set_config.
   * On bind failure, destroys the connection before rethrowing — no leaked connections.
   * Not on the `SupabaseRuntime` interface; consumed by the facade, not by app code.
   */
  async openRoleSession(binding: SupabaseRoleBinding): Promise<RoleSession> {
    const conn = await this.acquireRawConnection();

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

    const session: RoleSession & PreparedStatementQueryTarget & PreparedStatementExecuteTarget = {
      query<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.queryAgainstQueryable<Row>(plan, conn, { ...options, scope: 'connection' });
      },
      execute(
        plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.executeStatisticsAgainstQueryable(plan, conn, {
          ...options,
          scope: 'connection',
        });
      },
      [preparedStatementQuery]<Params, Row>(
        prepared: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.runPreparedQueryAgainstRoleQueryable(
          prepared,
          params,
          conn,
          options,
          'connection',
        );
      },
      [preparedStatementExecute]<Params>(
        prepared: PreparedExecution<Params>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.runPreparedExecuteAgainstRoleQueryable(
          prepared,
          params,
          conn,
          options,
          'connection',
        );
      },

      async transaction(options?: SqlTransactionOptions): Promise<RuntimeTransaction> {
        const tx = await conn.beginTransaction(options);
        const roleTransaction: RuntimeTransaction &
          PreparedStatementQueryTarget &
          PreparedStatementExecuteTarget = {
          async commit(): Promise<void> {
            await tx.commit();
          },
          async rollback(): Promise<void> {
            await tx.rollback();
          },
          query<Row>(
            plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
            options?: RuntimeExecuteOptions,
          ): AsyncIterableResult<Row> {
            return self.queryAgainstQueryable<Row>(plan, tx, { ...options, scope: 'transaction' });
          },
          execute(
            plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
            options?: RuntimeExecuteOptions,
          ): Promise<SqlStatementStats> {
            return self.executeStatisticsAgainstQueryable(plan, tx, {
              ...options,
              scope: 'transaction',
            });
          },
          [preparedStatementQuery]<Params, Row>(
            prepared: PreparedStatement<Params, Row>,
            params: Params,
            options?: RuntimeExecuteOptions,
          ): AsyncIterableResult<Row> {
            return self.runPreparedQueryAgainstRoleQueryable(
              prepared,
              params,
              tx,
              options,
              'transaction',
            );
          },
          [preparedStatementExecute]<Params>(
            prepared: PreparedExecution<Params>,
            params: Params,
            options?: RuntimeExecuteOptions,
          ): Promise<SqlStatementStats> {
            return self.runPreparedExecuteAgainstRoleQueryable(
              prepared,
              params,
              tx,
              options,
              'transaction',
            );
          },
        };
        return roleTransaction;
      },

      /**
       * Resets all session-local config then releases the connection back to the pool.
       * If RESET ALL fails, destroys the connection instead — pool-poisoning guarantee.
       */
      async release(): Promise<void> {
        try {
          await conn.execute({ sql: 'RESET ALL' });
          await conn.release();
        } catch (resetError) {
          await conn.destroy(resetError).catch(() => undefined);
        }
      },

      async destroy(reason?: unknown): Promise<void> {
        await conn.destroy(reason);
      },
    };

    return session;
  }

  /**
   * Opens a role session, queries the plan, then releases after the stream drains.
   * On mid-stream error, destroys the session instead of releasing.
   */
  queryWithRole<Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
    binding: SupabaseRoleBinding,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    const self = this;

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const session = await self.openRoleSession(binding);
      let errored = false;
      try {
        for await (const row of session.query(plan, options)) {
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

  async executeWithRole(
    plan: SqlExecutionPlan | SqlQueryPlan,
    binding: SupabaseRoleBinding,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    const session = await this.openRoleSession(binding);
    try {
      const stats = await session.execute(plan, options);
      await session.release();
      return stats;
    } catch (err) {
      await session.destroy(err).catch(() => undefined);
      throw err;
    }
  }

  private runPreparedExecuteAgainstRoleQueryable<Params>(
    prepared: PreparedExecution<Params>,
    params: Params,
    queryable: SqlQueryable,
    options: RuntimeExecuteOptions | undefined,
    scope: 'connection' | 'transaction',
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
      { ...options, scope },
    );
  }

  private runPreparedQueryAgainstRoleQueryable<Params, Row>(
    prepared: PreparedStatement<Params, Row>,
    params: Params,
    queryable: SqlQueryable,
    options: RuntimeExecuteOptions | undefined,
    scope: 'connection' | 'transaction',
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
      { ...options, scope },
    );
  }
}
