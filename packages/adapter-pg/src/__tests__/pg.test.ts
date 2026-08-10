import { getLogs } from '@prisma/debug'
import type { SqlQuery } from '@prisma/driver-adapter-utils'
import pg, { DatabaseError } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PrismaPgAdapterFactory } from '../pg'

describe('PrismaPgAdapterFactory', () => {
  it('should subscribe to pool error events', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    const shutdownError = new DatabaseError('terminating connection due to administrator command', 116, 'error')
    shutdownError.severity = 'FATAL'
    shutdownError.code = '57P01'
    shutdownError.routine = 'ProcessInterrupts'
    shutdownError.line = '3197'
    shutdownError.file = 'postgres.c'

    adapter['client'].emit('error', shutdownError)
    await adapter.dispose()
    const debug = getLogs()
    expect(debug).toContain('terminating connection due to administrator command')
  })

  it('should call onPoolError when supplied', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const onPoolError = vi.fn()
    const factory = new PrismaPgAdapterFactory(config, { onPoolError })
    const adapter = await factory.connect()
    const error = new Error('Pool error')
    adapter['client'].emit('error', error)
    expect(onPoolError).toHaveBeenCalledWith(error)
    await adapter.dispose()
  })

  it('should accept a connection string URL', async () => {
    const connectionString = 'postgresql://test:test@localhost:5432/test'
    const factory = new PrismaPgAdapterFactory(connectionString)

    expect((factory as any).config).toEqual({ connectionString })

    const adapter = await factory.connect()
    expect(adapter.underlyingDriver().options.connectionString).toBe(connectionString)
    await adapter.dispose()
  })

  it('should add and remove error event listener when using an external Pool', async () => {
    const pool = new pg.Pool({ user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' })
    pool.on('error', () => {})
    const factory = new PrismaPgAdapterFactory(pool)
    const adapter = await factory.connect()
    expect(adapter).toBeDefined()
    expect(adapter.adapterName).toBeDefined()
    expect(pool.listenerCount('error')).toEqual(2)
    await adapter.dispose()
    expect(pool.listenerCount('error')).toEqual(1)
    await pool.end()
  })

  it('should remove connection error listener after transaction commit', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(1),
    }

    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    expect(mockConnection.listenerCount('error')).toEqual(1)

    mockConnection.listenerCount.mockReturnValue(0)
    await transaction.commit()
    expect(mockConnection.removeListener).toHaveBeenCalledWith('error', expect.any(Function))
    expect(mockConnection.listenerCount('error')).toEqual(0)

    await adapter.dispose()
  })

  it('should remove connection error listener after transaction rollback', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(1),
    }

    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    expect(mockConnection.listenerCount('error')).toEqual(1)

    mockConnection.listenerCount.mockReturnValue(0)
    await transaction.rollback()
    expect(mockConnection.removeListener).toHaveBeenCalledWith('error', expect.any(Function))
    expect(mockConnection.listenerCount('error')).toEqual(0)

    await adapter.dispose()
  })

  it('should pass generated name when statement name generator is provided', async () => {
    const mockGenerator = vi.fn(() => 'test-name')
    const factory = new PrismaPgAdapterFactory('postgresql://test:test@localhost/test', {
      statementNameGenerator: mockGenerator,
    })
    const adapter = await factory.connect()

    const mockQuery = vi.fn().mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
    })
    adapter['client'].query = mockQuery

    const query: SqlQuery = { sql: 'SELECT 1', args: [], argTypes: [] }
    await adapter.queryRaw(query)

    expect(mockGenerator).toHaveBeenCalledWith(query)
    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ name: 'test-name' }))

    await adapter.dispose()
  })

  it('should not pass name when statement name generator is not provided', async () => {
    const factory = new PrismaPgAdapterFactory('postgresql://test:test@localhost/test')
    const adapter = await factory.connect()

    const mockQuery = vi.fn().mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
    })
    adapter['client'].query = mockQuery

    const query: SqlQuery = { sql: 'SELECT 1', args: [], argTypes: [] }
    await adapter.queryRaw(query)

    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ name: undefined }))

    await adapter.dispose()
  })
})

