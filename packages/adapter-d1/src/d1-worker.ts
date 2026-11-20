/* eslint-disable @typescript-eslint/require-await */

import type { D1Database, D1Response } from '@cloudflare/workers-types'
import {
  ConnectionInfo,
  Debug,
  DriverAdapterError,
  IsolationLevel,
  SqlDriverAdapter,
  SqlDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
} from '@prisma/driver-adapter-utils'
import { blue, cyan, red, yellow } from 'kleur/colors'

import { name as packageName } from '../package.json'
import { MAX_BIND_VALUES } from './constants'
import { getColumnTypes, mapArg, mapRow } from './conversion'
import { convertDriverError } from './errors'

const debug = Debug('prisma:driver-adapter:d1')

type D1ResultsWithColumnNames = [string[], unknown[][]]
type PerformIOResult = D1ResultsWithColumnNames | D1Response
type StdClient = D1Database

/**
 * Env binding for Cloudflare D1.
 */
class D1WorkerQueryable<ClientT extends StdClient> implements SqlQueryable {
  readonly provider = 'sqlite'
  readonly adapterName = packageName

  constructor(protected readonly client: ClientT) {}

  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::query_raw]'
    debug(`${tag} %O`, query)

    const data = await this.performIO(query)
    const convertedData = this.convertData(data as D1ResultsWithColumnNames)
    return convertedData
  }

  private convertData(ioResult: D1ResultsWithColumnNames): SqlResultSet {
    const columnNames = ioResult[0]
    const results = ioResult[1]

    if (results.length === 0) {
      return {
        columnNames: [],
        columnTypes: [],
        rows: [],
      }
    }

    const columnTypes = Object.values(getColumnTypes(columnNames, results))
    const rows = results.map((value) => mapRow(value, columnTypes))

    return {
      columnNames,
      // * Note: without Object.values the array looks like
      // * columnTypes: [ id: 128 ],
      // * and errors with:
      // * ✘ [ERROR] A hanging Promise was canceled. This happens when the worker runtime is waiting for a Promise from JavaScript to resolve, but has detected that the Promise cannot possibly ever resolve because all code and events related to the Promise's I/O context have already finished.
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

    const result = await this.performIO(query, true)
    return (result as D1Response).meta.changes ?? 0
  }

  private async performIO(query: SqlQuery, executeRaw = false): Promise<PerformIOResult> {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i]))
      const stmt = this.client.prepare(query.sql).bind(...args)

      if (executeRaw) {
        return await stmt.run()
      } else {
        const [columnNames, ...rows] = await stmt.raw({ columnNames: true })
        return [columnNames, rows]
      }
    } catch (e) {
      onError(e as Error)
    }
  }
}

class D1WorkerTransaction extends D1WorkerQueryable<StdClient> implements Transaction {
  constructor(
    client: StdClient,
    readonly options: TransactionOptions,
  ) {
    super(client)
  }

  async commit(): Promise<void> {
    debug(`[js::commit]`)
  }

  async rollback(): Promise<void> {
    debug(`[js::rollback]`)
  }

  async createSavepoint(name: string): Promise<void> {
    debug(`[js::createSavepoint] %s`, name)
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    debug(`[js::rollbackToSavepoint] %s`, name)
  }

  async releaseSavepoint(name: string): Promise<void> {
    debug(`[js::releaseSavepoint] %s`, name)
  }
}

export class PrismaD1WorkerAdapter extends D1WorkerQueryable<StdClient> implements SqlDriverAdapter {
  readonly tags = {
    error: red('prisma:error'),
    warn: yellow('prisma:warn'),
    info: cyan('prisma:info'),
    query: blue('prisma:query'),
  }

  alreadyWarned = new Set()

  constructor(
    client: StdClient,
    private readonly release?: () => Promise<void>,
  ) {
    super(client)
  }

  /**
   * This will warn once per transaction
   * e.g. the following two explicit transactions
   * will only trigger _two_ warnings
   *
   * ```ts
   * await prisma.$transaction([ ...queries ])
   * await prisma.$transaction([ ...moreQueries ])
   * ```
   */
  private warnOnce = (key: string, message: string, ...args: unknown[]) => {
    if (!this.alreadyWarned.has(key)) {
      this.alreadyWarned.add(key)
      console.info(`${this.tags.warn} ${message}`, ...args)
    }
  }

  async executeScript(script: string): Promise<void> {
    try {
      await this.client.exec(script)
    } catch (error) {
      onError(error as Error)
    }
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      maxBindValues: MAX_BIND_VALUES,
      supportsRelationJoins: false,
    }
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level: isolationLevel,
      })
    }

    this.warnOnce(
      'D1 Transaction',
      "Cloudflare D1 does not support transactions yet. When using Prisma's D1 adapter, implicit & explicit transactions will be ignored and run as individual queries, which breaks the guarantees of the ACID properties of transactions. For more details see https://pris.ly/d/d1-transactions",
    )

    const options: TransactionOptions = {
      usePhantomQuery: true,
    }

    const tag = '[js::startTransaction]'
    debug('%s options: %O', tag, options)

    return new D1WorkerTransaction(this.client, options)
  }

  async dispose(): Promise<void> {
    await this.release?.()
  }
}

export class PrismaD1WorkerAdapterFactory implements SqlDriverAdapterFactory {
  readonly provider = 'sqlite'
  readonly adapterName = packageName

  constructor(private client: StdClient) {}

  async connect(): Promise<SqlDriverAdapter> {
    return new PrismaD1WorkerAdapter(this.client, async () => {})
  }
}

function onError(error: Error): never {
  console.error('Error in performIO: %O', error)
  throw new DriverAdapterError(convertDriverError(error))
}
