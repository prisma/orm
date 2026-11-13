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
  const pools: pg.Pool[] = []

  afterEach(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
    pools.length = 0
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
    pools.push(pool)
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

  it('should destroy the connection when closing with a statement still running', async () => {
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
