import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriver, {
  type PostgresDriverCreateOptions,
  suppressIdleConnectionErrors,
} from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  ExecutionContext,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { Client } from 'pg';
import { postgresError } from '../errors';
import type { PostgresTargetId } from './postgres';
import { PostgresRuntimeImpl } from './postgres-runtime';

export type PostgresServerlessCursorOptions = NonNullable<PostgresDriverCreateOptions['cursor']>;

export interface PostgresServerlessClient<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  readonly contract: TContract;
  connect(binding: { readonly url: string }): Promise<Runtime & AsyncDisposable>;
}

export interface PostgresServerlessOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly cursor?: PostgresServerlessCursorOptions;
}

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

function validateConnectionString(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw postgresError('RUNTIME.BINDING_INVALID', 'Postgres URL must be a non-empty string', {
      meta: { extension: 'postgres', reason: 'empty url' },
    });
  }
  return trimmed;
}

/**
 * Per-request Postgres facade for serverless / edge runtimes (Cloudflare Workers + Hyperdrive,
 * AWS Lambda, Vercel, Deno Deploy, Bun edge, etc.).
 *
 * Construction shape mirrors the Node `postgres()` factory but the returned client deliberately
 * omits `orm`, `runtime()`, and `transaction()`. Closure-cached convenience surfaces are unsafe
 * across `fetch` invocations: stale connections after isolate idle, concurrent-query races on a
 * shared `pg.Client`, no clean shutdown. Per-request callers acquire a fresh `Runtime` via
 * `db.connect({ url })` and dispose it via `await using` on scope exit.
 *
 * @example
 * ```ts
 * const db = postgresServerless<Contract>({ contractJson });
 *
 * export default {
 *   async fetch(_req: Request, env: Env): Promise<Response> {
 *     await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
 *     const rows = await runtime.query(db.sql.from(t).select(...).build());
 *     return Response.json(rows);
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
  const contract = resolveContract(options);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const sql: Db<TContract> = sqlBuilder<TContract>({
    context,
    rawCodecInferer: stack.adapter.rawCodecInferer,
  });

  return {
    sql,
    context,
    stack,
    contract,

    async connect(binding) {
      const url = validateConnectionString(binding.url);

      const driverDescriptor = stack.driver;
      if (!driverDescriptor) {
        throw new InternalError('Driver descriptor missing from execution stack');
      }

      const stackInstance = instantiateExecutionStack(stack);
      const driver = driverDescriptor.create({
        ...ifDefined('cursor', options.cursor),
      });

      const client = suppressIdleConnectionErrors(new Client({ connectionString: url }));
      await driver.connect({ kind: 'pgClient', client });

      let runtime: Runtime;
      try {
        runtime = new PostgresRuntimeImpl({
          context,
          adapter: stackInstance.adapter,
          driver,
          ...ifDefined('verifyMarker', options.verifyMarker),
          ...ifDefined('middleware', options.middleware),
        });
      } catch (err) {
        // The driver is bound to the pg.Client at this point; without a runtime
        // to wrap it, the caller has no handle to dispose. Close the driver so
        // the underlying pg.Client is released even if its TCP socket has not
        // yet opened (lazy connect): keeps cleanup symmetric with successful
        // construction and prevents real socket leaks if pg ever changes its
        // connect semantics.
        await driver.close().catch(() => undefined);
        throw err;
      }

      Object.defineProperty(runtime, Symbol.asyncDispose, {
        value: () => runtime.close(),
        configurable: true,
        writable: false,
        enumerable: false,
      });

      return blindCast<
        Runtime & AsyncDisposable,
        'Symbol.asyncDispose is defined on the runtime before returning'
      >(runtime);
    },
  };
}
