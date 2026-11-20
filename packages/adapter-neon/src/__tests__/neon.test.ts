import * as neon from '@neondatabase/serverless'
import { getLogs } from '@prisma/debug'
import type { SqlQuery } from '@prisma/driver-adapter-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PrismaNeonAdapterFactory, PrismaNeonHttpAdapter } from '../neon'

describe('PrismaNeonAdapterFactory', () => {
  it('should subscribe to pool error events', async () => {
    const config: neon.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaNeonAdapterFactory(config)
    const adapter = await factory.connect()

    const shutdownError = new neon.DatabaseError('terminating connection due to administrator command', 116, 'error')
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
    const config: neon.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const onPoolError = vi.fn()
    const factory = new PrismaNeonAdapterFactory(config, { onPoolError })
    const adapter = await factory.connect()
    const error = new Error('Pool error')
    adapter['client'].emit('error', error)
    expect(onPoolError).toHaveBeenCalledWith(error)
    await adapter.dispose()
  })

  it('should remove connection error listener after transaction commit', async () => {
    const config: neon.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaNeonAdapterFactory(config)
    const adapter = await factory.connect()

    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }

    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    await transaction.commit()
    expect(mockConnection.removeListener).toHaveBeenCalledWith('error', expect.any(Function))

    await adapter.dispose()
  })

  it('should remove connection error listener after transaction rollback', async () => {
    const config: neon.PoolConfig = { user: 'test', password: 'test', database: 'test', port: 5432, host: 'localhost' }
    const factory = new PrismaNeonAdapterFactory(config)
    const adapter = await factory.connect()

    const mockConnection = {
      on: vi.fn(),
      removeListener: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }

    adapter['client'].connect = vi.fn().mockResolvedValue(mockConnection)

    const transaction = await adapter.startTransaction()
    await transaction.rollback()
    expect(mockConnection.removeListener).toHaveBeenCalledWith('error', expect.any(Function))

    await adapter.dispose()
  })
})

