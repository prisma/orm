import timers from 'node:timers/promises'

import {
  ColumnTypeEnum,
  SqlDriverAdapter,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
} from '@prisma/driver-adapter-utils'
import { describe, expect, test, vi } from 'vitest'

import type { PlaceholderFormat, QueryPlanNode } from '../query-plan'
import { noopTracingHelper } from '../tracing'
import { TransactionManager } from '../transaction-manager/transaction-manager'
import { purifyQueryPlan, QueryInterpreter, type QueryRuntimeOptions } from './query-interpreter'

function resultSetWithRows(rowCount: number): SqlResultSet {
  return {
    columnNames: ['id'],
    columnTypes: [ColumnTypeEnum.Int32],
    rows: Array.from({ length: rowCount }, (_, i) => [i]),
  }
}

function queryNode(sql: string): QueryPlanNode {
  return {
    type: 'query',
    args: {
      type: 'templateSql',
      fragments: [{ type: 'stringChunk', chunk: sql }],
      placeholderFormat: { prefix: '$', hasNumbering: true },
      args: [],
      argTypes: [],
      chunkable: false,
    },
  }
}

function userResultSet(id: number, name: string): SqlResultSet {
  return {
    columnNames: ['id', 'name'],
    columnTypes: [ColumnTypeEnum.Int32, ColumnTypeEnum.Text],
    rows: [[id, name]],
  }
}

// Regression test for https://github.com/prisma/prisma/issues/29746: merging the rows of a chunked
// query used to spread the whole result set onto the stack (`results.rows.push(...result.rows)`),
// overflowing the call stack when a single chunk returned hundreds of thousands of rows.
test('merges chunked query results without overflowing the stack', async () => {
  const rowsPerLaterChunk = 200_000

  let call = 0
  const queryable: SqlQueryable = {
    provider: 'postgres',
    adapterName: 'test',
    queryRaw: (_query: SqlQuery) => {
      call++
      // The first chunk yields no rows so the whole result set is delivered by the second chunk
      // through the spread-based merge path that used to overflow the stack.
      return Promise.resolve(resultSetWithRows(call === 1 ? 0 : rowsPerLaterChunk))
    },
    executeRaw: () => Promise.resolve(0),
  }

  const interpreter = QueryInterpreter.forSql({
    tracingHelper: noopTracingHelper,
    connectionInfo: { maxBindValues: 2, supportsRelationJoins: false },
  })

  const queryPlan: QueryPlanNode = {
    type: 'query',
    args: {
      type: 'templateSql',
      fragments: [
        { type: 'stringChunk', chunk: 'SELECT * FROM users WHERE "id" IN ' },
        { type: 'parameterTuple', itemPrefix: '', itemSeparator: ',', itemSuffix: '' },
      ],
      placeholderFormat: {
        prefix: '$',
        hasNumbering: true,
      } satisfies PlaceholderFormat,
      args: [[1, 2, 3, 4]],
      argTypes: [{ arity: 'scalar', scalarType: 'int' }],
      chunkable: true,
    },
  }

  const result = await interpreter.run(queryPlan, {
    queryable,
    transactionManager: { enabled: false },
    scope: {},
  })

  expect(call).toBe(2)
  expect(result).toHaveLength(rowsPerLaterChunk)
})

