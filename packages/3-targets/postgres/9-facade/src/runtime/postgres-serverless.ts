import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriver, {
  createPgClient,
  suppressIdleConnectionErrors,
} from '@internal/driver-postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { CollectionClasses, NoCollectionClasses } from '@internal/sql-orm-client';
import type { Runtime } from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { redactDatabaseUrl } from '@internal/utils/redact-db-url';
import { postgresError } from '../errors';
import { validatePostgresContract } from '../static/contract-from-json';
import { buildPostgresStaticContext } from '../static/postgres-static';
import { validatePostgresUrl } from './binding';
import {
  buildPostgresRuntimeBoundMembers,
  type PostgresLifecycleMembers,
  type PostgresQueryMembers,
  type PostgresRuntimeBoundMembers,
  type PostgresStaticMembers,
} from './postgres-members';
import {
  DEFAULT_CONNECT_TIMEOUT_MILLIS,
  type PostgresExecutionOptions,
  toDriverCursorOptions,
  toRuntimeOptions,
  validateCursorOptions,
} from './postgres-options';
import { PostgresRuntimeImpl } from './postgres-runtime';
import type { PostgresTargetId } from './postgres-target-id';

export interface PostgresServerlessConnection<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PostgresQueryMembers<TContract, TCollections>,
    PostgresStaticMembers<TContract>,
    PostgresRuntimeBoundMembers<TContract, TCollections>,
    PostgresLifecycleMembers {}

export interface PostgresServerlessClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PostgresStaticMembers<TContract> {
  connect(binding: {
    readonly url: string;
  }): Promise<PostgresServerlessConnection<TContract, TCollections>>;
}

export interface PostgresServerlessOptionsBase extends PostgresExecutionOptions {}

export type PostgresServerlessOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = PostgresServerlessOptionsBase & {
  readonly contract: TContract;
  readonly collections?: TCollections;
};

function closedConnectionError() {
  return postgresError('DRIVER.NOT_CONNECTED', 'Postgres connection is closed', {
    why: 'close() was called on this connection, or the await using scope that held it has ended.',
    fix: 'Call connect({ url }) again to open a new connection.',
    meta: { extension: 'postgres' },
  });
}

function connectionFailedError(url: string, cause: unknown) {
  return postgresError('DRIVER.CONNECTION_FAILED', 'Database connection failed', {
    why: cause instanceof Error ? cause.message : String(cause),
    fix: 'Verify the database URL, ensure the database is reachable, and confirm credentials/permissions',
    meta: { extension: 'postgres', ...redactDatabaseUrl(url) },
    cause,
  });
}

/**
 * Creates a serverless client for serverless and edge runtimes (Cloudflare Workers + Hyperdrive,
 * AWS Lambda, Vercel, Deno Deploy).
 *
 * The serverless client holds no database connection and has the static members. Each
 * `connect({ url })` opens one database connection, a fresh `pg.Client`, and returns a connection
 * with the members of a `postgres()` client except `connect`. It rejects with
 * `DRIVER.CONNECTION_FAILED` when the database refuses the connection, rejects the credentials,
 * or does not answer within 20 seconds. Close the connection with `await using` or `close()`.
 *
 * The client infers its contract type from `contract` and validates it once, when the client is
 * created; connections reuse it.
 *
 * @example
 * ```ts
 * const postgres = postgresServerless({ contract: contractFromJson<Contract>(contractJson) });
 *
 * export default {
 *   async fetch(_req: Request, env: Env): Promise<Response> {
 *     await using db = await postgres.connect({ url: env.HYPERDRIVE.connectionString });
 *     const users = await db.orm.public.User.all();
 *     return Response.json(users);
 *   },
 * };
 * ```
 */
export default function postgresServerless<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
>(
  options: PostgresServerlessOptions<TContract, TCollections>,
): PostgresServerlessClient<TContract, TCollections> {
  const cursor = validateCursorOptions(options.cursor, 'postgresServerless');
  const contract = validatePostgresContract(options.contract);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: options.extensions ?? [],
  });

  const context = createExecutionContext<TContract, PostgresTargetId>({
    contract,
    stack,
    driver: postgresDriver,
  });
  const { sql, raw, enums, nativeEnums, toSql } = buildPostgresStaticContext<TContract>(
    contract,
    context,
    stack,
  );

  const buildRuntimeBoundMembers = (getRuntime: () => Runtime, getRuntimeForWork: () => Runtime) =>
    buildPostgresRuntimeBoundMembers<TContract, TCollections>({
      context,
      collections: options.collections,
      sql,
      raw,
      enums,
      nativeEnums,
      toSql,
      getRuntime,
      getRuntimeForWork,
    });

  // The ORM checks the execution context when it is built. Building the members once here makes
  // a contract or extension the ORM rejects fail at the factory call, as it does for postgres().
  const noRuntime = (): never => {
    throw new InternalError('The serverless client has no runtime');
  };
  buildRuntimeBoundMembers(noRuntime, noRuntime);

  const createConnection = (
    runtime: Runtime,
  ): PostgresServerlessConnection<TContract, TCollections> => {
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= runtime.close();
      return closing;
    };
    const runtimeBoundMembers = buildRuntimeBoundMembers(
      () => {
        if (closing !== undefined) {
          throw closedConnectionError();
        }
        return runtime;
      },
      () => runtime,
    );

    return {
      sql,
      raw,
      enums,
      nativeEnums,
      toSql,
      context,
      contract,
      stack,
      ...runtimeBoundMembers,
      close,
      [Symbol.asyncDispose]: close,
    };
  };

  return {
    sql,
    raw,
    enums,
    nativeEnums,
    toSql,
    context,
    stack,
    contract,

    async connect(binding) {
      const url = validatePostgresUrl(binding.url);

      const driverDescriptor = stack.driver;

      const adapter = stack.adapter.create(stack);
      const driver = driverDescriptor.create({
        cursor: toDriverCursorOptions(cursor),
      });

      const pgClient = suppressIdleConnectionErrors(
        createPgClient(
          { connectionString: url, connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MILLIS },
          stack.target.sessionSettings ?? {},
        ),
      );
      await driver.connect({ kind: 'pgClient', client: pgClient, ownedByDriver: true });

      // Everything that can fail for a reason other than the database is built before the
      // database connection opens, so a failure here leaves nothing to close.
      // A connection belongs to one request, so its close admits work that continues that request.
      const runtime = new PostgresRuntimeImpl({
        context,
        adapter,
        driver,
        ...toRuntimeOptions(options),
        closeRefusal: 'when-idle',
      });
      const connection = createConnection(runtime);

      try {
        const driverConnection = await driver.acquireConnection();
        await driverConnection.release();
      } catch (err) {
        await driver.close().catch(() => undefined);
        throw connectionFailedError(url, err);
      }

      return connection;
    },
  };
}
