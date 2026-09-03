/* eslint-disable @typescript-eslint/require-await */

import type {
  ColumnType,
  ConnectionInfo,
  IsolationLevel,
  SqlDriverAdapter,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
} from '@prisma/driver-adapter-utils'
import { Debug, DriverAdapterError } from '@prisma/driver-adapter-utils'
// @ts-ignore: this is used to avoid the `Module '"<path>/node_modules/@types/pg/index"' has no default export.` error.
import pg from 'pg'

import { name as packageName } from '../package.json'
import { FIRST_NORMAL_OBJECT_ID } from './constants'
import { customParsers, fieldToColumnType, mapArg, UnsupportedNativeDataType } from './conversion'
import { convertDriverError } from './errors'

const types = pg.types

const debug = Debug('prisma:driver-adapter:pg')

type StdClient = pg.Pool
type TransactionClient = pg.PoolClient

class PgQueryable<ClientT extends StdClient | TransactionClient> implements SqlQueryable {
  readonly provider = 'postgres'
  readonly adapterName = packageName

  constructor(
    protected readonly client: ClientT,
    protected readonly pgOptions?: PrismaPgOptions,
  ) {}

  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::query_raw]'
    debug(`${tag} %O`, query)

    const { fields, rows } = await this.performIO(query)

    const columnNames = fields.map((field) => field.name)
    let columnTypes: ColumnType[] = []

    try {
      columnTypes = fields.map((field) => fieldToColumnType(field.dataTypeID))
    } catch (e) {
      if (e instanceof UnsupportedNativeDataType) {
        throw new DriverAdapterError({
          kind: 'UnsupportedNativeDataType',
          type: e.type,
        })
      }
      throw e
    }

    const udtParser = this.pgOptions?.userDefinedTypeParser
    if (udtParser) {
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]
        if (field.dataTypeID >= FIRST_NORMAL_OBJECT_ID && !Object.hasOwn(customParsers, field.dataTypeID)) {
          for (let j = 0; j < rows.length; j++) {
            rows[j][i] = await udtParser(field.dataTypeID, rows[j][i], this)
          }
        }
      }
    }

    return {
      columnNames,
      columnTypes,
      rows,
    }
  }

  /**
   * Execute a query given as SQL, interpolating the given parameters and
   * returning the number of affected rows.
   * Note: Queryable expects a u64, but napi.rs only supports u32.
   */
  async executeRaw(query: SqlQuery): Promise<number> {
    const tag = '[js::execute_raw]'
    debug(`${tag} %O`, query)

    // Note: `rowsAffected` can sometimes be null (e.g., when executing `"BEGIN"`)
    return (await this.performIO(query)).rowCount ?? 0
  }

  /**
   * Run a query against the database, returning the result set.
   * Should the query fail due to a connection error, the connection is
   * marked as unhealthy.
   */
  private async performIO(query: SqlQuery): Promise<pg.QueryArrayResult<any>> {
    const { sql, args } = query
    const values = args.map((arg, i) => mapArg(arg, query.argTypes[i]))

    try {
      const result = await this.client.query({
        name: this.pgOptions?.statementNameGenerator?.(query),
        text: sql,
        values,
        rowMode: 'array',
        types: {
          getTypeParser: (oid: number, format?) => {
            if (format === 'text' && customParsers[oid]) {
              return customParsers[oid]
            }

            return types.getTypeParser(oid, format)
          },
        },
      })

      return result
    } catch (e) {
      this.onError(e)
    }
  }

  protected onError(error: unknown): never {
    debug('Error in performIO: %O', error)
    throw new DriverAdapterError(convertDriverError(error))
  }
}

class PgTransaction extends PgQueryable<TransactionClient> implements Transaction {
  constructor(
    client: pg.PoolClient,
    readonly options: TransactionOptions,
    readonly pgOptions?: PrismaPgOptions,
    readonly cleanup?: () => void,
  ) {
    super(client, pgOptions)
  }

  async commit(): Promise<void> {
    debug(`[js::commit]`)

    this.cleanup?.()
    this.client.release()
  }

  async rollback(): Promise<void> {
    debug(`[js::rollback]`)

    this.cleanup?.()
    this.client.release()
  }

  async createSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `SAVEPOINT ${name}`, args: [], argTypes: [] })
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `ROLLBACK TO SAVEPOINT ${name}`, args: [], argTypes: [] })
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `RELEASE SAVEPOINT ${name}`, args: [], argTypes: [] })
  }
}

export type PrismaPgOptions = {
  /**
   * The name of the schema to use in generated queries and as the `search_path` of connections
   * in pools managed by the adapter. When not set and the adapter is constructed from a
   * connection string or a config containing one, it falls back to the `?schema=` parameter of
   * the connection URL, if present.
   *
   * For externally constructed `pg.Pool` instances the pool configuration is caller-owned and
   * left untouched: the connection URL fallback does not apply and `search_path` is not
   * modified, but an explicit `schema` option still determines the schema used in generated
   * queries.
   */
  schema?: string
  /**
   * Whether to call `pool.end()` on an externally provided pool when the adapter is disposed.
   * Defaults to `false`.
   */
  disposeExternalPool?: boolean
  /** Callback attached to the pool's 'error' events. */
  onPoolError?: (err: Error) => void
  /** Callback attached to connection's 'error' events. */
  onConnectionError?: (err: Error) => void
  /**
   * Optional parser for user-defined types. Called with the type's OID, the value to parse, and
   * a queryable for performing additional queries if necessary.
   */
  userDefinedTypeParser?: UserDefinedTypeParser
  /**
   * Optional function to generate names for prepared statements. The generated strings are passed
   * as the `name` property in the query to `pg.Client#query()`, which uses them to cache the
   * underlying statements. If not provided, prepared statements are not cached.
   */
  statementNameGenerator?: StatementNameGenerator
}

