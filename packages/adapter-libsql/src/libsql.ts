import type {
  Client as LibSqlClientRaw,
  Config as LibSqlConfig,
  ResultSet as LibSqlResultSet,
  Transaction as LibSqlTransactionRaw,
} from '@libsql/client'
import type {
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
import { Mutex } from 'async-mutex'

import { name as packageName } from '../package.json'
import { getColumnTypes, mapArg, mapRow } from './conversion'
import { convertDriverError } from './errors'

const debug = Debug('prisma:driver-adapter:libsql')

type StdClient = LibSqlClientRaw
type TransactionClient = LibSqlTransactionRaw

const LOCK_TAG = Symbol()

class LibSqlQueryable<ClientT extends StdClient | TransactionClient> implements SqlQueryable {
  readonly provider = 'sqlite'
  readonly adapterName = packageName;

  [LOCK_TAG] = new Mutex()

  constructor(
    protected readonly client: ClientT,
    protected readonly adapterOptions?: PrismaLibSqlOptions,
  ) {}

  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::query_raw]'
    debug(`${tag} %O`, query)

    const { columns, rows, columnTypes: declaredColumnTypes } = await this.performIO(query)

    const columnTypes = getColumnTypes(declaredColumnTypes, rows)

    return {
      columnNames: columns,
      columnTypes,
      rows: rows.map((row) => mapRow(row, columnTypes)),
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

    return (await this.performIO(query)).rowsAffected ?? 0
  }

  /**
   * Run a query against the database, returning the result set.
   * Should the query fail due to a connection error, the connection is
   * marked as unhealthy.
   */
  private async performIO(query: SqlQuery): Promise<LibSqlResultSet> {
    const release = await this[LOCK_TAG].acquire()
    try {
      const result = await this.client.execute({
        sql: query.sql,
        args: query.args.map((arg, i) => mapArg(arg, query.argTypes[i], this.adapterOptions)),
      })
      return result
    } catch (e) {
      this.onError(e)
    } finally {
      release()
    }
  }

  protected onError(error: any): never {
    debug('Error in performIO: %O', error)
    throw new DriverAdapterError(convertDriverError(error))
  }
}

class LibSqlTransaction extends LibSqlQueryable<TransactionClient> implements Transaction {
  readonly #unlockParent: () => void

  constructor(
    client: TransactionClient,
    readonly options: TransactionOptions,
    adapterOptions: PrismaLibSqlOptions | undefined,
    unlockParent: () => void,
  ) {
    super(client, adapterOptions)
    this.#unlockParent = unlockParent
  }

  async commit(): Promise<void> {
    debug(`[js::commit]`)

    try {
      await this.client.commit()
    } finally {
      this.#unlockParent()
    }
  }

  async rollback(): Promise<void> {
    debug(`[js::rollback]`)

    try {
      await this.client.rollback()
    } catch (error) {
      debug('error in rollback:', error)
    } finally {
      this.#unlockParent()
    }
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

export class PrismaLibSqlAdapter extends LibSqlQueryable<StdClient> implements SqlDriverAdapter {
  readonly #maxBindValues: number | undefined

  constructor(client: StdClient, adapterOptions?: PrismaLibSqlOptions, maxBindValues?: number) {
    super(client, adapterOptions)
    this.#maxBindValues = maxBindValues
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      maxBindValues: this.#maxBindValues,
      supportsRelationJoins: false,
    }
  }

  async executeScript(script: string): Promise<void> {
    const release = await this[LOCK_TAG].acquire()
    try {
      await this.client.executeMultiple(script)
    } catch (e) {
      this.onError(e)
    } finally {
      release()
    }
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level: isolationLevel,
      })
    }

    const options: TransactionOptions = {
      usePhantomQuery: true,
    }

    const tag = '[js::startTransaction]'
    debug('%s options: %O', tag, options)

    const release = await this[LOCK_TAG].acquire()

    try {
      const tx = await this.client.transaction('deferred')
      return new LibSqlTransaction(tx, options, this.adapterOptions, release)
    } catch (e) {
      // note: we only release the lock if creating the transaction fails, it must stay locked otherwise,
      // hence `catch` and rethrowing the error and not `finally`.
      release()
      this.onError(e)
    }
  }

  dispose(): Promise<void> {
    this.client.close()
    return Promise.resolve()
  }
}

export type PrismaLibSqlOptions = {
  timestampFormat?: 'iso8601' | 'unixepoch-ms'
}

export abstract class PrismaLibSqlAdapterFactoryBase implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = 'sqlite'
  readonly adapterName = packageName

  readonly #config: LibSqlConfig
  readonly #options?: PrismaLibSqlOptions

  constructor(config: LibSqlConfig, options?: PrismaLibSqlOptions) {
    this.#config = config
    this.#options = options
  }

  connect(): Promise<SqlDriverAdapter> {
    return this.#connectWith(this.#config)
  }

  connectToShadowDb(): Promise<SqlDriverAdapter> {
    // TODO: the user should be able to provide a custom URL for the shadow database
    return this.#connectWith({ ...this.#config, url: ':memory:' })
  }

  async #connectWith(config: LibSqlConfig): Promise<SqlDriverAdapter> {
    const client = this.createClient(config)
    return new PrismaLibSqlAdapter(client, this.#options, await readMaxBindValues(client))
  }

  abstract createClient(config: LibSqlConfig): StdClient
}

/**
 * SQLite's bind parameter limit is set at compile time: 999 before SQLite 3.32.0, 32766 since.
 * Read it from the database so the query interpreter doesn't fall back to the old 999 default.
 * Returns `undefined` (keeping that default) when the build doesn't report it.
 */
async function readMaxBindValues(client: StdClient): Promise<number | undefined> {
  const { rows } = await client.execute('PRAGMA compile_options')
  const option = rows.map((row) => String(row[0])).find((value) => value.startsWith('MAX_VARIABLE_NUMBER='))
  const value = Number(option?.slice('MAX_VARIABLE_NUMBER='.length))
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
