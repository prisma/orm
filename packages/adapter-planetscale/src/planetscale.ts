/* eslint-disable @typescript-eslint/require-await */

// default import does not work correctly for JS values inside,
// i.e. client
import * as planetScale from '@planetscale/database'
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
import { Mutex } from 'async-mutex'

import { name as packageName } from '../package.json'
import { cast, fieldToColumnType, mapArg } from './conversion'
import { createDeferred, Deferred } from './deferred'
import { convertDriverError } from './errors'

const debug = Debug('prisma:driver-adapter:planetscale')

class RollbackError extends Error {
  constructor() {
    super('ROLLBACK')
    this.name = 'RollbackError'

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RollbackError)
    }
  }
}

class PlanetScaleQueryable<ClientT extends planetScale.Client | planetScale.Transaction | planetScale.Connection>
  implements SqlQueryable
{
  readonly provider = 'mysql'
  readonly adapterName = packageName

  constructor(protected client: ClientT) {}

  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::query_raw]'
    debug(`${tag} %O`, query)

    const { fields, insertId: lastInsertId, rows } = await this.performIO(query)
    const columns = fields.map((field) => field.name)
    return {
      columnNames: columns,
      columnTypes: fields.map((field) => fieldToColumnType(field)),
      rows: rows as SqlResultSet['rows'],
      lastInsertId,
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

    return (await this.performIO(query)).rowsAffected
  }

  /**
   * Run a query against the database, returning the result set.
   * Should the query fail due to a connection error, the connection is
   * marked as unhealthy.
   */
  protected async performIO(query: SqlQuery): Promise<planetScale.ExecutedQuery> {
    const { sql, args } = query

    try {
      const result = await this.client.execute(
        sql,
        args.map((arg, i) => mapArg(arg, query.argTypes[i])),
        {
          as: 'array',
          cast,
        },
      )
      return result
    } catch (e) {
      const error = e as Error
      onError(error)
    }
  }
}

function onError(error: Error): never {
  if (error.name === 'DatabaseError') {
    const parsed = parseErrorMessage(error.message)
    if (parsed) {
      throw new DriverAdapterError(convertDriverError(parsed))
    }
  }
  debug('Error in performIO: %O', error)
  throw error
}

function parseErrorMessage(error: string): ParsedDatabaseError | undefined {
  const regex = /^(.*) \(errno (\d+)\) \(sqlstate ([A-Z0-9]+)\)/
  let match: RegExpMatchArray | null = null

  while (true) {
    const result = error.match(regex)
    if (result === null) {
      break
    }

    // Try again with the rest of the error message. The driver can return multiple
    // concatenated error messages.
    match = result
    error = match[1]
  }

  if (match !== null) {
    const [, message, codeAsString, sqlstate] = match
    const code = Number.parseInt(codeAsString, 10)

    return {
      message,
      code,
      state: sqlstate,
    }
  } else {
    return undefined
  }
}

class PlanetScaleTransaction extends PlanetScaleQueryable<planetScale.Transaction> implements Transaction {
  // The PlanetScale connection objects are not meant to be used concurrently,
  // so we override the `performIO` method to synchronize access to it with a mutex.
  // See: https://github.com/mattrobenolt/ps-http-sim/issues/7
  #mutex = new Mutex()

  constructor(
    tx: planetScale.Transaction,
    readonly options: TransactionOptions,
    private txDeferred: Deferred<void>,
    private txResultPromise: Promise<void>,
  ) {
    super(tx)
  }

  async performIO(query: SqlQuery): Promise<planetScale.ExecutedQuery> {
    const release = await this.#mutex.acquire()
    try {
      return await super.performIO(query)
    } catch (e) {
      onError(e as Error)
    } finally {
      release()
    }
  }

  async commit(): Promise<void> {
    debug(`[js::commit]`)

    this.txDeferred.resolve()
    return await this.txResultPromise
  }

  async rollback(): Promise<void> {
    debug(`[js::rollback]`)

    this.txDeferred.reject(new RollbackError())
    return await this.txResultPromise
  }

  async createSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `SAVEPOINT ${name}`, args: [], argTypes: [] })
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `ROLLBACK TO ${name}`, args: [], argTypes: [] })
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `RELEASE SAVEPOINT ${name}`, args: [], argTypes: [] })
  }
}

export class PrismaPlanetScaleAdapter extends PlanetScaleQueryable<planetScale.Client> implements SqlDriverAdapter {
  constructor(client: planetScale.Client) {
    super(client)
  }

  executeScript(_script: string): Promise<void> {
    throw new Error('Not implemented yet')
  }

  getConnectionInfo(): ConnectionInfo {
    const url = this.client.connection()['url'] as string
    const dbName = new URL(url).pathname.slice(1) /* slice out forward slash */
    return {
      schemaName: dbName || undefined, // If `dbName` is an empty string, do not set a schema name
      supportsRelationJoins: true,
    }
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    const options: TransactionOptions = {
      usePhantomQuery: true,
    }

    const tag = '[js::startTransaction]'
    debug('%s options: %O', tag, options)

    const conn = this.client.connection()
    if (isolationLevel) {
      await conn.execute(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`).catch((error) => onError(error))
    }
    return this.startTransactionInner(conn, options)
  }

  async startTransactionInner(conn: planetScale.Connection, options: TransactionOptions): Promise<Transaction> {
    return new Promise<Transaction>((resolve, _reject) => {
      const txResultPromise = conn
        .transaction(async (tx) => {
          const [txDeferred, deferredPromise] = createDeferred<void>()
          const txWrapper = new PlanetScaleTransaction(tx, options, txDeferred, txResultPromise)

          resolve(txWrapper)
          return deferredPromise
        })
        .catch((error) => {
          // Rollback error is ignored (so that tx.rollback() won't crash)
          // any other error is legit and is re-thrown
          if (!(error instanceof RollbackError)) {
            throw error
          }

          return undefined
        })
    })
  }

  async dispose(): Promise<void> {}

  underlyingDriver(): planetScale.Client {
    return this.client
  }
}

export class PrismaPlanetScaleAdapterFactory implements SqlDriverAdapterFactory {
  readonly provider = 'mysql'
  readonly adapterName = packageName

  #config: planetScale.Config
  #client?: planetScale.Client

  constructor(arg: planetScale.Config | planetScale.Client) {
    if (arg instanceof planetScale.Client) {
      this.#config = arg.config
      this.#client = arg
    } else {
      this.#config = arg
    }
  }

  async connect(): Promise<PrismaPlanetScaleAdapter> {
    return new PrismaPlanetScaleAdapter(this.#client ?? new planetScale.Client(this.#config))
  }
}

export type ParsedDatabaseError = {
  message: string
  code: number
  state: string
}
