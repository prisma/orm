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

  describe('releasing the connection after a transaction', () => {
    const sql = (text: string): SqlQuery => ({ sql: text, args: [], argTypes: [] })

    async function startTransaction(query: ReturnType<typeof vi.fn>) {
      const config: pg.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
      const adapter = await new PrismaPgAdapterFactory(config).connect()
      const mockConnection = {
        on: vi.fn(),
        removeListener: vi.fn(),
        query,
        release: vi.fn(),
      }
      adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)
      const transaction = await adapter.startTransaction()
      return { adapter, transaction, mockConnection }
    }

    const timeoutOn = (statement: string) =>
      vi.fn(({ text }: { text: string }) =>
        text === statement
          ? Promise.reject(new Error('Query read timeout'))
          : Promise.resolve({ rows: [], rowCount: 0 }),
      )

    it('returns the connection to the pool after a ROLLBACK that resolved', async () => {
      const { adapter, transaction, mockConnection } = await startTransaction(timeoutOn('never'))

      await transaction.executeRaw(sql('ROLLBACK'))
      await transaction.rollback()

      expect(mockConnection.release).toHaveBeenCalledWith()
      await adapter.dispose()
    })

    it('destroys the connection when the ROLLBACK did not resolve', async () => {
      const { adapter, transaction, mockConnection } = await startTransaction(timeoutOn('ROLLBACK'))

      await expect(transaction.executeRaw(sql('ROLLBACK'))).rejects.toThrow()
      await transaction.rollback()

      expect(mockConnection.release).toHaveBeenCalledWith(expect.any(Error))
      await adapter.dispose()
    })

    it('destroys the connection when the COMMIT did not resolve', async () => {
      const { adapter, transaction, mockConnection } = await startTransaction(timeoutOn('COMMIT'))

      await expect(transaction.executeRaw(sql('COMMIT'))).rejects.toThrow()
      await transaction.rollback()

      expect(mockConnection.release).toHaveBeenCalledWith(expect.any(Error))
      await adapter.dispose()
    })

    it('destroys the connection when a ROLLBACK sent through queryRaw did not resolve', async () => {
      const { adapter, transaction, mockConnection } = await startTransaction(timeoutOn('ROLLBACK'))

      await expect(transaction.queryRaw(sql('ROLLBACK'))).rejects.toThrow()
      await transaction.rollback()

      expect(mockConnection.release).toHaveBeenCalledWith(expect.any(Error))
      await adapter.dispose()
    })

    it.each(['rollback work', 'ROLLBACK TRANSACTION', 'COMMIT AND NO CHAIN', 'END', 'ABORT;'])(
      'destroys the connection when %s did not resolve',
      async (statement) => {
        const { adapter, transaction, mockConnection } = await startTransaction(timeoutOn(statement))

        await expect(transaction.executeRaw(sql(statement))).rejects.toThrow()
        await transaction.rollback()

        expect(mockConnection.release).toHaveBeenCalledWith(expect.any(Error))
        await adapter.dispose()
      },
    )

    it('keeps the connection when only a ROLLBACK TO SAVEPOINT failed', async () => {
      const { adapter, transaction, mockConnection } = await startTransaction(timeoutOn('ROLLBACK TO SAVEPOINT s1'))

      await expect(transaction.rollbackToSavepoint!('s1')).rejects.toThrow()
      await transaction.executeRaw(sql('ROLLBACK'))
      await transaction.rollback()

      expect(mockConnection.release).toHaveBeenCalledWith()
      await adapter.dispose()
    })
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
