import type { SqlDriverAdapter, SqlQuery, SqlResultSet, Transaction } from '@prisma/driver-adapter-utils'
import { vi } from 'vitest'

import { Options } from './transaction'
import { TransactionManager } from './transaction-manager'

export const START_TRANSACTION_TIME = 200
export const TRANSACTION_EXECUTION_TIMEOUT = 500

export const TRANSACTION_OPTIONS = {
  timeout: TRANSACTION_EXECUTION_TIMEOUT,
  maxWait: START_TRANSACTION_TIME * 2,
  isolationLevel: undefined,
} as Options

export const EMPTY_RESULT_SET: SqlResultSet = { columnNames: [], columnTypes: [], rows: [] }

export class MockDriverAdapter implements SqlDriverAdapter {
  adapterName = 'mock-adapter'
  provider: SqlDriverAdapter['provider']
  private readonly usePhantomQuery: boolean
  private readonly createSavepoint: Transaction['createSavepoint']
  private readonly rollbackToSavepoint: Transaction['rollbackToSavepoint']
  private readonly releaseSavepoint: Transaction['releaseSavepoint']

  executeRawMock = vi.fn().mockResolvedValue(1)
  queryRawMock = vi.fn().mockResolvedValue(EMPTY_RESULT_SET)
  commitMock = vi.fn().mockResolvedValue(undefined)
  rollbackMock = vi.fn().mockResolvedValue(undefined)

  constructor(
    options: {
      provider?: SqlDriverAdapter['provider']
      usePhantomQuery?: boolean
      createSavepoint?: Transaction['createSavepoint']
      rollbackToSavepoint?: Transaction['rollbackToSavepoint']
      releaseSavepoint?: Transaction['releaseSavepoint']
    } = {},
  ) {
    const { provider = 'postgres' as SqlDriverAdapter['provider'], usePhantomQuery = false } = options
    this.usePhantomQuery = usePhantomQuery
    this.provider = provider

    this.createSavepoint = Object.hasOwn(options, 'createSavepoint')
      ? options.createSavepoint
      : async (name) => {
          const sql = this.provider === 'sqlserver' ? `SAVE TRANSACTION ${name}` : `SAVEPOINT ${name}`
          await this.executeRawMock({ sql, args: [], argTypes: [] })
        }
    this.rollbackToSavepoint = Object.hasOwn(options, 'rollbackToSavepoint')
      ? options.rollbackToSavepoint
      : async (name) => {
          const sql =
            this.provider === 'sqlserver'
              ? `ROLLBACK TRANSACTION ${name}`
              : this.provider === 'postgres'
                ? `ROLLBACK TO SAVEPOINT ${name}`
                : `ROLLBACK TO ${name}`
          await this.executeRawMock({ sql, args: [], argTypes: [] })
        }
    this.releaseSavepoint = Object.hasOwn(options, 'releaseSavepoint')
      ? options.releaseSavepoint
      : this.provider === 'sqlserver'
        ? undefined
        : async (name) => {
            await this.executeRawMock({ sql: `RELEASE SAVEPOINT ${name}`, args: [], argTypes: [] })
          }
  }

  executeRaw(params: SqlQuery): Promise<number> {
    return this.executeRawMock(params)
  }

  queryRaw(_params: SqlQuery): Promise<SqlResultSet> {
    throw new Error('Not implemented for test')
  }

  executeScript(_script: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  dispose(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  startTransaction(): Promise<Transaction> {
    const executeRawMock = this.executeRawMock
    const queryRawMock = this.queryRawMock
    const commitMock = this.commitMock
    const rollbackMock = this.rollbackMock
    const usePhantomQuery = this.usePhantomQuery
    const provider = this.provider

    const mockTransaction: Transaction = {
      adapterName: 'mock-adapter',
      provider,
      options: { usePhantomQuery },
      queryRaw: queryRawMock,
      executeRaw: executeRawMock,
      commit: commitMock,
      rollback: rollbackMock,
      createSavepoint: this.createSavepoint,
      rollbackToSavepoint: this.rollbackToSavepoint,
      releaseSavepoint: this.releaseSavepoint,
    }

    return new Promise((resolve) =>
      setTimeout(() => {
        resolve(mockTransaction)
      }, START_TRANSACTION_TIME),
    )
  }
}

export async function startTransaction(transactionManager: TransactionManager, options: Partial<Options> = {}) {
  const [{ id }] = await Promise.all([
    transactionManager.startTransaction({
      timeout: TRANSACTION_EXECUTION_TIMEOUT,
      maxWait: START_TRANSACTION_TIME * 2,
      ...options,
    }),
    vi.advanceTimersByTimeAsync(START_TRANSACTION_TIME + 100),
  ])
  return id
}

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
