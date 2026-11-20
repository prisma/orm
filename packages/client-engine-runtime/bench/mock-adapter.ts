/**
 * Mock driver adapter for benchmarks.
 * Used to measure interpreter overhead without actual database calls.
 */
import type {
  ConnectionInfo,
  IsolationLevel,
  SqlDriverAdapter,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
} from '@prisma/driver-adapter-utils'

import { ExtendedSpanOptions, SpanCallback, TracingHelper } from '../src/tracing'

export class MockDriverAdapter implements SqlDriverAdapter, SqlQueryable {
  readonly provider = 'sqlite' as const
  readonly adapterName = '@prisma/mock-adapter'

  private queryResults: Map<string, SqlResultSet> = new Map()
  private defaultResult: SqlResultSet = {
    columnNames: [],
    columnTypes: [],
    rows: [],
  }

  setQueryResult(pattern: string, result: SqlResultSet): void {
    this.queryResults.set(pattern, result)
  }

  setDefaultResult(result: SqlResultSet): void {
    this.defaultResult = result
  }

  queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    for (const [pattern, result] of this.queryResults) {
      if (query.sql.includes(pattern)) {
        return Promise.resolve(result)
      }
    }
    return Promise.resolve(this.defaultResult)
  }

  executeRaw(_query: SqlQuery): Promise<number> {
    return Promise.resolve(1)
  }

  executeScript(_script: string): Promise<void> {
    return Promise.resolve()
  }

  startTransaction(_isolationLevel?: IsolationLevel): Promise<Transaction> {
    return Promise.resolve(new MockTransaction(this))
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      supportsRelationJoins: false,
    }
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }
}

export class MockTransaction implements Transaction, SqlQueryable {
  readonly provider = 'sqlite' as const
  readonly adapterName = '@prisma/mock-adapter'
  readonly options: TransactionOptions = { usePhantomQuery: false }

  constructor(private adapter: MockDriverAdapter) {}

  queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    return this.adapter.queryRaw(query)
  }

  executeRaw(query: SqlQuery): Promise<number> {
    return this.adapter.executeRaw(query)
  }

  commit(): Promise<void> {
    return Promise.resolve()
  }

  rollback(): Promise<void> {
    return Promise.resolve()
  }
}

export const mockTracingHelper: TracingHelper = {
  isEnabled(): boolean {
    return false
  },

  runInChildSpan<R>(_nameOrOptions: string | ExtendedSpanOptions, callback: SpanCallback<R>): R {
    return callback()
  },
}
