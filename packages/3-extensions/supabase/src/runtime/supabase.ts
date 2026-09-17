import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriver, { suppressIdleConnectionErrors } from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import {
  buildNamespacedNativeEnums,
  isPgPool,
  type NamespacedNativeEnums,
} from '@internal/postgres/runtime';
import { createRawLane, sql } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import type { SqlStatementStats, SqlTransactionOptions } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  ExecutionContext,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  withTransaction,
} from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { createRemoteJWKSet, decodeProtectedHeader, type JWTVerifyResult, jwtVerify } from 'jose';
import type { Client } from 'pg';
import { Pool } from 'pg';
import extensionContractJson from '../contract/contract.json' with { type: 'json' };
import { isSupabaseRole, SUPABASE_JWT_ROLE_CLAIM, SupabaseRole } from '../contract/roles';
import { supabaseRuntimeDescriptor } from './descriptor';
import type { SupabaseExtensionContract } from './ext-contract-type';
import { supabaseError } from './supabase-errors';
import type { SupabaseRoleBinding, SupabaseRuntime } from './supabase-runtime';
import { SupabaseRuntimeImpl } from './supabase-runtime';

export type SupabaseTargetId = 'postgres';

type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof orm<TContract>>;

type KeyMaterial =
  | { readonly kind: 'secret'; readonly key: Uint8Array }
  | { readonly kind: 'jwks'; readonly keyset: ReturnType<typeof createRemoteJWKSet> };

export interface RoleBoundDb<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly raw: RawLane<TContract>;
  query<Row>(
    plan: (SqlExecutionPlan<Row> | SqlQueryPlan<Row>) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  execute(
    plan: SqlExecutionPlan | SqlQueryPlan,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats>;
  transaction<R>(
    fn: (tx: TransactionContext) => PromiseLike<R>,
    options?: SqlTransactionOptions,
  ): Promise<R>;
}

/**
 * Query surface for the Supabase-internal contract (`auth`, `storage`). Exposed
 * as a separate secondary root — never merged into the app contract — and only
 * reachable through `service_role`, the one role with grants on those schemas
 * over a direct Postgres connection.
 *
 * Deliberately omits `transaction` (which {@link RoleBoundDb} has): the primary
 * app root and this secondary root are served by separate runtimes that do not
 * share one pinned connection, so a transaction spanning both is out of scope for v1.
 */
export interface SupabaseInternalDb {
  readonly sql: Db<SupabaseExtensionContract>;
  readonly orm: OrmClient<SupabaseExtensionContract>;
  readonly nativeEnums: NamespacedNativeEnums<SupabaseExtensionContract>;
  query<Row>(
    plan: (SqlExecutionPlan<Row> | SqlQueryPlan<Row>) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  execute(
    plan: SqlExecutionPlan | SqlQueryPlan,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats>;
}

/**
 * The `service_role` db: the app-contract role-bound surface (its `.sql` / `.orm`
 * are app-only, exactly like `asUser` / `asAnon`), plus a `.supabase` secondary
 * root for the Supabase-internal namespaces.
 */
export type ServiceRoleDb<TContract extends Contract<SqlStorage>> = RoleBoundDb<TContract> & {
  readonly supabase: SupabaseInternalDb;
};

export interface SupabaseDb<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<SupabaseTargetId>;
  asUser(jwt: string): Promise<RoleBoundDb<TContract>>;
  asAnon(): RoleBoundDb<TContract>;
  asServiceRole(): ServiceRoleDb<TContract>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface SupabaseOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SupabaseTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface SupabaseBindingOptions {
  readonly url?: string;
  readonly pg?: Pool | Client;
}

type JwtSecretOption = {
  readonly jwtSecret: string;
  readonly jwksUrl?: never;
};

type JwksUrlOption = {
  readonly jwksUrl: string;
  readonly jwtSecret?: never;
};

export type SupabaseOptionsWithContract<TContract extends Contract<SqlStorage>> =
  SupabaseBindingOptions &
    SupabaseOptionsBase &
    (JwtSecretOption | JwksUrlOption) & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type SupabaseOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  SupabaseBindingOptions &
    SupabaseOptionsBase &
    (JwtSecretOption | JwksUrlOption) & {
      readonly contractJson: unknown;
      readonly contract?: never;
      readonly _contract?: TContract;
    };

export type SupabaseOptions<TContract extends Contract<SqlStorage>> =
  | SupabaseOptionsWithContract<TContract>
  | SupabaseOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): options is SupabaseOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new PostgresContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): TContract {
  const contractJson = hasContractJson(options)
    ? options.contractJson
    : contractSerializer.serializeContract(options.contract);
  return blindCast<
    TContract,
    'contractSerializer.deserializeContract returns a validated TContract'
  >(contractSerializer.deserializeContract(contractJson));
}

function resolveKeyMaterial<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): KeyMaterial {
  const jwtSecret = 'jwtSecret' in options ? options.jwtSecret : undefined;
  const jwksUrl = 'jwksUrl' in options ? options.jwksUrl : undefined;

  if (jwtSecret !== undefined && jwksUrl !== undefined) {
    throw supabaseError(
      'SUPABASE.CONFIG_INVALID',
      'Provide either jwtSecret or jwksUrl, not both',
      {
        meta: { reason: 'both jwtSecret and jwksUrl provided' },
      },
    );
  }

  if (jwtSecret !== undefined) {
    return { kind: 'secret', key: new TextEncoder().encode(jwtSecret) };
  }

  if (jwksUrl !== undefined) {
    return { kind: 'jwks', keyset: createRemoteJWKSet(new URL(jwksUrl)) };
  }

  throw supabaseError('SUPABASE.CONFIG_INVALID', 'Either jwtSecret or jwksUrl is required', {
    meta: { reason: 'neither jwtSecret nor jwksUrl provided' },
  });
}