export type UserDefinedTypeParser = (oid: number, value: unknown, adapter: SqlQueryable) => Promise<unknown>
export type StatementNameGenerator = (query: SqlQuery) => string

export class PrismaPgAdapter extends PgQueryable<StdClient> implements SqlDriverAdapter {
  constructor(
    client: StdClient,
    protected readonly pgOptions?: PrismaPgOptions,
    private readonly release?: () => Promise<void>,
  ) {
    super(client)
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    const options: TransactionOptions = {
      usePhantomQuery: false,
    }

    const tag = '[js::startTransaction]'
    debug('%s options: %O', tag, options)

    const conn = await this.client.connect().catch((error) => this.onError(error))
    const onError = (err: Error) => {
      debug(`Error from pool connection: ${err.message} %O`, err)
      this.pgOptions?.onConnectionError?.(err)
    }
    conn.on('error', onError)

    const cleanup = () => {
      conn.removeListener('error', onError)
    }

    try {
      const tx = new PgTransaction(conn, options, this.pgOptions, cleanup)
      await tx.executeRaw({ sql: 'BEGIN', args: [], argTypes: [] })
      if (isolationLevel) {
        await tx.executeRaw({
          sql: `SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`,
          args: [],
          argTypes: [],
        })
      }
      return tx
    } catch (error) {
      cleanup()
      conn.release(error)
      this.onError(error)
    }
  }

  async executeScript(script: string): Promise<void> {
    // FIXME: there's no guarantee that the semicolon is between statements
    // and not inside one.
    const statements = script
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0)

    for (const stmt of statements) {
      try {
        await this.client.query(stmt)
      } catch (error) {
        this.onError(error)
      }
    }
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      schemaName: this.pgOptions?.schema,
      supportsRelationJoins: true,
    }
  }

  async dispose(): Promise<void> {
    return this.release?.()
  }

  underlyingDriver(): pg.Pool {
    return this.client
  }
}

export class PrismaPgAdapterFactory implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = 'postgres'
  readonly adapterName = packageName
  private readonly config: pg.PoolConfig
  private externalPool: pg.Pool | null

  constructor(
    poolOrConfig: pg.Pool | pg.PoolConfig | string,
    private readonly options?: PrismaPgOptions,
  ) {
    if (poolOrConfig instanceof pg.Pool) {
      this.externalPool = poolOrConfig
      this.config = poolOrConfig.options
      return
    }

    this.externalPool = null
    this.config = typeof poolOrConfig === 'string' ? { connectionString: poolOrConfig } : { ...poolOrConfig }

    const parsedUrl = parseConnectionUrl(this.config.connectionString)
    const schema = this.options?.schema ?? parsedUrl.schema

    if (schema) {
      this.options = { ...options, schema }

      // `pg` merges a connection string's query parameters over the config object at
      // connect time, so an `options` embedded in the URL would override `config.options`
      // and drop the injected `search_path`. Fold the URL's `options` (which take
      // precedence over `config.options` in `pg`) into the effective value and drop them
      // from the connection string so the injected `search_path` survives.
      const baseOptions = parsedUrl.options ?? this.config.options
      this.config.connectionString = parsedUrl.connectionString
      this.config.options = [baseOptions, `-csearch_path=${schema}`].filter(Boolean).join(' ')
    }
  }

  async connect(): Promise<PrismaPgAdapter> {
    const client = this.externalPool ?? new pg.Pool(this.config)

    const onIdleClientError = (err: Error) => {
      debug(`Error from idle pool client: ${err.message} %O`, err)
      this.options?.onPoolError?.(err)
    }
    client.on('error', onIdleClientError)

    return new PrismaPgAdapter(client, this.options, async () => {
      if (this.externalPool) {
        if (this.options?.disposeExternalPool) {
          await this.externalPool.end()
          this.externalPool = null
        } else {
          this.externalPool.removeListener('error', onIdleClientError)
        }
      } else {
        await client.end()
      }
    })
  }

  async connectToShadowDb(): Promise<PrismaPgAdapter> {
    const conn = await this.connect()
    const database = `prisma_migrate_shadow_db_${globalThis.crypto.randomUUID()}`
    await conn.executeScript(`CREATE DATABASE "${database}"`)

    const client = new pg.Pool({ ...this.config, database })
    return new PrismaPgAdapter(client, undefined, async () => {
      await conn.executeScript(`DROP DATABASE "${database}"`)
      await client.end()
    })
  }
}

/**
 * Extracts the `schema` and libpq `options` parameters from a connection URL and returns
 * the connection string with the `options` parameter removed.
 *
 * `pg` also accepts libpq connection strings (e.g. `host=localhost dbname=test`) that are
 * not parseable as URLs; those carry no such parameters, so parsing failures yield an empty
 * result and the original connection string.
 *
 * The `options` parameter is stripped because `pg` merges a connection string's query
 * parameters over the config object at connect time: an `options` left in the URL would
 * override the `search_path` injected for the configured schema.
 */
function parseConnectionUrl(connectionString: string | undefined): {
  schema: string | undefined
  options: string | undefined
  connectionString: string | undefined
} {
  if (connectionString === undefined) {
    return { schema: undefined, options: undefined, connectionString }
  }

  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    return { schema: undefined, options: undefined, connectionString }
  }

  const schema = url.searchParams.get('schema') ?? undefined
  const options = url.searchParams.get('options') ?? undefined

  url.searchParams.delete('options')

  return { schema, options, connectionString: url.toString() }
}
