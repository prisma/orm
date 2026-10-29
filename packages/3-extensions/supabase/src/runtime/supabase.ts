import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import postgresDriver, {
  createPgPool,
  suppressIdleConnectionErrors,
} from '@internal/driver-postgres/runtime';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import { buildPostgresStaticContext } from '@internal/postgres/internal/static-context';
import { buildPostgresQueryMembers } from '@internal/postgres/internal/transaction-members';
import { validatePostgresContract } from '@internal/postgres/internal/validate-contract';
import {
  isPgPool,
  type NamespacedNativeEnums,
  type PostgresQueryMembers,
  type PostgresTransactionContext,
} from '@internal/postgres/runtime';
import type { Db } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type CollectionClasses,
  checkCollectionClasses,
  type NoCollectionClasses,
  orm,
  prepareQuery,
} from '@internal/sql-orm-client';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  ExecutionContext,
  Log,
  RuntimeMode,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  ToSqlMember,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import {
  activitySource,
  createExecutionContext,
  createSqlExecutionStack,
  delegatingRuntime,
  withTransaction,
  withTransactionMembers,
} from '@internal/sql-runtime';
import {
  type PreparedStatementExecuteTarget,
  type PreparedStatementQueryTarget,
  preparedStatementExecute,
  preparedStatementQuery,
} from '@internal/sql-runtime/internal/prepared-query';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import { createRemoteJWKSet, decodeProtectedHeader, type JWTVerifyResult, jwtVerify } from 'jose';
import type { Pool } from 'pg';
import extensionContractJson from '../contract/contract.json' with { type: 'json' };
import { isSupabaseRole, SUPABASE_JWT_ROLE_CLAIM, SupabaseRole } from '../contract/roles';
import { supabaseRuntimeDescriptor } from './descriptor';
import type { SupabaseExtensionContract } from './ext-contract-type';
import { supabaseError } from './supabase-errors';
import type { SupabaseRoleBinding } from './supabase-runtime';
import { roleScope, SupabaseRuntimeImpl } from './supabase-runtime';

export type SupabaseTargetId = 'postgres';

type OrmClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = ReturnType<typeof orm<TContract, TCollections>>;

type KeyMaterial =
  | { readonly kind: 'secret'; readonly key: Uint8Array }
  | { readonly kind: 'jwks'; readonly keyset: ReturnType<typeof createRemoteJWKSet> };

export interface RoleBoundDb<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> extends PostgresQueryMembers<TContract, TCollections>,
    PreparedStatementQueryTarget,
    PreparedStatementExecuteTarget {
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  transaction<R>(
    fn: (tx: SupabaseTransactionContext<TContract, TCollections>) => PromiseLike<R>,
  ): Promise<R>;
}

