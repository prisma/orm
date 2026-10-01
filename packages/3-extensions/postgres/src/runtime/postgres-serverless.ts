import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriver, { suppressIdleConnectionErrors } from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Runtime } from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { redactDatabaseUrl } from '@internal/utils/redact-db-url';
import { Client } from 'pg';
import { postgresError } from '../errors';
import { buildPostgresStaticContext } from '../static/postgres-static';
import { validatePostgresUrl } from './binding';
import {
  buildPostgresRuntimeBoundMembers,
  type PostgresLifecycleMembers,
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

export interface PostgresServerlessConnection<TContract extends Contract<SqlStorage>>
  extends PostgresStaticMembers<TContract>,
    PostgresRuntimeBoundMembers<TContract>,
    PostgresLifecycleMembers {}

export interface PostgresServerlessClient<TContract extends Contract<SqlStorage>>
  extends PostgresStaticMembers<TContract> {
  connect(binding: { readonly url: string }): Promise<PostgresServerlessConnection<TContract>>;
}

export interface PostgresServerlessOptionsBase extends PostgresExecutionOptions {}

export type PostgresServerlessOptionsWithContract<TContract extends Contract<SqlStorage>> =
  PostgresServerlessOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type PostgresServerlessOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  PostgresServerlessOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
    readonly _contract?: TContract;
  };

export type PostgresServerlessOptions<TContract extends Contract<SqlStorage>> =
  | PostgresServerlessOptionsWithContract<TContract>
  | PostgresServerlessOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptions<TContract>,
): options is PostgresServerlessOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new PostgresContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptions<TContract>,
): TContract {
  const contractJson = hasContractJson(options)
    ? options.contractJson
    : contractSerializer.serializeContract(options.contract);
  return blindCast<
    TContract,
    'caller supplies the generic contract type that matches the serialized Postgres contract'
  >(contractSerializer.deserializeContract(contractJson));
}

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
 * @example
 * ```ts
 * const postgres = postgresServerless<Contract>({ contractJson });
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
export default function postgresServerless<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptionsWithContract<TContract>,
): PostgresServerlessClient<TContract>;
export default function postgresServerless<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptionsWithContractJson<TContract>,
): PostgresServerlessClient<TContract>;
export default function postgresServerless<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptions<TContract>,
): PostgresServerlessClient<TContract> {
  const cursor = validateCursorOptions(options.cursor, 'postgresServerless');
  const contract = resolveContract(options);
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
  const rawCodecInferer = stack.adapter.rawCodecInferer;
  const { sql, raw, enums, nativeEnums } = buildPostgresStaticContext<TContract>(
    context,
    rawCodecInferer,
  );

  const buildRuntimeBoundMembers = (getRuntime: () => Runtime, getRuntimeForWork: () => Runtime) =>
    buildPostgresRuntimeBoundMembers<TContract>({
      context,
      rawCodecInferer,
      enums,
      nativeEnums,
      getRuntime,
      getRuntimeForWork,
    });

  // The ORM checks the execution context when it is built. Building the members once here makes
  // a contract or extension the ORM rejects fail at the factory call, as it does for postgres().
  const noRuntime = (): never => {
    throw new InternalError('The serverless client has no runtime');
  };
  buildRuntimeBoundMembers(noRuntime, noRuntime);

  const createConnection = (runtime: Runtime): PostgresServerlessConnection<TContract> => {
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
    context,
    stack,
    contract,

    async connect(binding) {
      const url = validatePostgresUrl(binding.url);

      const driverDescriptor = stack.driver;
      if (!driverDescriptor) {
        throw new InternalError('Driver descriptor missing from execution stack');
      }

      const stackInstance = instantiateExecutionStack(stack);
      const driver = driverDescriptor.create({
        cursor: toDriverCursorOptions(cursor),
      });

      const pgClient = suppressIdleConnectionErrors(
        new Client({
          connectionString: url,
          connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MILLIS,
        }),
      );
      await driver.connect({ kind: 'pgClient', client: pgClient });

      // Everything that can fail for a reason other than the database is built before the
      // database connection opens, so a failure here leaves nothing to close.
      // A connection belongs to one request, so its close admits work that continues that request.
      const runtime = new PostgresRuntimeImpl({
        context,
        adapter: stackInstance.adapter,
        driver,
        ...toRuntimeOptions(options),
        closeRefusal: 'when-idle',
      });
      const connection = createConnection(runtime);

      try {
        const driverConnection = await driver.acquireConnection();
        await driverConnection.release();
      } catch (err) {
        // A pg.Client whose connect failed has no socket. Its end() is not awaited, because
        // under pg-cloudflare that promise never settles.
        void pgClient.end().catch(() => undefined);
        throw connectionFailedError(url, err);
      }

      return connection;
    },
  };
}
