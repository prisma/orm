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

  it('should extract schema from connection string URL when not provided in options', async () => {
    const connectionString = 'postgresql://test:test@localhost:5432/test?schema=custom_schema'
    const factory = new PrismaPgAdapterFactory(connectionString)
    const adapter = await factory.connect()

    const connectionInfo = adapter.getConnectionInfo()
    expect(connectionInfo.schemaName).toBe('custom_schema')

    await adapter.dispose()
  })

  it('should prefer schema from options over connection string URL', async () => {
    const connectionString = 'postgresql://test:test@localhost:5432/test?schema=url_schema'
    const factory = new PrismaPgAdapterFactory(connectionString, { schema: 'options_schema' })
    const adapter = await factory.connect()

    const connectionInfo = adapter.getConnectionInfo()
    expect(connectionInfo.schemaName).toBe('options_schema')

    await adapter.dispose()
  })

  it('should set search_path via connection options when schema is configured', async () => {
    const factory = new PrismaPgAdapterFactory('postgresql://test:test@localhost:5432/test', {
      schema: 'custom_schema',
    })
    const adapter = await factory.connect()

    expect(adapter.underlyingDriver().options.options).toBe('-csearch_path=custom_schema')

    await adapter.dispose()
  })

  it('should append search_path to existing connection options', async () => {
    const factory = new PrismaPgAdapterFactory(
      { connectionString: 'postgresql://test:test@localhost:5432/test', options: '-cstatement_timeout=5000' },
      { schema: 'custom_schema' },
    )
    const adapter = await factory.connect()

    expect(adapter.underlyingDriver().options.options).toBe('-cstatement_timeout=5000 -csearch_path=custom_schema')

    await adapter.dispose()
  })

  it('should keep URL-level options and search_path in the effective startup options', async () => {
    const factory = new PrismaPgAdapterFactory({
      connectionString:
        'postgresql://test:test@localhost:5432/test?schema=url_schema&options=-cstatement_timeout%3D5000',
    })
    const adapter = await factory.connect()

    // `Pool.options.options` alone is not enough: `pg` re-parses `connectionString`
    // at connect time, so we assert the options the client would actually send.
    const { connectionParameters } = new pg.Client(adapter.underlyingDriver().options) as unknown as {
      connectionParameters: { options?: string }
    }
    expect(connectionParameters.options).toBe('-cstatement_timeout=5000 -csearch_path=url_schema')

    await adapter.dispose()
  })

  it('should set search_path from URL schema parameter', async () => {
    const factory = new PrismaPgAdapterFactory('postgresql://test:test@localhost:5432/test?schema=url_schema')
    const adapter = await factory.connect()

    expect(adapter.underlyingDriver().options.options).toBe('-csearch_path=url_schema')

    await adapter.dispose()
  })

  it('should extract schema from PoolConfig connectionString when not provided in options', async () => {
    const factory = new PrismaPgAdapterFactory({
      connectionString: 'postgresql://test:test@localhost:5432/test?schema=url_schema',
    })
    const adapter = await factory.connect()

    expect(adapter.getConnectionInfo().schemaName).toBe('url_schema')
    expect(adapter.underlyingDriver().options.options).toBe('-csearch_path=url_schema')

    await adapter.dispose()
  })

  it('should not set connection options when no schema is configured', async () => {
    const factory = new PrismaPgAdapterFactory('postgresql://test:test@localhost:5432/test')
    const adapter = await factory.connect()

    expect(adapter.underlyingDriver().options.options).toBeUndefined()

    await adapter.dispose()
  })

  it('should accept a libpq-style connection string without extracting a schema', async () => {
    const factory = new PrismaPgAdapterFactory('host=localhost port=5432 dbname=test user=test password=test')
    const adapter = await factory.connect()

    expect(adapter.getConnectionInfo().schemaName).toBeUndefined()
    expect(adapter.underlyingDriver().options.options).toBeUndefined()

    await adapter.dispose()
  })

  it('should not mutate the caller-provided PoolConfig', async () => {
    const config: pg.PoolConfig = {
      connectionString: 'postgresql://test:test@localhost:5432/test?schema=url_schema',
      options: '-cstatement_timeout=5000',
    }
    const factory = new PrismaPgAdapterFactory(config)
    const adapter = await factory.connect()

    expect(config.options).toBe('-cstatement_timeout=5000')
    expect(adapter.underlyingDriver().options.options).toBe('-cstatement_timeout=5000 -csearch_path=url_schema')

    await adapter.dispose()
  })

  it('should not modify config for external pools while honoring the explicit schema option', async () => {
    const pool = new pg.Pool({ user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' })
    pool.on('error', () => {})
    const factory = new PrismaPgAdapterFactory(pool, { schema: 'custom_schema' })
    const adapter = await factory.connect()

    expect(adapter.getConnectionInfo().schemaName).toBe('custom_schema')
    expect(adapter.underlyingDriver().options.options).toBeUndefined()

    await adapter.dispose()
    await pool.end()
  })

  it('should not extract schema from the connection string of an external pool', async () => {
    const pool = new pg.Pool({ connectionString: 'postgresql://test:test@localhost:5432/test?schema=url_schema' })
    pool.on('error', () => {})
    const factory = new PrismaPgAdapterFactory(pool)
    const adapter = await factory.connect()

    expect(adapter.getConnectionInfo().schemaName).toBeUndefined()
    expect(adapter.underlyingDriver().options.options).toBeUndefined()

    await adapter.dispose()
    await pool.end()
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