// Loading sibling relations concurrently is intentional: adapters whose connection
// cannot run queries concurrently (e.g. a single pg connection) are responsible for
// serializing them in `performIO` (see https://github.com/prisma/prisma/issues/29407).
// This pins the interpreter side of that contract so join loading stays parallel.
test('loads join children in parallel', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const queryable: SqlQueryable = {
    provider: 'postgres',
    adapterName: 'test',
    queryRaw: async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await timers.setImmediate()
      inFlight--
      return userResultSet(1, 'Alice')
    },
    executeRaw: () => Promise.resolve(0),
  }

  const joinChild = (parentField: string): Extract<QueryPlanNode, { type: 'join' }>['args']['children'][number] => ({
    child: queryNode(`SELECT * FROM ${parentField}`),
    on: [['id', 'id']],
    parentField,
    isRelationUnique: true,
  })

  const queryPlan: QueryPlanNode = {
    type: 'join',
    args: {
      parent: queryNode('SELECT * FROM users'),
      children: [joinChild('posts'), joinChild('profile'), joinChild('settings')],
      canAssumeStrictEquality: true,
    },
  }

  const interpreter = QueryInterpreter.forSql({ tracingHelper: noopTracingHelper })
  await interpreter.run(queryPlan, { queryable, transactionManager: { enabled: false }, scope: {} })

  expect(maxInFlight).toBe(3)
})

class MockTransactionAdapter implements SqlDriverAdapter {
  adapterName = 'mock-adapter'
  provider = 'postgres' as const

  startTransactionMock = vi.fn()
  commitMock = vi.fn().mockResolvedValue(undefined)
  rollbackMock = vi.fn().mockResolvedValue(undefined)
  txExecuteRawMock = vi.fn().mockResolvedValue(1)
  txQueryRawMock = vi.fn().mockImplementation(() => Promise.resolve(resultSetWithRows(1)))
  executeRawMock = vi.fn().mockResolvedValue(1)
  queryRawMock = vi.fn().mockImplementation(() => Promise.resolve(resultSetWithRows(1)))

  executeRaw(query: SqlQuery): Promise<number> {
    return this.executeRawMock(query)
  }

  queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    return this.queryRawMock(query)
  }

  executeScript(): Promise<void> {
    throw new Error('Not implemented for test')
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }

  startTransaction(): Promise<Transaction> {
    this.startTransactionMock()
    return Promise.resolve({
      adapterName: this.adapterName,
      provider: this.provider,
      options: { usePhantomQuery: true },
      executeRaw: this.txExecuteRawMock,
      queryRaw: this.txQueryRawMock,
      commit: this.commitMock,
      rollback: this.rollbackMock,
      createSavepoint: () => Promise.resolve(),
      rollbackToSavepoint: () => Promise.resolve(),
      releaseSavepoint: () => Promise.resolve(),
    })
  }
}

function makeTransactionManager(driverAdapter: SqlDriverAdapter): TransactionManager {
  return new TransactionManager({
    driverAdapter,
    transactionOptions: {},
    tracingHelper: noopTracingHelper,
  })
}

// The plans below get split into two chunks: `maxBindValues` is 2 and four values are bound.
const chunkedInterpreter = QueryInterpreter.forSql({
  tracingHelper: noopTracingHelper,
  connectionInfo: { maxBindValues: 2, supportsRelationJoins: false },
})

function statementNode(type: 'query' | 'execute', args: number[]): QueryPlanNode {
  return {
    type,
    args: {
      type: 'templateSql',
      fragments: [
        { type: 'stringChunk', chunk: 'DELETE FROM users WHERE "id" IN ' },
        { type: 'parameterTuple', itemPrefix: '', itemSeparator: ',', itemSuffix: '' },
      ],
      placeholderFormat: {
        prefix: '$',
        hasNumbering: true,
      } satisfies PlaceholderFormat,
      args: [args],
      argTypes: [{ arity: 'scalar', scalarType: 'int' }],
      chunkable: true,
    },
  }
}

// A statement that gets split into multiple chunks is no longer atomic on its own, so the
// interpreter must wrap the chunks in a transaction to avoid committing a partial write when
// a later chunk fails (see https://github.com/prisma/prisma-engines/pull/5840).
test('wraps a chunked execute in a transaction', async () => {
  const adapter = new MockTransactionAdapter()

  const result = await chunkedInterpreter.run(statementNode('execute', [1, 2, 3, 4]), {
    queryable: adapter,
    transactionManager: { enabled: true, manager: makeTransactionManager(adapter) },
    scope: {},
  })

  expect(result).toBe(2)
  expect(adapter.startTransactionMock).toHaveBeenCalledTimes(1)
  expect(adapter.txExecuteRawMock).toHaveBeenCalledTimes(2)
  expect(adapter.executeRawMock).not.toHaveBeenCalled()
  expect(adapter.commitMock).toHaveBeenCalledTimes(1)
  expect(adapter.rollbackMock).not.toHaveBeenCalled()
})