describe('NeonTransaction', () => {
  // Regression tests for https://github.com/prisma/prisma/issues/29952: closing a
  // transaction twice must not release the pooled client twice, and no SQL may be
  // sent on a client the pool may have lent to someone else.
  //
  // No database is needed: neon.Client's connect/query/end are stubbed, and the
  // real neon.Pool manages the clients.

  const statements: string[] = []
  const pools: neon.Pool[] = []

  afterEach(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
    pools.length = 0
    vi.restoreAllMocks()
  })

  async function setup(queryImpl?: (text: string) => Promise<unknown> | undefined) {
    statements.length = 0

    vi.spyOn(neon.Client.prototype, 'connect').mockImplementation(function (cb?: (err?: Error) => void) {
      process.nextTick(() => cb?.())
    } as never)
    vi.spyOn(neon.Client.prototype, 'end').mockImplementation((() => Promise.resolve()) as never)
    vi.spyOn(neon.Client.prototype, 'query').mockImplementation(((query: string | { text: string }) => {
      const text = typeof query === 'string' ? query : query.text
      statements.push(text)
      return queryImpl?.(text) ?? Promise.resolve({ rowCount: 0, rows: [], fields: [] })
    }) as never)

    const adapter = await new PrismaNeonAdapterFactory({
      connectionString: 'postgresql://user:pass@localhost:5432/db',
      max: 1,
    }).connect()
    const pool = adapter.underlyingDriver()
    pools.push(pool)
    const releases: unknown[] = []
    pool.on('release', (err) => releases.push(err))

    return { pool, adapter, releases }
  }

  it('should treat a second close as a no-op instead of releasing twice', async () => {
    const { pool, adapter, releases } = await setup()
    const tx = await adapter.startTransaction()

    await tx.commit()
    await expect(tx.rollback()).resolves.toBeUndefined()

    expect(releases).toEqual([undefined])
    expect(pool.idleCount).toBe(1)
    expect(pool.totalCount).toBe(1)
  })

  it('should not release a client the pool has lent to a new owner', async () => {
    const { pool, adapter } = await setup()
    const tx = await adapter.startTransaction()

    await tx.rollback()
    const nextOwner = await pool.connect()
    await tx.commit()

    expect(() => nextOwner.release()).not.toThrow()
    expect(pool.idleCount).toBe(1)
    expect(pool.totalCount).toBe(1)
  })

  it('should reject statements and savepoint calls after close without sending SQL', async () => {
    const { adapter } = await setup()
    const tx = await adapter.startTransaction()

    await tx.rollback()
    statements.length = 0

    const closed = { name: 'DriverAdapterError', cause: { kind: 'TransactionAlreadyClosed' } }
    await expect(tx.executeRaw({ sql: 'ROLLBACK', args: [], argTypes: [] })).rejects.toMatchObject(closed)
    await expect(tx.queryRaw({ sql: 'SELECT 1', args: [], argTypes: [] })).rejects.toMatchObject(closed)
    await expect(tx.createSavepoint!('sp')).rejects.toMatchObject(closed)
    await expect(tx.rollbackToSavepoint!('sp')).rejects.toMatchObject(closed)
    await expect(tx.releaseSavepoint!('sp')).rejects.toMatchObject(closed)
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

  it('should release the client even when removing the error listener throws', async () => {
    const { pool, adapter, releases } = await setup()
    const acquired: neon.PoolClient[] = []
    pool.once('acquire', (client) => acquired.push(client))
    const tx = await adapter.startTransaction()
    vi.spyOn(acquired[0], 'removeListener').mockImplementationOnce(() => {
      throw new Error('removeListener failed')
    })

    await expect(tx.commit()).rejects.toThrow('removeListener failed')

    expect(releases).toEqual([undefined])
    expect(pool.idleCount).toBe(1)
  })
})

describe('PrismaNeonHttpAdapter', () => {
  it('maps args through mapArg before passing them to the HTTP client', async () => {
    const mockClient = vi.fn().mockResolvedValue({ fields: [], rows: [], rowCount: 0 })
    const adapter = new PrismaNeonHttpAdapter(mockClient as unknown as neon.NeonQueryFunction<any, any>)

    // a base64-encoded `Bytes` arg, as the query engine hands it to the adapter
    const bytesBase64 = Buffer.from('hello-raw-bytes').toString('base64')

    const query: SqlQuery = {
      sql: 'INSERT INTO "Thing" ("blob") VALUES ($1)',
      args: [bytesBase64],
      argTypes: [{ scalarType: 'bytes', arity: 'scalar' }],
    }

    await adapter.performIO(query)

    const [, values] = mockClient.mock.calls[0]
    expect(values[0]).toBeInstanceOf(Buffer)
    expect((values[0] as Buffer).toString('utf-8')).toBe('hello-raw-bytes')
    // the unmapped base64 string must not be what's sent to the driver
    expect(values[0]).not.toBe(bytesBase64)
  })

  it('maps a DateTime arg to a UTC timestamp string, not the process-local offset', async () => {
    const mockClient = vi.fn().mockResolvedValue({ fields: [], rows: [], rowCount: 0 })
    const adapter = new PrismaNeonHttpAdapter(mockClient as unknown as neon.NeonQueryFunction<any, any>)

    // the query engine hands DateTime args over as ISO strings
    const isoDate = '2023-01-01T12:00:00.000Z'

    const query: SqlQuery = {
      sql: 'INSERT INTO "Thing" ("date") VALUES ($1)',
      args: [isoDate],
      argTypes: [{ scalarType: 'datetime', arity: 'scalar' }],
    }

    await adapter.performIO(query)

    const [, values] = mockClient.mock.calls[0]
    // formatDateTime renders the UTC wall-clock value with no offset suffix, unlike the
    // driver's default `Date#toISOString`/`prepareValue`-style local-offset serialization
    expect(values[0]).toBe('2023-01-01 12:00:00')
  })
})
