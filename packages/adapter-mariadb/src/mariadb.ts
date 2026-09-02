import type {
  ConnectionInfo,
  IsolationLevel,
  SqlDriverAdapter,
  SqlDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
} from '@prisma/driver-adapter-utils'
import { Debug, DriverAdapterError } from '@prisma/driver-adapter-utils'
import * as mariadb from 'mariadb'

import { name as packageName } from '../package.json'
import { mapArg, mapColumnType, mapRow, typeCast } from './conversion'
import { convertDriverError } from './errors'

const debug = Debug('prisma:driver-adapter:mariadb')

class MariaDbQueryable<Connection extends mariadb.Pool | mariadb.Connection> implements SqlQueryable {
  readonly provider = 'mysql'
  readonly adapterName = packageName

  constructor(
    protected readonly client: Connection,
    protected readonly mariadbOptions?: { useTextProtocol?: boolean },
  ) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::query_raw]'
    debug(`${tag} %O`, query)

    const result = await this.performIO(query)
    return {
      columnNames: result.meta?.map((field) => field.name()) ?? [],
      columnTypes: result.meta?.map(mapColumnType) ?? [],
      rows: Array.isArray(result) ? result.map((row) => mapRow(row, result.meta)) : [],
      lastInsertId: result.insertId?.toString(),
    }
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const tag = '[js::execute_raw]'
    debug(`${tag} %O`, query)

    return (await this.performIO(query)).affectedRows ?? 0
  }

  protected async performIO(query: SqlQuery): Promise<ArrayModeResult> {
    const { sql, args } = query

    try {
      const req = {
        sql,
        rowsAsArray: true,
        dateStrings: true,
        // Disable automatic conversion of JSON blobs to objects.
        autoJsonMap: false,
        // Return JSON strings as strings, not objects.
        // Available in the driver, but not provided in the typings.
        jsonStrings: true,
        // Disable automatic conversion of BIT(1) to boolean.
        // Available in the driver, but not provided in the typings.
        bitOneIsBoolean: false,
        typeCast,
      }
      const values = args.map((arg, i) => mapArg(arg, query.argTypes[i]))
      const execute = this.mariadbOptions?.useTextProtocol
        ? this.client.query.bind(this.client)
        : this.client.execute.bind(this.client)
      return await execute(req, values)
    } catch (e) {
      const error = e as Error
      this.onError(error)
    }
  }

  protected onError(error: unknown): never {
    debug('Error in performIO: %O', error)
    throw new DriverAdapterError(convertDriverError(error))
  }
}

// All transaction operations use `client.query` instead of `client.execute` to avoid using the
// binary protocol, which does not support transactions in the MariaDB driver.
class MariaDbTransaction extends MariaDbQueryable<mariadb.Connection> implements Transaction {
  constructor(
    readonly conn: mariadb.Connection,
    mariadbOptions: PrismaMariadbOptions | undefined,
    readonly options: TransactionOptions,
    protected readonly cleanup?: () => void,
  ) {
    super(conn, mariadbOptions)
  }

  async commit(): Promise<void> {
    debug(`[js::commit]`)

    try {
      await this.client.query({ sql: 'COMMIT' })
    } catch (err) {
      this.onError(err)
    } finally {
      this.cleanup?.()
      await releaseConnection(this.client)
    }
  }

  async rollback(): Promise<void> {
    debug(`[js::rollback]`)

    try {
      await this.client.query({ sql: 'ROLLBACK' })
    } catch (err) {
      this.onError(err)
    } finally {
      this.cleanup?.()
      await releaseConnection(this.client)
    }
  }

  async createSavepoint(name: string): Promise<void> {
    await this.client.query({ sql: `SAVEPOINT ${name}` }).catch(this.onError.bind(this))
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.client.query({ sql: `ROLLBACK TO ${name}` }).catch(this.onError.bind(this))
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.client.query({ sql: `RELEASE SAVEPOINT ${name}` }).catch(this.onError.bind(this))
  }
}

export type PrismaMariadbOptions = {
  /** The name of the database to use in generated queries */
  database?: string
  /** Use the driver's text protocol (`query`) instead of the binary protocol (`execute`). */
  useTextProtocol?: boolean
  /** Callback attached to transaction connection `error` events. */
  onConnectionError?: (err: mariadb.SqlError) => void
  /**
   * Whether to call `pool.end()` on an externally provided pool when the adapter is disposed.
   * Defaults to `false`.
   */
  disposeExternalPool?: boolean
}

export type Capabilities = {
  supportsRelationJoins: boolean
}

export class PrismaMariaDbAdapter extends MariaDbQueryable<mariadb.Pool> implements SqlDriverAdapter {
  constructor(
    client: mariadb.Pool,
    private readonly capabilities: Capabilities,
    protected readonly mariadbOptions?: PrismaMariadbOptions,
    private readonly release?: () => Promise<void>,
  ) {
    super(client, mariadbOptions)
  }

