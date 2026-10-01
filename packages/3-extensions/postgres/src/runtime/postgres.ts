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
import { type Client, Pool } from 'pg';
import { postgresError } from '../errors';
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

export interface PostgresClient<TContract extends Contract<SqlStorage>>
  extends PostgresStaticMembers<TContract>,
    PostgresRuntimeBoundMembers<TContract>,
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

export type PostgresOptionsWithContract<TContract extends Contract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type PostgresOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase & {
      readonly contractJson: unknown;
      readonly contract?: never;
      readonly _contract?: TContract;
    };

export type PostgresOptions<TContract extends Contract<SqlStorage>> =
  | PostgresOptionsWithContract<TContract>
  | PostgresOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): options is PostgresOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new PostgresContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): TContract {
  const contractJson = hasContractJson(options)
    ? options.contractJson
    : contractSerializer.serializeContract(options.contract);
  return blindCast<
    TContract,
    'validated contract JSON corresponds to the caller supplied contract type'
  >(contractSerializer.deserializeContract(contractJson));
}

function toRuntimeBinding<TContract extends Contract<SqlStorage>>(
  binding: PostgresBinding,
  options: PostgresOptions<TContract>,
) {
  if (binding.kind !== 'url') {
    return binding;
  }

  return {
    kind: 'pgPool',
    pool: suppressIdleConnectionErrors(
      new Pool({
        connectionString: binding.url,
        connectionTimeoutMillis:
          options.poolOptions?.connectionTimeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MILLIS,
        idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
      }),
    ),
  } as const;
}

/**
 * Creates a lazy Postgres client from either `contractJson` or a TypeScript-authored `contract`.
 * Static query surfaces are available immediately, while `runtime()` instantiates the driver/pool on first call.
 *
 * - No-emit: pass a TypeScript-authored contract. Example: postgres({ contract })
 * - Emitted: pass Contract type explicitly. Example: postgres<Contract>({ contractJson, url })
 */
export default function postgres<TContract extends Contract<SqlStorage>>(
  options: PostgresOptionsWithContract<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends Contract<SqlStorage>>(
  options: PostgresOptionsWithContractJson<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): PostgresClient<TContract> {
  const cursor = validateCursorOptions(options.cursor, 'postgres');
  const contract = resolveContract(options);
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
  } = buildPostgresStaticContext<TContract>(context, stack.adapter.rawCodecInferer);

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closePromise: Promise<void> | undefined;
  // True once the driver holds a pool this client created. close() then closes the runtime, which
  // ends that pool; a pool or client the caller passed in stays open, and so does the runtime.
  let ownsPool = false;

  const connectDriver = async (resolvedBinding: PostgresBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new InternalError('Postgres runtime driver missing');
    if (connectPromise) return connectPromise;
    const runtimeBinding = toRuntimeBinding(resolvedBinding, options);
    const ownedPool =
      resolvedBinding.kind === 'url' && runtimeBinding.kind === 'pgPool'
        ? runtimeBinding.pool
        : undefined;
    connectPromise = runtimeDriver
      .connect(runtimeBinding)
      .then(() => {
        driverConnected = true;
        ownsPool = ownedPool !== undefined;
      })
      .catch(async (err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        await ownedPool?.end().catch(() => undefined);
        throw err;
      });
    return connectPromise;
  };

  const getRuntime = (): Runtime => {
    if (closePromise !== undefined) {
      throw postgresError('DRIVER.NOT_CONNECTED', 'Postgres client is closed', {
        why: 'close() was called on this client.',
        fix: 'Create a new postgres(...) client.',
        meta: { extension: 'postgres' },
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

    const driver = driverDescriptor.create({
      cursor: toDriverCursorOptions(cursor),
    });
    runtimeDriver = driver;
    // A client is shared by many callers, so its runtime stops admitting work when close() is called.
    const runtime = new PostgresRuntimeImpl({
      context,
      adapter: stackInstance.adapter,
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
  const closeOwnedRuntime = async (): Promise<void> => {
    if (!driverConnected) {
      await connectPromise?.catch(() => undefined);
    }
    if (ownsPool) {
      await runtimeInstance?.close();
    }
  };

  const runtimeBoundMembers = buildPostgresRuntimeBoundMembers<TContract>({
    context,
    rawCodecInferer: stack.adapter.rawCodecInferer,
    enums,
    nativeEnums,
    getRuntime,
    getRuntimeForWork: getRuntime,
  });

  return {
    sql,
    ...runtimeBoundMembers,
    enums,
    nativeEnums,
    raw: rawSqlTag,
    context,
    contract,
    stack,

    async connect(bindingInput) {
      if (closePromise !== undefined) {
        throw postgresError('DRIVER.NOT_CONNECTED', 'Postgres client is closed', {
          why: 'close() was called on this client.',
          fix: 'Create a new postgres(...) client.',
          meta: { extension: 'postgres' },
        });
      }

      if (driverConnected || connectPromise) {
        throw postgresError('DRIVER.ALREADY_CONNECTED', 'Postgres client already connected', {
          fix: 'Call connect() at most once per client.',
          meta: { extension: 'postgres' },
        });
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
      return runtime;
    },

    close(): Promise<void> {
      closePromise ??= closeOwnedRuntime();
      return closePromise;
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
