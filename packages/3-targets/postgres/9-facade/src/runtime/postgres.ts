import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriver, {
  createPgPool,
  type PostgresBinding as DriverPostgresBinding,
  suppressIdleConnectionErrors,
} from '@internal/driver-postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { CollectionClasses, NoCollectionClasses } from '@internal/sql-orm-client';
import type { Runtime } from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { InternalError } from '@internal/utils/internal-error';
import type { Client, Pool } from 'pg';
import { postgresError } from '../errors';
import { validatePostgresContract } from '../static/contract-from-json';
import { buildPostgresStaticContext } from '../static/postgres-static';
import {
  type PostgresBinding,
  type PostgresBindingInput,
  resolveOptionalPostgresBinding,
  resolvePostgresBinding,
} from './binding';
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

export interface PostgresClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PostgresQueryMembers<TContract, TCollections>,
    PostgresStaticMembers<TContract>,
    PostgresRuntimeBoundMembers<TContract, TCollections>,
    PostgresLifecycleMembers {
  connect(bindingInput?: PostgresBindingInput): Promise<Runtime>;
}

export interface PostgresOptionsBase extends PostgresExecutionOptions {
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface PostgresBindingOptions {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
}

export type PostgresOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = PostgresBindingOptions &
  PostgresOptionsBase & {
    readonly contract: TContract;
    readonly collections?: TCollections;
  };

type ConnectedBinding = Exclude<DriverPostgresBinding, { readonly kind: 'url' }>;

function toRuntimeBinding<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses,
>(binding: PostgresBinding, options: PostgresOptions<TContract, TCollections>): ConnectedBinding {
  if (binding.kind !== 'url') {
    return { ...binding, ownedByDriver: false };
  }

  return {
    kind: 'pgPool',
    ownedByDriver: true,
    pool: suppressIdleConnectionErrors(
      createPgPool(
        {
          connectionString: binding.url,
          connectionTimeoutMillis:
            options.poolOptions?.connectionTimeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MILLIS,
          idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
        },
        postgresTarget.sessionSettings ?? {},
      ),
    ),
  } as const;
}

/**
 * Creates a lazy Postgres client. The client infers its contract type from `contract`: a value from
 * `contractFromJson` for an emitted contract, or a TypeScript-authored contract. A contract is
 * validated once, however many clients are built from it. The static query surfaces are available
 * at once; the pool is created on the first query or `connect()`.
 *
 * @example
 * ```ts
 * import { contractFromJson } from '@prisma/orm-postgres/static';
 * import postgres from '@prisma/orm-postgres/runtime';
 * import type { Contract } from './contract.d';
 * import contractJson from './contract.json' with { type: 'json' };
 *
 * export const contract = contractFromJson<Contract>(contractJson);
 * export const db = postgres({ contract, url: process.env['DATABASE_URL']! });
 * ```
 */
export default function postgres<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
>(options: PostgresOptions<TContract, TCollections>): PostgresClient<TContract, TCollections> {
  const cursor = validateCursorOptions(options.cursor, 'postgres');
  const contract = validatePostgresContract(options.contract);
  let binding = resolveOptionalPostgresBinding(options);

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
  const {
    sql,
    raw: rawSqlTag,
    enums,
    nativeEnums,
    toSql,
  } = buildPostgresStaticContext<TContract>(contract, context, stack);

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closePromise: Promise<void> | undefined;

  const closedError = () =>
    postgresError('DRIVER.NOT_CONNECTED', 'Postgres client is closed', {
      why: 'close() was called on this client.',
      fix: 'Create a new postgres(...) client.',
      meta: { extension: 'postgres' },
    });

  const connectDriver = async (resolvedBinding: PostgresBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new InternalError('Postgres runtime driver missing');
    if (connectPromise) return connectPromise;
    const runtimeBinding = toRuntimeBinding(resolvedBinding, options);
    connectPromise = runtimeDriver
      .connect(runtimeBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch(async (err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        if (runtimeBinding.kind === 'pgPool' && runtimeBinding.ownedByDriver) {
          await runtimeBinding.pool.end().catch(() => undefined);
        }
        throw err;
      });
    return connectPromise;
  };

  const getRuntime = (): Runtime => {
    if (closePromise !== undefined) {
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

    const driver = driverDescriptor.create({
      cursor: toDriverCursorOptions(cursor),
    });
    runtimeDriver = driver;
    // A client is shared by many callers, so its runtime stops admitting work when close() is called.
    const runtime = new PostgresRuntimeImpl({
      context,
      adapter,
      driver,
      ...toRuntimeOptions(options),
      closeRefusal: 'at-once',
    });
    runtimeInstance = runtime;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    return runtime;
  };

  // Once connected, the runtime's close starts in the same call as close(), so the runtime's idle wait is measured from the caller's close().
  // The runtime closes its driver, which ends only a pool it owns; a pool or client the caller
  // passed in stays open.
  const closeRuntime = async (): Promise<void> => {
    if (!driverConnected) {
      await connectPromise?.catch(() => undefined);
    }
    await runtimeInstance?.close();
  };

  const runtimeBoundMembers = buildPostgresRuntimeBoundMembers<TContract, TCollections>({
    context,
    collections: options.collections,
    sql,
    raw: rawSqlTag,
    enums,
    nativeEnums,
    toSql,
    getRuntime,
    getRuntimeForWork: getRuntime,
  });

  return {
    sql,
    ...runtimeBoundMembers,
    enums,
    nativeEnums,
    raw: rawSqlTag,
    toSql,
    context,
    contract,
    stack,

    async connect(bindingInput) {
      if (closePromise !== undefined) {
        throw closedError();
      }

      if (driverConnected || connectPromise) {
        if (bindingInput !== undefined) {
          throw postgresError('DRIVER.ALREADY_CONNECTED', 'Postgres client is already bound', {
            why: 'connect() was given options after the client was bound to a database.',
            fix: 'Call connect() without options, or create a new client for another database.',
            meta: { extension: 'postgres' },
          });
        }
        const runtime = getRuntime();
        await connectPromise;
        if (closePromise !== undefined) throw closedError();
        return runtime;
      }

      if (bindingInput !== undefined) {
        binding = resolvePostgresBinding(bindingInput);
      }

      if (binding === undefined) {
        throw postgresError(
          'RUNTIME.BINDING_MISSING',
          'Postgres binding not configured. Pass url/pg/binding to postgres(...) or call db.connect({ ... }).',
          { meta: { extension: 'postgres' } },
        );
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      await connectDriver(binding);
      if (closePromise !== undefined) throw closedError();
      return runtime;
    },

    close(): Promise<void> {
      closePromise ??= closeRuntime();
      return closePromise;
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
