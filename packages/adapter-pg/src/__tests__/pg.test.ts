import { getLogs } from '@prisma/debug'
import { DriverAdapterError, type SqlQuery } from '@prisma/driver-adapter-utils'
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

  it.each(['commit', 'rollback'] as const)(
    'should release connection with the client error after %s when a query failed with a non-server error',
    async (method) => {
      const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
      const factory = new PrismaPgAdapterFactory(config)
      const adapter = await factory.connect()

      const queryError = new Error('Query read timeout')
      const mockConnection = {
        on: vi.fn(),
        removeListener: vi.fn(),
        query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockRejectedValueOnce(queryError),
        release: vi.fn(),
        listenerCount: vi.fn().mockReturnValue(0),
      }
      adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

      const transaction = await adapter.startTransaction()
      await expect(transaction.executeRaw({ sql: 'SELECT 1', args: [], argTypes: [] })).rejects.toBe(queryError)

      await transaction[method]()
      expect(mockConnection.release).toHaveBeenCalledTimes(1)
      expect(mockConnection.release.mock.calls[0][0]).toBe(queryError)

      await adapter.dispose()
    },
  )

  it('should release connection without error after rollback when a query failed with a server error', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    const serverError = new DatabaseError('duplicate key value violates unique constraint', 0, 'error')
    serverError.severity = 'ERROR'
    serverError.code = '23505'

    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockRejectedValueOnce(serverError),
      release: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    }
    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    await expect(transaction.executeRaw({ sql: 'SELECT 1', args: [], argTypes: [] })).rejects.toBeInstanceOf(
      DriverAdapterError,
    )

    await transaction.rollback()
    expect(mockConnection.release).toHaveBeenCalledTimes(1)
    expect(mockConnection.release.mock.calls[0][0]).toBeUndefined()

    await adapter.dispose()
  })

  it('should release connection without error after commit when no query failed', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    }
    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    await transaction.commit()
    expect(mockConnection.release).toHaveBeenCalledTimes(1)
    expect(mockConnection.release.mock.calls[0][0]).toBeUndefined()

    await adapter.dispose()
  })

  it('should keep only the first non-server error for connection release', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    const firstError = new Error('Query read timeout')
    const secondError = new Error('Connection terminated unexpectedly')
    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockRejectedValueOnce(firstError)
        .mockRejectedValueOnce(secondError),
      release: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    }
    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    await expect(transaction.executeRaw({ sql: 'SELECT 1', args: [], argTypes: [] })).rejects.toBe(firstError)
    await expect(transaction.executeRaw({ sql: 'SELECT 2', args: [], argTypes: [] })).rejects.toBe(secondError)

    await transaction.commit()
    expect(mockConnection.release).toHaveBeenCalledTimes(1)
    expect(mockConnection.release.mock.calls[0][0]).toBe(firstError)

    await adapter.dispose()
  })

  it('should release connection with an Error wrapping a non-Error rejection after rollback', async () => {
    const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockRejectedValueOnce('connection lost'),
      release: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    }
    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    await expect(transaction.executeRaw({ sql: 'SELECT 1', args: [], argTypes: [] })).rejects.toBe('connection lost')

    await transaction.rollback()
    expect(mockConnection.release).toHaveBeenCalledTimes(1)
    expect(mockConnection.release.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(mockConnection.release.mock.calls[0][0]).toHaveProperty('message', 'connection lost')

    await adapter.dispose()
  })
})