test('wraps a chunked query in a transaction', async () => {
  const adapter = new MockTransactionAdapter()

  const result = await chunkedInterpreter.run(statementNode('query', [1, 2, 3, 4]), {
    queryable: adapter,
    transactionManager: { enabled: true, manager: makeTransactionManager(adapter) },
    scope: {},
  })

  expect(result).toHaveLength(2)
  expect(adapter.startTransactionMock).toHaveBeenCalledTimes(1)
  expect(adapter.txQueryRawMock).toHaveBeenCalledTimes(2)
  expect(adapter.queryRawMock).not.toHaveBeenCalled()
  expect(adapter.commitMock).toHaveBeenCalledTimes(1)
})

test('rolls back the chunk transaction when a later chunk fails', async () => {
  const adapter = new MockTransactionAdapter()
  adapter.txExecuteRawMock.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('chunk failed'))

  await expect(
    chunkedInterpreter.run(statementNode('execute', [1, 2, 3, 4]), {
      queryable: adapter,
      transactionManager: { enabled: true, manager: makeTransactionManager(adapter) },
      scope: {},
    }),
  ).rejects.toThrow('chunk failed')

  expect(adapter.txExecuteRawMock).toHaveBeenCalledTimes(2)
  expect(adapter.commitMock).not.toHaveBeenCalled()
  expect(adapter.rollbackMock).toHaveBeenCalledTimes(1)
})

test('does not start a transaction for a single-chunk statement', async () => {
  const adapter = new MockTransactionAdapter()

  const result = await chunkedInterpreter.run(statementNode('execute', [1, 2]), {
    queryable: adapter,
    transactionManager: { enabled: true, manager: makeTransactionManager(adapter) },
    scope: {},
  })

  expect(result).toBe(1)
  expect(adapter.startTransactionMock).not.toHaveBeenCalled()
  expect(adapter.executeRawMock).toHaveBeenCalledTimes(1)
})

test('does not start a nested transaction for chunked statements inside a transaction node', async () => {
  const adapter = new MockTransactionAdapter()

  const plan: QueryPlanNode = { type: 'transaction', args: statementNode('execute', [1, 2, 3, 4]) }
  const result = await chunkedInterpreter.run(plan, {
    queryable: adapter,
    transactionManager: { enabled: true, manager: makeTransactionManager(adapter) },
    scope: {},
  })

  expect(result).toBe(2)
  expect(adapter.startTransactionMock).toHaveBeenCalledTimes(1)
  expect(adapter.txExecuteRawMock).toHaveBeenCalledTimes(2)
  expect(adapter.commitMock).toHaveBeenCalledTimes(1)
})

test('rethrows the original chunk error when the rollback fails as well', async () => {
  const adapter = new MockTransactionAdapter()
  adapter.txExecuteRawMock.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('chunk failed'))
  adapter.rollbackMock.mockRejectedValue(new Error('rollback failed'))

  await expect(
    chunkedInterpreter.run(statementNode('execute', [1, 2, 3, 4]), {
      queryable: adapter,
      transactionManager: { enabled: true, manager: makeTransactionManager(adapter) },
      scope: {},
    }),
  ).rejects.toThrow('chunk failed')

  expect(adapter.rollbackMock).toHaveBeenCalledTimes(1)
})