  executeScript(_script: string): Promise<void> {
    throw new Error('Not implemented yet')
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      schemaName: this.mariadbOptions?.database,
      supportsRelationJoins: this.capabilities.supportsRelationJoins,
    }
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    const options: TransactionOptions = {
      usePhantomQuery: true,
    }

    const tag = '[js::startTransaction]'
    debug('%s options: %O', tag, options)

    const conn = await this.client.getConnection().catch((error) => this.onError(error))
    const onError = (err: mariadb.SqlError) => {
      debug(`Error from connection: ${err.message} %O`, err)
      this.mariadbOptions?.onConnectionError?.(err)
    }
    conn.on('error', onError)

    const cleanup = () => {
      conn.off('error', onError)
    }

    try {
      const tx = new MariaDbTransaction(conn, this.mariadbOptions, options, cleanup)
      if (isolationLevel) {
        await tx.executeRaw({
          sql: `SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`,
          args: [],
          argTypes: [],
        })
      }
      // Uses `query` instead of `execute` to avoid the binary protocol.
      await tx.conn.query({ sql: 'BEGIN' }).catch(this.onError.bind(this))
      return tx
    } catch (error) {
      // Detach the error listener before releasing the connection so it is not
      // reused by the pool with our handler still attached. The release is
      // wrapped in try/finally so the connection always returns to the pool.
      try {
        cleanup()
      } finally {
        await releaseConnection(conn)
      }
      this.onError(error)
    }
  }

  async dispose(): Promise<void> {
    return this.release?.()
  }

  underlyingDriver(): mariadb.Pool {
    return this.client
  }
}

export class PrismaMariaDbAdapterFactory implements SqlDriverAdapterFactory {
  readonly provider = 'mysql'
  readonly adapterName = packageName

  #capabilities?: Capabilities
  #poolOrConfig: { type: 'pool'; pool: mariadb.Pool } | { type: 'config'; config: mariadb.PoolConfig | string }
  #options?: PrismaMariadbOptions
  #externalPoolClaimed = false

  /**
   * Accepts either connection settings for a pool the adapter creates and owns, or an existing
   * pool. Settings the adapter would normally apply to its own pool (such as defaulting
   * `prepareCacheLength` to 0 and forcing `timezone` to UTC) are not applied to an externally
   * created pool.
   */
  constructor(poolOrConfig: mariadb.Pool | mariadb.PoolConfig | string, options?: PrismaMariadbOptions) {
    this.#poolOrConfig = isPool(poolOrConfig)
      ? { type: 'pool', pool: poolOrConfig }
      : { type: 'config', config: normalizeConfig(poolOrConfig) }
    this.#options = options
  }

  async connect(): Promise<PrismaMariaDbAdapter> {
    const poolOrConfig = this.#poolOrConfig
    const ownsPool = poolOrConfig.type === 'config' || this.#options?.disposeExternalPool === true

    // The adapter ends a pool it owns, and cannot build a replacement from an external pool, so
    // at most one adapter may own a given external pool. The claim is staked before any `await`
    // so that a second `connect()` is rejected while the first adapter is still alive, and while
    // its `dispose()` is in flight or has failed.
    if (poolOrConfig.type === 'pool' && ownsPool) {
      if (this.#externalPoolClaimed) {
        throw new Error(
          'connect() can only be called once when `disposeExternalPool` is true, because the adapter ' +
            'ends the pool it was given and cannot create a replacement from it. Either pass connection ' +
            'settings instead of a pool, or set `disposeExternalPool: false` and end the pool yourself ' +
            'once you no longer need the adapter.',
        )
      }
      this.#externalPoolClaimed = true
    }

    const pool = poolOrConfig.type === 'pool' ? poolOrConfig.pool : createPool(poolOrConfig.config)

    if (this.#capabilities === undefined) {
      this.#capabilities = await getCapabilities(pool)
    }

    return new PrismaMariaDbAdapter(pool, this.#capabilities, this.#options, async () => {
      if (ownsPool) {
        await pool.end()
      }
    })
  }
}

/**
 * Checks whether the value is an existing pool rather than connection settings. The driver
 * doesn't export its pool class, so the check is structural; a `PoolConfig` has no methods.
 */
function isPool(poolOrConfig: mariadb.Pool | mariadb.PoolConfig | string): poolOrConfig is mariadb.Pool {
  return typeof poolOrConfig === 'object' && typeof (poolOrConfig as mariadb.Pool).getConnection === 'function'
}

