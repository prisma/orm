/* eslint-disable @typescript-eslint/require-await */

import * as neon from '@neondatabase/serverless'
import type {
  ColumnType,
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

import { name as packageName } from '../package.json'
import { customParsers, fieldToColumnType, mapArg, UnsupportedNativeDataType } from './conversion'
import { convertDriverError } from './errors'

const debug = Debug('prisma:driver-adapter:neon')

type ARRAY_MODE_ENABLED = true

type PerformIOResult = neon.QueryResult<any> | neon.FullQueryResults<ARRAY_MODE_ENABLED>

/**
 * Base class for http client, ws client and ws transaction
 */
abstract class NeonQueryable implements SqlQueryable {
  readonly provider = 'postgres'
  readonly adapterName = packageName

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
  abstract performIO(query: SqlQuery): Promise<PerformIOResult>
}

/**
 * Base class for WS-based queryables: top-level client and transaction
 */
class NeonWsQueryable<ClientT extends neon.Pool | neon.PoolClient> extends NeonQueryable {
  constructor(protected client: ClientT) {
    super()
  }

  override async performIO(query: SqlQuery): Promise<PerformIOResult> {
    const { sql, args } = query

    try {
      const result = await this.client.query(
        {
          text: sql,
          rowMode: 'array',
          types: {
            // This is the error expected:
            // No overload matches this call.
            // The last overload gave the following error.
            //   Type '(oid: number, format?: any) => (json: string) => unknown' is not assignable to type '{ <T>(oid: number): TypeParser<string, string | T>; <T>(oid: number, format: "text"): TypeParser<string, string | T>; <T>(oid: number, format: "binary"): TypeParser<...>; }'.
            //     Type '(json: string) => unknown' is not assignable to type 'TypeParser<Buffer, any>'.
            //       Types of parameters 'json' and 'value' are incompatible.
            //         Type 'Buffer' is not assignable to type 'string'.ts(2769)
            //
            // Because pg-types types expect us to handle both binary and text protocol versions,
            // where as far we can see, pg will ever pass only text version.
            //
            // @ts-expect-error
            getTypeParser: (oid: number, format?) => {
              if (format === 'text' && customParsers[oid]) {
                return customParsers[oid]
              }

              return neon.types.getTypeParser(oid, format)
            },
          },
        },
        args.map((arg, i) => mapArg(arg, query.argTypes[i])),
      )

      return result
    } catch (e) {
      this.onError(e)
    }
  }

  protected onError(e: any): never {
    debug('Error in onError: %O', e)
    throw new DriverAdapterError(convertDriverError(e))
  }
}

class NeonTransaction extends NeonWsQueryable<neon.PoolClient> implements Transaction {
  private closed = false
  private runningStatements = 0

  constructor(
    client: neon.PoolClient,
    readonly options: TransactionOptions,
    readonly cleanup?: () => void,
  ) {
    super(client)
  }

  override async performIO(query: SqlQuery): Promise<PerformIOResult> {
    if (this.closed) {
      throw new DriverAdapterError({
        kind: 'TransactionAlreadyClosed',
        cause: 'The transaction has already been committed or rolled back',
      })
    }

    this.runningStatements++
    try {
      return await super.performIO(query)
    } finally {
      this.runningStatements--
    }
  }

  /**
   * Closes the transaction at most once. Once the pool has lent the client to
   * a new owner, a second `release()` would corrupt the pool's bookkeeping, so
   * it is skipped. A client with a statement still running is released with an
   * error so the pool destroys it instead of lending out a busy connection.
   */
  private close(): void {
    if (this.closed) {
      return
    }
    this.closed = true

    try {
      this.cleanup?.()
    } finally {
      if (this.runningStatements > 0) {
        this.client.release(new Error('Transaction closed with a statement still running'))
      } else {
        this.client.release()
      }
    }
  }

  async commit(): Promise<void> {
    debug(`[js::commit]`)

    this.close()
  }

  async rollback(): Promise<void> {
    debug(`[js::rollback]`)

    this.close()
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

export type PrismaNeonOptions = {
  schema?: string
  onPoolError?: (err: Error) => void
  onConnectionError?: (err: Error) => void
}

export class PrismaNeonAdapter extends NeonWsQueryable<neon.Pool> implements SqlDriverAdapter {
  private isRunning = true

  constructor(
    pool: neon.Pool,
    private options?: PrismaNeonOptions,
  ) {
    super(pool)
  }

  executeScript(_script: string): Promise<void> {
    throw new Error('Not implemented yet')
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
      this.options?.onConnectionError?.(err)
    }
    conn.on('error', onError)

    const cleanup = () => {
      conn.removeListener('error', onError)
    }

    try {
      const tx = new NeonTransaction(conn, options, cleanup)
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

  getConnectionInfo(): ConnectionInfo {
    return {
      schemaName: this.options?.schema,
      supportsRelationJoins: true,
    }
  }

  async dispose(): Promise<void> {
    if (this.isRunning) {
      await this.client.end()
      this.isRunning = false
    }
  }

  underlyingDriver(): neon.Pool {
    return this.client
  }
}

export class PrismaNeonAdapterFactory implements SqlDriverAdapterFactory {
  readonly provider = 'postgres'
  readonly adapterName = packageName

  constructor(
    private readonly config: neon.PoolConfig,
    private options?: PrismaNeonOptions,
  ) {}

  async connect(): Promise<PrismaNeonAdapter> {
    const pool = new neon.Pool(this.config)
    pool.on('error', (err) => {
      debug(`Error from pool client: ${err.message} %O`, err)
      this.options?.onPoolError?.(err)
    })

    return new PrismaNeonAdapter(pool, this.options)
  }
}

export class PrismaNeonHttpAdapter extends NeonQueryable implements SqlDriverAdapter {
  private client: (sql: string, params: any[], opts: Record<string, any>) => neon.NeonQueryPromise<any, any>

  constructor(client: neon.NeonQueryFunction<any, any>) {
    super()
    // `client.query` is for @neondatabase/serverless v1.0.0 and up, where the
    // root query function `client` is only usable as a template function;
    // `client` is a fallback for earlier versions
    this.client = (client as any).query ?? (client as any)
  }

  executeScript(_script: string): Promise<void> {
    throw new Error('Not implemented yet')
  }

  async startTransaction(): Promise<Transaction> {
    return Promise.reject(new Error('Transactions are not supported in HTTP mode'))
  }

  override async performIO(query: SqlQuery): Promise<PerformIOResult> {
    const { sql, args } = query
    const values = args.map((arg, i) => mapArg(arg, query.argTypes[i]))
    return await this.client(sql, values, {
      arrayMode: true,
      fullResults: true,
      // pass type parsers to neon() HTTP client, same as in WS client above
      //
      // requires @neondatabase/serverless >= 0.9.5
      // - types option added in https://github.com/neondatabase/serverless/pull/92
      types: {
        getTypeParser: (oid: number, format?) => {
          if (format === 'text' && customParsers[oid]) {
            return customParsers[oid]
          }

          return neon.types.getTypeParser(oid, format)
        },
      },
      // type `as` cast required until neon types are corrected:
      // https://github.com/neondatabase/serverless/pull/110#issuecomment-2458992991
    } as neon.HTTPQueryOptions<true, true>)
  }

  async dispose(): Promise<void> {}
}

export class PrismaNeonHttpAdapterFactory implements SqlDriverAdapterFactory {
  readonly provider = 'postgres'
  readonly adapterName = packageName

  constructor(
    private readonly connectionString: string,
    private readonly options: neon.HTTPQueryOptions<boolean, boolean>,
  ) {}

  async connect(): Promise<SqlDriverAdapter> {
    return new PrismaNeonHttpAdapter(neon.neon(this.connectionString, this.options))
  }
}
