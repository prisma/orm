import type { Contract } from '@prisma-next/contract/types';
import type { RuntimeExecuteOptions } from '@prisma-next/framework-components/runtime';
import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import { type PostgresRuntime, PostgresRuntimeImpl } from '@prisma-next/postgres/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  PreparedStatement,
  PreparedStatementImpl,
  RuntimeConnection,
  RuntimeTransaction,
} from '@prisma-next/sql-runtime';
import { blindCast } from '@prisma-next/utils/casts';

export interface SupabaseRuntime extends PostgresRuntime {}

export interface SupabaseRoleBinding {
  // TODO(TML-2501): role names move to the Supabase extension contract (roles as first-class IR) when postgres-rls lands.
  readonly role: 'anon' | 'authenticated' | 'service_role';
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
      await conn.query('SELECT set_config($1, $2, false)', ['role', binding.role]);
      await conn.query('SELECT set_config($1, $2, false)', [
        'request.jwt.claims',
        JSON.stringify(binding.claims ?? {}),
      ]);
    } catch (err) {
      await conn.destroy(err).catch(() => undefined);
      throw err;
    }

    const self = this;
    const releaseHooks: Array<() => Promise<void>> = [];

    const session: RoleSession = {
      execute<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.executeAgainstQueryable<Row>(plan, conn, { ...options, scope: 'connection' });
      },

      executePrepared<Params, Row>(
        ps: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.executePreparedAgainstQueryable(
          blindCast<
            PreparedStatementImpl<Params, Row>,
            'PreparedStatement is PreparedStatementImpl; the impl class is the only concrete form'
          >(ps),
          blindCast<
            Record<string, unknown>,
            'params are structurally Record<string, unknown> at runtime'
          >(params),
          conn,
          { ...options, scope: 'connection' },
        );
      },

      async transaction(): Promise<RuntimeTransaction> {
        const tx = await conn.beginTransaction();
        return self.wrapTransaction(tx);
      },

      registerReleaseHook(hook: () => Promise<void>): void {
        releaseHooks.push(hook);
      },

      /**
       * Resets all session-local config then releases the connection back to the pool.
       * If RESET ALL fails, destroys the connection instead — pool-poisoning guarantee.
       */
      async release(): Promise<void> {
        for (const hook of releaseHooks) {
          await hook();
        }
        try {
          await conn.query('RESET ALL');
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
   * Opens a role session, executes the plan, then releases after the stream drains.
   * On mid-stream error, destroys the session instead of releasing.
   */
  executeWithRole<Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
    binding: SupabaseRoleBinding,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    const self = this;

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const session = await self.openRoleSession(binding);
      let errored = false;
      try {
        for await (const row of session.execute(plan, options)) {
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
}
