/**
 * Prisma Driver Adapter for Prisma Postgres.
 *
 * This module provides the Prisma driver adapter implementation,
 * allowing Prisma Client to connect to Prisma Postgres databases.
 *
 * @module ppg
 */

import {
  type ConnectionInfo,
  type IsolationLevel,
  type SqlDriverAdapter,
  type SqlDriverAdapterFactory,
  type SqlQuery,
  type SqlResultSet,
  type Transaction,
  type TransactionOptions,
} from '@prisma/driver-adapter-utils'
import { type Client, client, type Session, type Statements } from '@prisma/ppg'

import { builtinParsers, convertArgs, fieldToColumnType, isolationLevelToSql } from './conversion'
import { convertDriverError } from './errors'

/**
 * Configuration for the Prisma Postgres adapter.
 */
export interface PrismaPostgresAdapterConfig {
  /**
   * The URL of the Prisma Postgres Direct TCP connection.
   * Use the PRISMA_DIRECT_TCP_URL from your database connection details.
   */
  connectionString: string | URL
}

/**
 * Prisma ORM driver adapter for Prisma Postgres.
 *
 * This adapter allows Prisma Client to connect to Prisma Postgres databases
 * using the PPG client library for serverless and edge environments.
 *
 * @example
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * import { PrismaPostgresAdapter } from '@prisma/ppg/adapter';
 *
 * const adapter = new PrismaPostgresAdapter({
 *   connectionString: process.env.PRISMA_DIRECT_TCP_URL
 * });
 *
 * const prisma = new PrismaClient({ adapter });
 * ```
 */
export class PrismaPostgresAdapter implements SqlDriverAdapterFactory {
  readonly #config: PrismaPostgresAdapterConfig

  readonly adapterName = '@prisma/ppg-adapter'
  readonly provider = 'postgres'

  constructor(config: PrismaPostgresAdapterConfig) {
    this.#config = config
  }

  connect(): Promise<SqlDriverAdapter> {
    return Promise.resolve(new PrismaPostgresConnection(this.#config))
  }
}

/**
 * Connection implementation that uses a PPG Client with a Session for transaction support.
 */
class PrismaPostgresConnection implements SqlDriverAdapter {
  readonly #client: Client

  readonly adapterName = '@prisma/ppg-adapter'
  readonly provider = 'postgres'

  constructor(config: PrismaPostgresAdapterConfig) {
    const existingParsers = 'parsers' in config && config.parsers instanceof Array ? config.parsers : []
    this.#client = client({
      ...config,
      parsers: [...existingParsers, ...builtinParsers],
    })
  }

  async dispose(): Promise<void> {
    // PPG client doesn't require explicit disposal for HTTP-based queries
    // Sessions are disposed individually
  }

  getConnectionInfo(): ConnectionInfo {
    // PostgreSQL supports up to 65535 parameters, but we use a conservative limit
    return {
      maxBindValues: 16 << 10,
      schemaName: 'public',
      supportsRelationJoins: true,
    }
  }

  async executeRaw(params: SqlQuery): Promise<number> {
    return executeRawStatement(this.#client, params)
  }

  async executeScript(script: string): Promise<void> {
    await this.#client.query(script)
  }

  async queryRaw(params: SqlQuery): Promise<SqlResultSet> {
    return executeQueryRaw(this.#client, params)
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    const session = await this.#client.newSession()
    return new PrismaPostgresTransaction(session, isolationLevel)
  }
}

/**
 * Transaction implementation using PPG Session.
 */
class PrismaPostgresTransaction implements Transaction {
  readonly #session: Session
  readonly #isolationLevel?: IsolationLevel
  #begun = false
  #finished = false

  readonly adapterName = '@prisma/ppg-adapter'
  readonly provider = 'postgres'

  constructor(session: Session, isolationLevel?: IsolationLevel) {
    this.#session = session
    this.#isolationLevel = isolationLevel
  }

  get options(): TransactionOptions {
    return {
      usePhantomQuery: false,
    }
  }

  async #ensureBegun(): Promise<void> {
    if (this.#begun) return

    let beginSql = 'BEGIN'
    if (this.#isolationLevel) {
      beginSql += ` ISOLATION LEVEL ${isolationLevelToSql(this.#isolationLevel)}`
    }

    try {
      await this.#session.query(beginSql)
      this.#begun = true
    } catch (error) {
      this.#session.close()
      throw convertDriverError(error)
    }
  }

  async commit(): Promise<void> {
    if (this.#finished) {
      throw new Error('Transaction already finished')
    }

    try {
      await this.#ensureBegun()
      await this.#session.query('COMMIT')
      this.#finished = true
    } catch (error) {
      throw convertDriverError(error)
    } finally {
      this.#session.close()
    }
  }

  async rollback(): Promise<void> {
    if (this.#finished) {
      throw new Error('Transaction already finished')
    }

    try {
      if (this.#begun) {
        await this.#session.query('ROLLBACK')
      }
      this.#finished = true
    } catch (error) {
      throw convertDriverError(error)
    } finally {
      this.#session.close()
    }
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

  async executeRaw(params: SqlQuery): Promise<number> {
    await this.#ensureBegun()
    return executeRawStatement(this.#session, params)
  }

  async queryRaw(params: SqlQuery): Promise<SqlResultSet> {
    await this.#ensureBegun()
    return executeQueryRaw(this.#session, params)
  }
}

/**
 * Executes a raw SQL query and returns the result set.
 */
async function executeQueryRaw(executor: Statements, params: SqlQuery): Promise<SqlResultSet> {
  const { sql, args } = params

  try {
    const convertedArgs = convertArgs(args, params.argTypes)
    const result = await executor.query(sql, ...convertedArgs)

    // Collect all rows - the driver adapter interface requires synchronous access
    const rows = await result.rows.collect()
    // Map columns with type information
    const columnNames = result.columns.map((col) => col.name)
    const columnTypes = result.columns.map((col) => fieldToColumnType(col.oid))

    return {
      columnNames,
      columnTypes,
      rows: rows.map((row) => row.values),
    }
  } catch (error) {
    throw convertDriverError(error)
  }
}

/**
 * Executes a raw SQL statement and returns the number of affected rows.
 */
async function executeRawStatement(executor: Statements, params: SqlQuery): Promise<number> {
  const { sql, args } = params

  try {
    const convertedArgs = convertArgs(args, params.argTypes)
    const affected = await executor.exec(sql, ...convertedArgs)
    return affected
  } catch (error) {
    throw convertDriverError(error)
  }
}