function normalizeConfig(config: mariadb.PoolConfig | string): mariadb.PoolConfig | string {
  if (typeof config === 'string') {
    try {
      const url = new URL(config)
      if (!url.searchParams.has('prepareCacheLength')) {
        url.searchParams.set('prepareCacheLength', '0')
      }
      // Force UTC so TIMESTAMP strings the driver returns with `dateStrings: true` are in UTC,
      // which `mapRow` relies on when it appends 'Z' to treat them as UTC. A user-supplied
      // value is overridden, since a non-UTC session would silently corrupt those reads.
      // See: https://github.com/prisma/prisma/issues/29096
      url.searchParams.set('timezone', 'UTC')
      return rewriteConnectionString(url).toString()
    } catch {
      // The error is deliberately not logged: `ERR_INVALID_URL` carries the rejected string in
      // `error.input`, which would put the connection string's credentials into the debug
      // history, and `getLogs()` surfaces that history in user-facing error reports.
      debug('Failed to parse the connection string, passing it to the driver as-is')
      // If we can't parse the connection string, use it as-is and let the driver fail with
      // its own error.
      return config
    }
  }

  // `timezone` is placed after the spread so it always wins: `mapRow` treats TIMESTAMP strings
  // as UTC, so a non-UTC session would silently corrupt those reads. `prepareCacheLength`
  // defaults to 0 but keeps any user-supplied value.
  // See: https://github.com/prisma/prisma/issues/29096
  return { ...config, prepareCacheLength: config.prepareCacheLength ?? 0, timezone: 'UTC' }
}

function createPool(config: mariadb.PoolConfig | string): mariadb.Pool {
  try {
    return mariadb.createPool(config)
  } catch (error) {
    // We match on an error which is known to leak the connection string and replace it with
    // a custom error message.
    // The error might change in a future version of the driver, but this is covered in a
    // test, which checks for credential leakage regardless of the exact error message.
    if (error instanceof Error && error.message.startsWith('error parsing connection string')) {
      throw new Error(
        "error parsing connection string, format must be 'mariadb://[<user>[:<password>]@]<host>[:<port>]/[<db>[?<opt1>=<value1>[&<opt2>=<value2>]]]'",
      )
    }
    throw error
  }
}

async function getCapabilities(pool: mariadb.Pool): Promise<{ supportsRelationJoins: boolean }> {
  const tag = '[js::getCapabilities]'

  try {
    const rows = await pool.query({
      sql: `SELECT VERSION()`,
      rowsAsArray: true,
    })

    const version = rows[0][0]
    debug(`${tag} MySQL version: %s from %o`, version, rows)

    const capabilities = inferCapabilities(version)
    debug(`${tag} Inferred capabilities: %O`, capabilities)

    return capabilities
  } catch (e) {
    debug(`${tag} Error while checking capabilities: %O`, e)
    return { supportsRelationJoins: false }
  }
}

export function inferCapabilities(version: unknown): Capabilities {
  if (typeof version !== 'string') {
    return { supportsRelationJoins: false }
  }

  const [versionStr, suffix] = version.split('-')
  const [major, minor, patch] = versionStr.split('.').map((n) => parseInt(n, 10))

  // No relation-joins support for mysql < 8.0.13 or mariadb.
  const isMariaDB = suffix?.toLowerCase()?.includes('mariadb') ?? false
  const supportsRelationJoins =
    !isMariaDB && (major > 8 || (major === 8 && (minor > 0 || (minor === 0 && patch >= 13))))
  return { supportsRelationJoins }
}

/**
 * Rewrites a connection string into the form the mariadb driver's own parser accepts:
 *
 * - `mysql://` is rewritten to `mariadb://`, so that users can point the MariaDB adapter
 *   at a `mysql://` connection string.
 * - The colons of a bracketed IPv6 host are percent-encoded. The driver's connection
 *   string grammar forbids colons in the host, so `[::1]` never matches and the whole
 *   string is rejected; it does run the host through `decodeURIComponent`, so an encoded
 *   host round-trips to the correct address.
 */
export function rewriteConnectionString(url: URL): URL {
  if (url.protocol === 'mysql:') {
    url.protocol = 'mariadb:'
  }

  if (url.hostname.startsWith('[') && url.hostname.endsWith(']')) {
    url.hostname = encodeURIComponent(url.hostname.slice(1, -1))
  }

  return url
}

type ArrayModeResult = unknown[][] & { meta?: mariadb.FieldInfo[]; affectedRows?: number; insertId?: BigInt }

/**
 * Returns a pool connection back to its pool via `PoolConnection#release()`.
 * Using `end()` instead would permanently close a plain `mariadb.Connection`,
 * which breaks pool reuse and the `idleTimeout` / `minimumIdle` lifecycle.
 * Falls back to `end()` when `release` is not available (e.g. unit tests with
 * a non-pool connection).
 */
async function releaseConnection(conn: mariadb.Connection): Promise<void> {
  const poolConn = conn as mariadb.PoolConnection
  if (typeof poolConn.release === 'function') {
    await poolConn.release()
  } else {
    await conn.end()
  }
}