/**
 * Pre-verification check that the token's signing algorithm can possibly
 * match the configured key material. Without it the mismatch surfaces as a
 * jose internal ("Key for the ES256 algorithm must be one of type
 * CryptoKey... Received an instance of Uint8Array") that never names the
 * actual problem: current Supabase projects sign ES256 via JWKS by default,
 * while `supabase status` still prints a JWT_SECRET that only fits legacy
 * HS256 projects. Returns `undefined` when the pairing is plausible or the
 * header is unreadable (jwtVerify then produces the canonical error).
 */
function algKeyMismatchReason(jwt: string, kind: KeyMaterial['kind']): string | undefined {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(jwt).alg;
  } catch {
    return undefined;
  }
  if (alg === undefined) return undefined;
  const asymmetric = /^(?:ES|RS|PS)\d{3}$/.test(alg) || alg === 'EdDSA' || alg === 'Ed25519';
  if (kind === 'secret' && asymmetric) {
    return (
      `token is signed with ${alg} but this client is configured with jwtSecret (HS256). ` +
      'Current Supabase projects sign with asymmetric keys by default — configure ' +
      'jwksUrl (https://<project>/auth/v1/.well-known/jwks.json) instead of jwtSecret.'
    );
  }
  if (kind === 'jwks' && alg.startsWith('HS')) {
    return (
      `token is signed with ${alg} (a symmetric algorithm) but this client is configured ` +
      'with jwksUrl. A legacy HS256 Supabase project needs jwtSecret (the JWT_SECRET from ' +
      '`supabase status`) instead of jwksUrl.'
    );
  }
  return undefined;
}

function toPool<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): { pool: Pool; owned: boolean } | undefined {
  if (options.pg !== undefined && isPgPool(options.pg)) {
    return { pool: options.pg, owned: false };
  }
  if (typeof options.url === 'string') {
    return {
      pool: suppressIdleConnectionErrors(
        new Pool({
          connectionString: options.url,
          connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
          idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
        }),
      ),
      owned: true,
    };
  }
  return undefined;
}

function withSupabaseDescriptor(
  extensions: readonly SqlRuntimeExtensionDescriptor<SupabaseTargetId>[] | undefined,
): readonly SqlRuntimeExtensionDescriptor<SupabaseTargetId>[] {
  const packs = extensions ?? [];
  return packs.some((pack) => pack.id === supabaseRuntimeDescriptor.id)
    ? packs
    : [...packs, supabaseRuntimeDescriptor];
}