/** A transaction on a role-bound client: the members of a Postgres transaction, run under the bound role. */
export type SupabaseTransactionContext<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = PostgresTransactionContext<TContract, TCollections>;

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
export interface SupabaseInternalDb extends ToSqlMember {
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
export type ServiceRoleDb<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = RoleBoundDb<TContract, TCollections> & {
  readonly supabase: SupabaseInternalDb;
};

export interface SupabaseDb<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> {
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<SupabaseTargetId>;
  asUser(jwt: string): Promise<RoleBoundDb<TContract, TCollections>>;
  asAnon(): RoleBoundDb<TContract, TCollections>;
  asServiceRole(): ServiceRoleDb<TContract, TCollections>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface SupabaseOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SupabaseTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly log?: Log;
  readonly mode?: RuntimeMode;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface SupabaseBindingOptions {
  readonly url?: string;
  readonly pg?: Pool;
}

type JwtSecretOption = {
  readonly jwtSecret: string;
  readonly jwksUrl?: never;
};

type JwksUrlOption = {
  readonly jwksUrl: string;
  readonly jwtSecret?: never;
};

export type SupabaseOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = SupabaseBindingOptions &
  SupabaseOptionsBase &
  (JwtSecretOption | JwksUrlOption) & {
    readonly contract: TContract;
    readonly collections?: TCollections;
  };

const contractSerializer = new PostgresContractSerializer();

interface SupabaseRuntimes<TContract extends Contract<SqlStorage>> {
  readonly runtime: SupabaseRuntimeImpl<TContract>;
  readonly extRuntime: SupabaseRuntimeImpl<SupabaseExtensionContract>;
  readonly driver: { close(): Promise<void> };
  readonly poolBinding: PoolBinding | undefined;
}

type PoolBinding = {
  readonly kind: 'pgPool';
  readonly pool: Pool;
  readonly ownedByDriver: boolean;
};

function closedClientError() {
  return structuredError('DRIVER.NOT_CONNECTED', 'Runtime is closed', {
    why: 'close() was called on this client.',
    fix: 'Create a new supabase(...) client.',
    meta: { extension: 'supabase' },
  });
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

function checkPgOption(pg: Pool | undefined): void {
  if (pg === undefined || (typeof pg === 'object' && pg !== null && isPgPool(pg))) return;
  throw supabaseError('SUPABASE.CONFIG_INVALID', 'The pg option takes a pg.Pool', {
    why: 'Each role-bound query needs a connection of its own, which a single pg.Client cannot give.',
    fix: 'Pass a pg.Pool as pg, or pass url.',
    meta: { reason: 'pg is not a pg.Pool' },
  });
}

function toPoolBinding<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): PoolBinding | undefined {
  if (options.pg !== undefined && isPgPool(options.pg)) {
    return { kind: 'pgPool', pool: options.pg, ownedByDriver: false };
  }
  if (typeof options.url === 'string') {
    return {
      kind: 'pgPool',
      pool: suppressIdleConnectionErrors(
        createPgPool(
          {
            connectionString: options.url,
            connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
            idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
          },
          postgresTarget.sessionSettings ?? {},
        ),
      ),
      ownedByDriver: true,
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
 * `qualifyTable`), and each column resolves its codec through the codec
 * registry. Exposed only via `service_role`'s `.supabase`
 * secondary root — never merged into the app contract.
 */
function buildExtensionContract(): SupabaseExtensionContract {
  return blindCast<
    SupabaseExtensionContract,
    'deserializeContract hydrates JSON namespaces into PostgresSchema instances with qualifyTable'
  >(contractSerializer.deserializeContract(extensionContractJson));
}

/**
 * Creates a Supabase client whose queries run as the role a JWT names. The client infers its
 * contract type from `contract`: a value from `contractFromJson` of `@prisma/orm-postgres/static`
 * for an emitted contract, or a TypeScript-authored contract. A contract is validated once, however
 * many clients are built from it. The pool is created on the first query.
 *
 * @example
 * ```ts
 * import { contractFromJson } from '@prisma/orm-postgres/static';
 * import { supabase } from '@prisma/orm-extension-supabase/runtime';
 * import type { Contract } from './contract.d';
 * import contractJson from './contract.json' with { type: 'json' };
 *
 * export const contract = contractFromJson<Contract>(contractJson);
 * export const db = await supabase({ contract, url, jwtSecret });
 * ```
 */
export default async function supabase<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
>(options: SupabaseOptions<TContract, TCollections>): Promise<SupabaseDb<TContract, TCollections>> {
  const keyMaterial = resolveKeyMaterial(options);
  checkPgOption(options.pg);
  const contract = validatePostgresContract(options.contract);

  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: withSupabaseDescriptor(options.extensions),
  });

  const context = createExecutionContext({ contract, stack });

  checkCollectionClasses(contract, options.collections);

  const {
    sql: appSql,
    raw,
    toSql,
    enums,
    nativeEnums,
  } = buildPostgresStaticContext(contract, context, stack);

  // The Supabase-internal contract (auth/storage) as a separate secondary root.
  // It is contract-bound: a plan built against it carries the extension's
  // storageHash, so it must run on a runtime bound to the extension contract —
  // the app runtime would reject it (PLAN.HASH_MISMATCH). Its runtime shares
  // the app runtime's driver (one pool, no second connection) and disables marker
  // verification: the extension contract is external and owns no app-space
  // marker, so its hashes must not be checked against the DB marker.
  const extContract = buildExtensionContract();
  const extContext = createExecutionContext({ contract: extContract, stack });
  const extStatic = buildPostgresStaticContext(extContract, extContext, stack);

  let runtimes: SupabaseRuntimes<TContract> | undefined;
  let connectError: { readonly error: unknown } | undefined;
  let closed = false;

  function getRuntimes(): SupabaseRuntimes<TContract> {
    if (connectError !== undefined) {
      throw connectError.error;
    }
    if (runtimes !== undefined) {
      return runtimes;
    }
    if (closed) {
      throw closedClientError();
    }

    const driverDescriptor = stack.driver;
    const adapter = stack.adapter.create(stack);
    const driver = driverDescriptor.create({ cursor: { disabled: true } });
    const sharedOptions = {
      adapter,
      driver,
      ...ifDefined('middleware', options.middleware),
      ...ifDefined('log', options.log),
      ...ifDefined('mode', options.mode),
      closeRefusal: 'at-once',
      ownsDriver: false,
    } as const;
    const runtime = new SupabaseRuntimeImpl({
      context,
      ...sharedOptions,
      ...ifDefined('verifyMarker', options.verifyMarker),
    });
    const extRuntime = new SupabaseRuntimeImpl({
      context: extContext,
      ...sharedOptions,
      verifyMarker: false,
    });

    const poolBinding = toPoolBinding(options);
    if (poolBinding) {
      driver.connect(poolBinding).catch(async (err: unknown) => {
        connectError = { error: err };
        if (poolBinding.ownedByDriver) await poolBinding.pool.end().catch(() => undefined);
      });
    }

    runtimes = { runtime, extRuntime, driver, poolBinding };
    return runtimes;
  }

  const runtime = (): SupabaseRuntimes<TContract>['runtime'] => getRuntimes().runtime;
  const extRuntime = (): SupabaseRuntimes<TContract>['extRuntime'] => getRuntimes().extRuntime;
  const workRuntime = delegatingRuntime(runtime);

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

  function buildRoleBoundDb(binding: SupabaseRoleBinding): RoleBoundDb<TContract, TCollections> {
    const role = roleScope(runtime, binding);
    const roleOrm: OrmClient<TContract, TCollections> = orm<TContract, TCollections>({
      runtime: role,
      context: context,
      ...ifDefined('collections', options.collections),
    });

    const roleBound: RoleBoundDb<TContract, TCollections> = {
      sql: appSql,
      orm: roleOrm,
      raw,
      toSql,
      enums,
      nativeEnums,
      prepare(declaration, callback) {
        return prepareQuery(workRuntime, declaration, callback);
      },
      query: role.query,
      execute: role.execute,
      [preparedStatementQuery]: role[preparedStatementQuery],
      [preparedStatementExecute]: role[preparedStatementExecute],
      transaction<R>(
        fn: (tx: SupabaseTransactionContext<TContract, TCollections>) => PromiseLike<R>,
      ): Promise<R> {
        return withTransaction(role, (txCtx) =>
          fn(
            withTransactionMembers(txCtx, {
              ...buildPostgresQueryMembers<TContract, TCollections>(
                {
                  context,
                  collections: options.collections,
                  sql: appSql,
                  raw,
                  toSql,
                  prepareRuntime: workRuntime,
                },
                txCtx,
              ),
              enums,
              nativeEnums,
            }),
          ),
        );
      },
    };
    return Object.assign(roleBound, { [activitySource]: role[activitySource] });
  }

  const serviceRoleBinding: SupabaseRoleBinding = {
    role: SupabaseRole.members.ServiceRole,
    claims: {},
  };

  const serviceRole = roleScope(extRuntime, serviceRoleBinding);

  const supabaseInternal: SupabaseInternalDb = {
    sql: extStatic.sql,
    toSql: extStatic.toSql,
    orm: orm({ runtime: serviceRole, context: extContext }),
    nativeEnums: extStatic.nativeEnums,
    query: serviceRole.query,
    execute: serviceRole.execute,
  };

  let closePromise: Promise<void> | undefined;

  // Both runtimes share one driver, so neither closes it: close both, which refuses new work on
  // both at once and waits for both, then close the driver once. The driver ends the pool only
  // when it owns it; a pool the caller passed in stays open.
  async function closeRuntimes(): Promise<void> {
    if (runtimes === undefined) return;
    const { runtime, extRuntime, driver } = runtimes;
    await Promise.all([runtime.close(), extRuntime.close()]);
    await driver.close();
  }

  function closeDb(): Promise<void> {
    closed = true;
    closePromise ??= closeRuntimes();
    return closePromise;
  }

  return {
    context,
    stack,

    async asUser(jwt: string): Promise<RoleBoundDb<TContract, TCollections>> {
      const { payload } = await verifyJwt(jwt);
      const rawRole = payload[SUPABASE_JWT_ROLE_CLAIM];
      const roleStr = typeof rawRole === 'string' ? rawRole : SupabaseRole.members.Authenticated;
      const role: SupabaseRoleBinding['role'] = isSupabaseRole(roleStr)
        ? roleStr
        : SupabaseRole.members.Authenticated;
      const binding: SupabaseRoleBinding = { role, claims: payload };
      return buildRoleBoundDb(binding);
    },

    asAnon(): RoleBoundDb<TContract, TCollections> {
      return buildRoleBoundDb({ role: SupabaseRole.members.Anon, claims: {} });
    },

    asServiceRole(): ServiceRoleDb<TContract, TCollections> {
      const roleBound = buildRoleBoundDb(serviceRoleBinding);
      return { ...roleBound, supabase: supabaseInternal };
    },

    close: closeDb,
    [Symbol.asyncDispose]: closeDb,
  };
}
