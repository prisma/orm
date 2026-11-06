import timers from 'node:timers/promises'

import { getLogs } from '@prisma/debug'
import type { SqlQuery } from '@prisma/driver-adapter-utils'
import pg, { DatabaseError } from 'pg'
import { describe, expect, it, vi } from 'vitest'

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

describe('query serialization', () => {
  const query = (sql: string): SqlQuery => ({ sql, args: [], argTypes: [] })
  const emptyResult = { rows: [], fields: [], rowCount: 0 }

  function trackingQueryMock() {
    let inFlight = 0
    let maxInFlight = 0
    const started: string[] = []
    const mock = vi.fn(async ({ text }: { text: string }) => {
      started.push(text)
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await timers.setImmediate()
      inFlight--
      return emptyResult
    })
    return { mock, started, maxInFlight: () => maxInFlight }
  }

  async function connectedAdapter() {
    const factory = new PrismaPgAdapterFactory('postgresql://test:test@localhost:5432/test')
    return await factory.connect()
  }

  it('serializes concurrent queries on a transaction connection', async () => {
    const adapter = await connectedAdapter()
    const { mock, maxInFlight } = trackingQueryMock()
    const mockConnection = { on: vi.fn(), removeListener: vi.fn(), query: mock, release: vi.fn() }
    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    await Promise.all([
      transaction.queryRaw(query('SELECT 1')),
      transaction.queryRaw(query('SELECT 2')),
      transaction.queryRaw(query('SELECT 3')),
    ])

    // A pg.PoolClient is a single connection: queries must never overlap.
    expect(maxInFlight()).toBe(1)
    await transaction.commit()
    await adapter.dispose()
  })

  it('does not serialize queries on the pool', async () => {
    const adapter = await connectedAdapter()
    const { mock, maxInFlight } = trackingQueryMock()
    adapter['client'].query = mock

    await Promise.all([
      adapter.queryRaw(query('SELECT 1')),
      adapter.queryRaw(query('SELECT 2')),
      adapter.queryRaw(query('SELECT 3')),
    ])

    // The pool handles concurrency itself; serializing here would limit the
    // whole application to one query at a time.
    expect(maxInFlight()).toBe(3)
    await adapter.dispose()
  })

  it('keeps serializing after a failed query', async () => {
    const adapter = await connectedAdapter()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(emptyResult) // BEGIN
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(emptyResult)
    const mockConnection = { on: vi.fn(), removeListener: vi.fn(), query: mock, release: vi.fn() }
    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const tx = await adapter.startTransaction()
    const failing = tx.queryRaw(query('SELECT 1'))
    const following = tx.queryRaw(query('SELECT 2'))

    await expect(failing).rejects.toThrow()
    await expect(following).resolves.toBeDefined()
    await adapter.dispose()
  })
})