/**
 * Deserializes the Supabase extension's own emitted contract into a runtime
 * contract: namespaces hydrate into `PostgresSchema` instances (with
 * `qualifyTable`), and `typeRef` columns (`Timestamptz`, `Uuid`) resolve
 * through the codec registry. Exposed only via `service_role`'s `.supabase`
 * secondary root — never merged into the app contract.
 */
function buildExtensionContract(): SupabaseExtensionContract {
  return blindCast<
    SupabaseExtensionContract,
    'deserializeContract hydrates JSON namespaces into PostgresSchema instances with qualifyTable'
  >(contractSerializer.deserializeContract(extensionContractJson));
}

export default async function supabase<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptionsWithContract<TContract>,
): Promise<SupabaseDb<TContract>>;
export default async function supabase<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptionsWithContractJson<TContract>,
): Promise<SupabaseDb<TContract>>;
export default async function supabase<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): Promise<SupabaseDb<TContract>> {
  const keyMaterial = resolveKeyMaterial(options);
  const contract = resolveContract(options);

  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: withSupabaseDescriptor(options.extensions),
  });

  const context = createExecutionContext({ contract, stack });
  const rawCodecInferer = stack.adapter.rawCodecInferer;

  const poolEntry = toPool(options);
  let closed = false;

  const stackInstance = instantiateExecutionStack(stack);
  const driverDescriptor = stack.driver;
  if (!driverDescriptor) {
    throw new InternalError('Driver descriptor missing from execution stack');
  }
  const driver = driverDescriptor.create({ cursor: { disabled: true } });

  if (poolEntry) {
    await driver.connect({ kind: 'pgPool', pool: poolEntry.pool });
  }

  const runtime: SupabaseRuntime & SupabaseRuntimeImpl<TContract> = new SupabaseRuntimeImpl({
    context,
    adapter: stackInstance.adapter,
    driver,
    ...ifDefined('verifyMarker', options.verifyMarker),
    ...ifDefined('middleware', options.middleware),
  });

  async function verifyJwt(jwt: string): Promise<JWTVerifyResult> {
    const mismatch = algKeyMismatchReason(jwt, keyMaterial.kind);
    if (mismatch !== undefined) {
      throw supabaseError('SUPABASE.JWT_INVALID', `Invalid JWT: ${mismatch}`, {
        meta: { reason: mismatch },
      });
    }
    try {
      if (keyMaterial.kind === 'secret') {
        return await jwtVerify(jwt, keyMaterial.key);
      }
      return await jwtVerify(jwt, keyMaterial.keyset);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw supabaseError('SUPABASE.JWT_INVALID', `Invalid JWT: ${reason}`, {
        meta: { reason },
        cause: err,
      });
    }
  }

  function buildRoleBoundDbWithContext<C extends Contract<SqlStorage>>(
    binding: SupabaseRoleBinding,
    roleContext: ExecutionContext<C>,
    roleRuntime: SupabaseRuntime & SupabaseRuntimeImpl<C>,
  ): RoleBoundDb<C> {
    const roleSql: Db<C> = sql<C>({ context: roleContext, rawCodecInferer });
    const roleRaw: RawLane<C> = createRawLane<C>({ context: roleContext, rawCodecInferer });
    const roleOrm: OrmClient<C> = orm({
      runtime: {
        query(plan) {
          return roleRuntime.queryWithRole(plan, binding);
        },
        execute(plan) {
          return roleRuntime.executeWithRole(plan, binding);
        },
        connection: () => roleRuntime.openRoleSession(binding),
      },
      context: roleContext,
    });

    return {
      sql: roleSql,
      orm: roleOrm,
      raw: roleRaw,
      query<Row>(
        plan: (SqlExecutionPlan<Row> | SqlQueryPlan<Row>) & { readonly _row?: Row },
        execOptions?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return roleRuntime.queryWithRole<Row>(plan, binding, execOptions);
      },
      execute(
        plan: SqlExecutionPlan | SqlQueryPlan,
        execOptions?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        return roleRuntime.executeWithRole(plan, binding, execOptions);
      },
      transaction<R>(
        fn: (tx: TransactionContext) => PromiseLike<R>,
        options?: SqlTransactionOptions,
      ): Promise<R> {
        return withTransaction(
          { connection: () => roleRuntime.openRoleSession(binding) },
          fn,
          options,
        );
      },
    };
  }

  function buildRoleBoundDb(binding: SupabaseRoleBinding): RoleBoundDb<TContract> {
    return buildRoleBoundDbWithContext(binding, context, runtime);
  }

  const serviceRoleBinding: SupabaseRoleBinding = {
    role: SupabaseRole.members.ServiceRole,
    claims: {},
  };

  // The Supabase-internal contract (auth/storage) as a separate secondary root.
  // It is contract-bound: a plan built against it carries the extension's
  // storageHash, so it must run on a runtime bound to the extension contract —
  // the app runtime would reject it (PLAN.HASH_MISMATCH). This runtime shares
  // the same driver (one pool, no second connection) and disables marker
  // verification: the extension contract is external and owns no app-space
  // marker, so its hashes must not be checked against the DB marker.
  const extContract = buildExtensionContract();
  const extContext = createExecutionContext({ contract: extContract, stack });
  const extRuntime: SupabaseRuntime & SupabaseRuntimeImpl<SupabaseExtensionContract> =
    new SupabaseRuntimeImpl({
      context: extContext,
      adapter: stackInstance.adapter,
      driver,
      verifyMarker: false,
      ...ifDefined('middleware', options.middleware),
    });

  const extNativeEnums = blindCast<
    NamespacedNativeEnums<SupabaseExtensionContract>,
    'buildNamespacedNativeEnums returns the namespace-keyed accessor map this contract types'
  >(Object.freeze(buildNamespacedNativeEnums(extContract.storage)));

  const supabaseInternal: SupabaseInternalDb = {
    sql: sql<SupabaseExtensionContract>({ context: extContext, rawCodecInferer }),
    orm: orm({
      runtime: {
        query(plan) {
          return extRuntime.queryWithRole(plan, serviceRoleBinding);
        },
        execute(plan) {
          return extRuntime.executeWithRole(plan, serviceRoleBinding);
        },
        connection: () => extRuntime.openRoleSession(serviceRoleBinding),
      },
      context: extContext,
    }),
    nativeEnums: extNativeEnums,
    query<Row>(
      plan: (SqlExecutionPlan<Row> | SqlQueryPlan<Row>) & { readonly _row?: Row },
      execOptions?: RuntimeExecuteOptions,
    ): AsyncIterableResult<Row> {
      return extRuntime.queryWithRole<Row>(plan, serviceRoleBinding, execOptions);
    },
    execute(
      plan: SqlExecutionPlan | SqlQueryPlan,
      execOptions?: RuntimeExecuteOptions,
    ): Promise<SqlStatementStats> {
      return extRuntime.executeWithRole(plan, serviceRoleBinding, execOptions);
    },
  };

  async function closeDb(): Promise<void> {
    if (closed) return;
    closed = true;
    await runtime.close();
    if (poolEntry?.owned) {
      await poolEntry.pool.end().catch(() => undefined);
    }
  }

  return {
    context,
    stack,

    async asUser(jwt: string): Promise<RoleBoundDb<TContract>> {
      const { payload } = await verifyJwt(jwt);
      const rawRole = payload[SUPABASE_JWT_ROLE_CLAIM];
      const roleStr = typeof rawRole === 'string' ? rawRole : SupabaseRole.members.Authenticated;
      const role: SupabaseRoleBinding['role'] = isSupabaseRole(roleStr)
        ? roleStr
        : SupabaseRole.members.Authenticated;
      const binding: SupabaseRoleBinding = { role, claims: payload };
      return buildRoleBoundDb(binding);
    },

    asAnon(): RoleBoundDb<TContract> {
      return buildRoleBoundDb({ role: SupabaseRole.members.Anon, claims: {} });
    },

    asServiceRole(): ServiceRoleDb<TContract> {
      const roleBound = buildRoleBoundDbWithContext(serviceRoleBinding, context, runtime);
      return { ...roleBound, supabase: supabaseInternal };
    },

    close: closeDb,
    [Symbol.asyncDispose]: closeDb,
  };
}