describe('PgTransaction', () => {
  // Regression tests for https://github.com/prisma/prisma/issues/29952: when an
  // interactive transaction timeout expires while COMMIT is in flight, the query
  // engine settles the transaction twice (the abandoned commit chain and the
  // compensating rollback), which must not release the pooled client twice or
  // dispatch SQL on a client the pool may have re-lent.
  //
  // No database is needed: pg.Client's connect/query/end are stubbed and the
  // engine's settlement sequences are scripted directly against the adapter.

  const statements: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setup(queryImpl?: (text: string) => Promise<unknown> | undefined) {
    statements.length = 0

    vi.spyOn(pg.Client.prototype, 'connect').mockImplementation(function (cb?: (err?: Error) => void) {
      process.nextTick(() => cb?.())
    } as never)
    vi.spyOn(pg.Client.prototype, 'end').mockImplementation((() => Promise.resolve()) as never)
    vi.spyOn(pg.Client.prototype, 'query').mockImplementation(((query: string | { text: string }) => {
      const text = typeof query === 'string' ? query : query.text
      statements.push(text)
      return queryImpl?.(text) ?? Promise.resolve({ rowCount: 0, rows: [], fields: [] })
    }) as never)

    const pool = new pg.Pool({
      connectionString: 'postgresql://user:pass@localhost:5432/db',
      max: 1,
    })
    const releases: unknown[] = []
    pool.on('release', (err) => releases.push(err))
    const adapter = await new PrismaPgAdapterFactory(pool).connect()

    return { pool, adapter, releases }
  }

  it('should release the client exactly once when COMMIT is sent before commit()', async () => {
    const { pool, adapter, releases } = await setup()
    const tx = await adapter.startTransaction()

    await tx.executeRaw({ sql: 'COMMIT', args: [], argTypes: [] })
    await tx.commit()

    expect(statements).toEqual(['BEGIN', 'COMMIT'])
    expect(releases).toEqual([undefined])
    expect(pool.idleCount).toBe(1)
    expect(pool.totalCount).toBe(1)
  })

  it('should treat the second settlement as a no-op instead of releasing twice', async () => {
    const { pool, adapter, releases } = await setup()
    const tx = await adapter.startTransaction()

    await tx.commit()
    await expect(tx.rollback()).resolves.toBeUndefined()

    expect(releases).toEqual([undefined])
    expect(pool.idleCount).toBe(1)
    expect(pool.totalCount).toBe(1)
  })

  it('should not release a client the pool has re-lent to a new owner', async () => {
    const { pool, adapter } = await setup()
    const tx = await adapter.startTransaction()

    // The engine's compensation sequence when the transaction deadline drops an
    // in-flight commit: rollback wins first, the pool re-lends the client, then
    // the orphaned commit chain lands late.
    await tx.rollback()
    const nextOwner = await pool.connect()
    await tx.commit()

    expect(() => nextOwner.release()).not.toThrow()
    expect(pool.idleCount).toBe(1)
    expect(pool.totalCount).toBe(1)
  })

  it('should reject queries after settlement without dispatching SQL', async () => {
    const { adapter } = await setup()
    const tx = await adapter.startTransaction()

    await tx.rollback()
    statements.length = 0

    await expect(tx.executeRaw({ sql: 'ROLLBACK', args: [], argTypes: [] })).rejects.toMatchObject({
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionAlreadyClosed' },
    })
    await expect(tx.queryRaw({ sql: 'SELECT 1', args: [], argTypes: [] })).rejects.toMatchObject({
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionAlreadyClosed' },
    })
    expect(statements).toEqual([])
  })

  it('should destroy the connection when settling with a query still in flight', async () => {
    const { pool, adapter, releases } = await setup((text) =>
      text === 'SELECT pending' ? new Promise(() => {}) : undefined,
    )
    const tx = await adapter.startTransaction()

    void tx.executeRaw({ sql: 'SELECT pending', args: [], argTypes: [] })
    await tx.rollback()

    expect(releases).toEqual([expect.any(Error)])
    expect(pool.totalCount).toBe(0)
  })
})