// Executors pass `transactionManager: { enabled: false }` exactly when the plan runs inside an
// interactive transaction, with that transaction as the queryable, so the chunks are already
// covered by it.
test('runs chunked statements directly when already inside an interactive transaction', async () => {
  const adapter = new MockTransactionAdapter()

  const result = await chunkedInterpreter.run(statementNode('execute', [1, 2, 3, 4]), {
    queryable: adapter,
    transactionManager: { enabled: false },
    scope: {},
  })

  expect(result).toBe(2)
  expect(adapter.startTransactionMock).not.toHaveBeenCalled()
  expect(adapter.executeRawMock).toHaveBeenCalledTimes(2)
})

test('run() leaves a shared query plan intact between runs', async () => {
  const plan: QueryPlanNode = {
    type: 'unique',
    args: queryNode('SELECT "id", "name" FROM "User" WHERE "id" = 1'),
  }
  const original = structuredClone(plan)

  const queryable = {
    provider: 'postgres' as const,
    adapterName: 'mock',
    queryRaw: vi.fn().mockResolvedValueOnce(userResultSet(1, 'Alice')).mockResolvedValueOnce(userResultSet(2, 'Bob')),
    executeRaw: vi.fn(),
  }

  const interpreter = QueryInterpreter.forSql({ tracingHelper: noopTracingHelper })
  const options: QueryRuntimeOptions = { queryable, transactionManager: { enabled: false }, scope: {} }

  await expect(interpreter.run(plan, options)).resolves.toEqual({ id: 1, name: 'Alice' })
  await expect(interpreter.run(plan, options)).resolves.toEqual({ id: 2, name: 'Bob' })

  expect(queryable.queryRaw).toHaveBeenCalledTimes(2)
  expect(plan).toEqual(original)
})

describe('purifyQueryPlan', () => {
  test('substitutes the single impure node without mutating the input plan', async () => {
    const query = queryNode('SELECT "id" FROM "User" LIMIT 1')
    const plan: QueryPlanNode = { type: 'unique', args: query }
    const original = structuredClone(plan)

    const evalNode = vi.fn().mockResolvedValue({ value: [{ id: 1 }], lastInsertId: '1' })
    const purified = await purifyQueryPlan(plan, evalNode)

    expect(evalNode).toHaveBeenCalledTimes(1)
    expect(evalNode).toHaveBeenCalledWith(query)
    expect(purified).toEqual({
      type: 'unique',
      args: { type: 'value', args: [{ id: 1 }], lastInsertId: '1' },
    })
    expect(plan).toEqual(original)
  })

  test('shares unaffected subtrees with the input plan', async () => {
    const sibling: QueryPlanNode = { type: 'value', args: 1 }
    const plan: QueryPlanNode = {
      type: 'seq',
      args: [sibling, { type: 'unique', args: queryNode('SELECT 1') }],
    }

    const purified = await purifyQueryPlan(plan, vi.fn().mockResolvedValue({ value: 2 }))

    expect(purified?.type).toBe('seq')
    if (purified?.type === 'seq') {
      expect(purified.args[0]).toBe(sibling)
    }
  })

  test('returns undefined when the plan contains a transaction node', () => {
    const plan: QueryPlanNode = {
      type: 'seq',
      args: [{ type: 'transaction', args: queryNode('INSERT INTO "User" DEFAULT VALUES') }, queryNode('SELECT 1')],
    }

    const evalNode = vi.fn()
    expect(purifyQueryPlan(plan, evalNode)).toBeUndefined()
    expect(evalNode).not.toHaveBeenCalled()
  })

  test('returns undefined when the plan contains multiple impure nodes', () => {
    const plan: QueryPlanNode = {
      type: 'seq',
      args: [queryNode('SELECT 1'), queryNode('SELECT 2')],
    }

    expect(purifyQueryPlan(plan, vi.fn())).toBeUndefined()
  })

  test('returns undefined for fully pure plans', () => {
    const plan: QueryPlanNode = { type: 'value', args: 42 }

    expect(purifyQueryPlan(plan, vi.fn())).toBeUndefined()
  })
})
