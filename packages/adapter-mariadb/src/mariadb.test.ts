import * as mariadb from 'mariadb'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  inferCapabilities,
  PrismaMariaDbAdapter,
  PrismaMariaDbAdapterFactory,
  rewriteConnectionString,
} from './mariadb'

vi.mock('mariadb', () => ({
  createPool: vi.fn(),
}))

describe('PrismaMariaDbAdapterFactory constructor', () => {
  test.each([
    {
      config: {},
      expected: expect.objectContaining({ prepareCacheLength: 0, timezone: 'UTC' }),
    },
    {
      config: 'mariadb://user:pass@localhost:3306/db',
      expected: expect.stringContaining('prepareCacheLength=0'),
    },
  ])('should set prepareCacheLength to 0 when config has no prepareCacheLength', async ({ config, expected }) => {
    const mockCreatePool = vi.mocked(mariadb.createPool)
    mockCreatePool.mockReturnValue({
      query: vi.fn().mockResolvedValue([['8.0.13']]),
      end: vi.fn(),
    } as unknown as mariadb.Pool)

    const factory = new PrismaMariaDbAdapterFactory(config)
    await factory.connect()

    expect(mockCreatePool).toHaveBeenCalledWith(expected)
    mockCreatePool.mockClear()
  })

  test('forces timezone to UTC for object config to ensure UTC datetime strings', async () => {
    const mockCreatePool = vi.mocked(mariadb.createPool)
    mockCreatePool.mockReturnValue({
      query: vi.fn().mockResolvedValue([['8.0.13']]),
      end: vi.fn(),
    } as unknown as mariadb.Pool)

    const factory = new PrismaMariaDbAdapterFactory({ host: 'localhost', database: 'db' })
    await factory.connect()

    expect(mockCreatePool).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'UTC' }))
    mockCreatePool.mockClear()
  })

  test('forces timezone to UTC in connection string to ensure UTC datetime strings', async () => {
    const mockCreatePool = vi.mocked(mariadb.createPool)
    mockCreatePool.mockReturnValue({
      query: vi.fn().mockResolvedValue([['8.0.13']]),
      end: vi.fn(),
    } as unknown as mariadb.Pool)

    const factory = new PrismaMariaDbAdapterFactory('mariadb://user:pass@localhost:3306/db')
    await factory.connect()

    const calledWith = mockCreatePool.mock.calls[0][0] as string
    expect(calledWith).toContain('timezone=')
    expect(decodeURIComponent(calledWith)).toContain('timezone=UTC')
    mockCreatePool.mockClear()
  })

  test('overrides user-supplied timezone in connection string to enforce UTC', async () => {
    // mapRow appends 'Z' assuming UTC, so we must always enforce timezone=UTC regardless
    // of any value the user may have specified.
    const mockCreatePool = vi.mocked(mariadb.createPool)
    mockCreatePool.mockReturnValue({
      query: vi.fn().mockResolvedValue([['8.0.13']]),
      end: vi.fn(),
    } as unknown as mariadb.Pool)

    const factory = new PrismaMariaDbAdapterFactory('mariadb://user:pass@localhost:3306/db?timezone=%2B07%3A00')
    await factory.connect()

    const calledWith = mockCreatePool.mock.calls[0][0] as string
    expect(decodeURIComponent(calledWith)).toContain('timezone=UTC')
    mockCreatePool.mockClear()
  })

  test('overrides user-supplied timezone in object config to enforce UTC', async () => {
    // mapRow appends 'Z' assuming UTC, so timezone is always forced to UTC even when the
    // caller explicitly sets a different value in the pool config.
    const mockCreatePool = vi.mocked(mariadb.createPool)
    mockCreatePool.mockReturnValue({
      query: vi.fn().mockResolvedValue([['8.0.13']]),
      end: vi.fn(),
    } as unknown as mariadb.Pool)

    const factory = new PrismaMariaDbAdapterFactory({ host: 'localhost', database: 'db', timezone: '+07:00' })
    await factory.connect()

    expect(mockCreatePool).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'UTC' }))
    mockCreatePool.mockClear()
  })

  test.each([
    { config: { prepareCacheLength: 10 }, expected: expect.objectContaining({ prepareCacheLength: 10 }) },
    {
      config: 'mariadb://user:pass@localhost:3306/db?prepareCacheLength=10',
      expected: expect.stringContaining('prepareCacheLength=10'),
    },
  ])('set when is set', async ({ config, expected }) => {
    const mockCreatePool = vi.mocked(mariadb.createPool)
    mockCreatePool.mockReturnValue({
      query: vi.fn().mockResolvedValue([['8.0.13']]),
      end: vi.fn(),
    } as unknown as mariadb.Pool)

    const factory = new PrismaMariaDbAdapterFactory(config)
    await factory.connect()

    expect(mockCreatePool).toHaveBeenCalledWith(expected)
    mockCreatePool.mockClear()
  })
})

describe.each([
  ['8.0.12', { supportsRelationJoins: false }],
  ['8.0.13', { supportsRelationJoins: true }],
  ['8.1.0', { supportsRelationJoins: true }],
  ['8.4.5', { supportsRelationJoins: true }],
  ['8.4.13', { supportsRelationJoins: true }],
  ['11.4.7-MariaDB-ubu2404', { supportsRelationJoins: false }],
])('infer capabilities for %s', (version, capabilities) => {
  test(`inferCapabilities(${version})`, () => {
    expect(inferCapabilities(version)).toEqual(capabilities)
  })
})

describe('rewriteConnectionString', () => {
  test('should rewrite mysql:// to mariadb://', () => {
    const input = 'mysql://user:password@localhost:3306/database?ssl=true&connectionLimit=10&charset=utf8mb4'
    const expected = 'mariadb://user:password@localhost:3306/database?ssl=true&connectionLimit=10&charset=utf8mb4'
    expect(rewriteConnectionString(new URL(input)).toString()).toBe(expected)
  })

  test('should preserve mariadb:// connection strings', () => {
    const input = 'mariadb://user:pass@localhost:3306/db'
    expect(rewriteConnectionString(new URL(input)).toString()).toBe(input)
  })

  test.each([
    ['mariadb://user:pass@[::1]:3306/db', 'mariadb://user:pass@%3A%3A1:3306/db'],
    ['mariadb://user:pass@[::1]/db', 'mariadb://user:pass@%3A%3A1/db'],
    ['mysql://user:pass@[::1]:3306/db', 'mariadb://user:pass@%3A%3A1:3306/db'],
    [
      'mariadb://user:pass@[2001:db8::1]:3306/db?connectionLimit=10&ssl=true',
      'mariadb://user:pass@2001%3Adb8%3A%3A1:3306/db?connectionLimit=10&ssl=true',
    ],
  ])('should percent-encode the IPv6 host of %s', (input, expected) => {
    expect(rewriteConnectionString(new URL(input)).toString()).toBe(expected)
  })
})

describe('useTextProtocol option', () => {
  const flagToMethod = {
    true: 'query',
    false: 'execute',
  }

  test.each([false, undefined, true].map((flag) => ({ flag, method: flagToMethod[String(!!flag)] })))(
    'should use client.$method when useTextProtocol is $flag',
    async ({ flag, method }) => {
      const mockClient = {
        execute: vi.fn().mockResolvedValue({ meta: [], affectedRows: 1 }),
        query: vi.fn().mockResolvedValue({ meta: [], affectedRows: 1 }),
      } as unknown as mariadb.Pool

      const adapter = new PrismaMariaDbAdapter(mockClient, { supportsRelationJoins: true }, { useTextProtocol: flag })
      await adapter.executeRaw({ sql: 'SELECT 1', args: [], argTypes: [] })
      expect(mockClient[method]).toHaveBeenCalledWith(expect.objectContaining({ sql: 'SELECT 1' }), [])

      expect(mockClient[flagToMethod[String(!flag)]]).not.toHaveBeenCalled()
    },
  )
})

describe('PrismaMariaDbAdapterFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should accept a pool instance directly', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    const factory = new PrismaMariaDbAdapterFactory(mockPool as unknown as mariadb.Pool)
    const adapter = await factory.connect()

    expect(adapter).toBeDefined()
    expect(mockPool.query).toHaveBeenCalledWith({
      sql: 'SELECT VERSION()',
      rowsAsArray: true,
    })
  })

  test('should accept config object', () => {
    const config = {
      host: 'localhost',
      port: 3306,
      user: 'user',
      password: 'pass',
      database: 'db',
    }

    const factory = new PrismaMariaDbAdapterFactory(config)
    expect(factory).toBeDefined()
  })

  test('should accept mysql:// connection string', () => {
    const connectionString = 'mysql://user:pass@localhost:3306/db'
    const factory = new PrismaMariaDbAdapterFactory(connectionString)
    expect(factory).toBeDefined()
  })

  test('should accept mariadb:// connection string', () => {
    const connectionString = 'mariadb://user:pass@localhost:3306/db'
    const factory = new PrismaMariaDbAdapterFactory(connectionString)
    expect(factory).toBeDefined()
  })

  test('should not dispose external pool by default', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    const factory = new PrismaMariaDbAdapterFactory(mockPool as unknown as mariadb.Pool)
    const adapter = await factory.connect()
    await adapter.dispose()

    expect(mockPool.end).not.toHaveBeenCalled()
  })

  test('should dispose external pool when disposeExternalPool is true', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    const factory = new PrismaMariaDbAdapterFactory(mockPool as unknown as mariadb.Pool, { disposeExternalPool: true })
    const adapter = await factory.connect()
    await adapter.dispose()

    expect(mockPool.end).toHaveBeenCalled()
  })

  test('should throw when calling connect() again after disposing an external pool', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    const factory = new PrismaMariaDbAdapterFactory(mockPool as unknown as mariadb.Pool, { disposeExternalPool: true })
    const adapter = await factory.connect()
    await adapter.dispose()

    // Should throw when trying to connect again
    await expect(factory.connect()).rejects.toThrow(
      'connect() can only be called once when `disposeExternalPool` is true',
    )
  })

  test('should throw on a second connect() with disposeExternalPool before the first is disposed', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    const factory = new PrismaMariaDbAdapterFactory(mockPool as unknown as mariadb.Pool, { disposeExternalPool: true })
    await factory.connect()

    // The pool is still live here: a second adapter would end a pool the first one is using.
    await expect(factory.connect()).rejects.toThrow(
      'connect() can only be called once when `disposeExternalPool` is true',
    )
    expect(mockPool.end).not.toHaveBeenCalled()
  })

  test('should throw on a second connect() when disposing an external pool failed', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn().mockRejectedValue(new Error('pool shutdown failed')),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    const factory = new PrismaMariaDbAdapterFactory(mockPool as unknown as mariadb.Pool, { disposeExternalPool: true })
    const adapter = await factory.connect()
    await expect(adapter.dispose()).rejects.toThrow('pool shutdown failed')

    // The pool is in an indeterminate state, so it must not be handed to another adapter.
    await expect(factory.connect()).rejects.toThrow(
      'connect() can only be called once when `disposeExternalPool` is true',
    )
  })

  test('should allow multiple connect() calls when disposeExternalPool is false', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    const factory = new PrismaMariaDbAdapterFactory(mockPool as unknown as mariadb.Pool, { disposeExternalPool: false })

    const adapter1 = await factory.connect()
    await adapter1.dispose()

    // Should not throw when connecting again
    const adapter2 = await factory.connect()
    expect(adapter2).toBeDefined()

    // Both adapters should use the same pool
    expect(adapter1.underlyingDriver()).toBe(adapter2.underlyingDriver())

    // Pool should not be disposed
    expect(mockPool.end).not.toHaveBeenCalled()
  })

  test('should allow multiple connect() calls with config', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    // Mock createPool to return our mock pool
    vi.mocked(mariadb.createPool).mockReturnValue(mockPool as unknown as mariadb.Pool)

    const config = {
      host: 'localhost',
      port: 3306,
      user: 'user',
      password: 'pass',
      database: 'db',
    }

    const factory = new PrismaMariaDbAdapterFactory(config)

    const adapter1 = await factory.connect()
    expect(adapter1).toBeDefined()
    expect(mariadb.createPool).toHaveBeenCalledTimes(1)
    expect(mariadb.createPool).toHaveBeenCalledWith({ ...config, prepareCacheLength: 0, timezone: 'UTC' })

    await adapter1.dispose()
    expect(mockPool.end).toHaveBeenCalledTimes(1)

    // Should create a new pool for the second connect
    const adapter2 = await factory.connect()
    expect(adapter2).toBeDefined()
    expect(mariadb.createPool).toHaveBeenCalledTimes(2)

    await adapter2.dispose()
    expect(mockPool.end).toHaveBeenCalledTimes(2)
  })

  test('should allow multiple connect() calls with connection string', async () => {
    const mockPool = {
      getConnection: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    }

    // Mock createPool to return our mock pool
    vi.mocked(mariadb.createPool).mockReturnValue(mockPool as unknown as mariadb.Pool)

    const connectionString = 'mysql://user:pass@localhost:3306/db'
    const factory = new PrismaMariaDbAdapterFactory(connectionString)

    const adapter1 = await factory.connect()
    expect(adapter1).toBeDefined()
    expect(mariadb.createPool).toHaveBeenCalledTimes(1)
    // Should have converted mysql:// to mariadb://
    expect(mariadb.createPool).toHaveBeenCalledWith(
      'mariadb://user:pass@localhost:3306/db?prepareCacheLength=0&timezone=UTC',
    )

    await adapter1.dispose()
    expect(mockPool.end).toHaveBeenCalledTimes(1)

    // Should create a new pool for the second connect
    const adapter2 = await factory.connect()
    expect(adapter2).toBeDefined()
    expect(mariadb.createPool).toHaveBeenCalledTimes(2)

    await adapter2.dispose()
    expect(mockPool.end).toHaveBeenCalledTimes(2)
  })
})

describe('transaction connection management', () => {
  function makePoolConn() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    const conn = {
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ meta: [], affectedRows: 1 }),
      release: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      on(event: string, cb: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(cb)
        return this
      },
      off(event: string, cb: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(cb)
        return this
      },
      listenerCount(event: string) {
        return listeners.get(event)?.size ?? 0
      },
    }
    return conn
  }

  test('commit returns connection to the pool via release() (not end())', async () => {
    const conn = makePoolConn()
    const pool = {
      getConnection: vi.fn().mockResolvedValue(conn),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    } as unknown as mariadb.Pool

    const adapter = new PrismaMariaDbAdapter(pool, { supportsRelationJoins: false })
    const tx = await adapter.startTransaction()
    await tx.commit()

    expect(conn.release).toHaveBeenCalledTimes(1)
    expect(conn.end).not.toHaveBeenCalled()
  })

  test('rollback returns connection to the pool via release() (not end())', async () => {
    const conn = makePoolConn()
    const pool = {
      getConnection: vi.fn().mockResolvedValue(conn),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    } as unknown as mariadb.Pool

    const adapter = new PrismaMariaDbAdapter(pool, { supportsRelationJoins: false })
    const tx = await adapter.startTransaction()
    await tx.rollback()

    expect(conn.release).toHaveBeenCalledTimes(1)
    expect(conn.end).not.toHaveBeenCalled()
  })

  test('error listener is removed after commit so it does not leak to the next user of the pooled connection', async () => {
    const conn = makePoolConn()
    const pool = {
      getConnection: vi.fn().mockResolvedValue(conn),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    } as unknown as mariadb.Pool

    const adapter = new PrismaMariaDbAdapter(pool, { supportsRelationJoins: false })
    const tx = await adapter.startTransaction()
    expect(conn.listenerCount('error')).toBe(1)
    await tx.commit()
    expect(conn.listenerCount('error')).toBe(0)
  })

  test('startTransaction releases the connection AND removes the listener when BEGIN fails', async () => {
    const conn = makePoolConn()
    conn.query.mockImplementation(({ sql }: { sql: string }) => {
      if (sql === 'BEGIN') return Promise.reject(new Error('boom'))
      return Promise.resolve([])
    })
    const pool = {
      getConnection: vi.fn().mockResolvedValue(conn),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    } as unknown as mariadb.Pool

    const adapter = new PrismaMariaDbAdapter(pool, { supportsRelationJoins: false })
    await expect(adapter.startTransaction()).rejects.toBeDefined()

    expect(conn.release).toHaveBeenCalledTimes(1)
    expect(conn.end).not.toHaveBeenCalled()
    expect(conn.listenerCount('error')).toBe(0)
  })

  test('falls back to end() for non-pool connections (no release method)', async () => {
    const conn = makePoolConn()
    const connNoRelease = { ...conn, release: undefined as unknown as typeof conn.release }
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connNoRelease),
      query: vi.fn().mockResolvedValue([['8.0.13']]),
    } as unknown as mariadb.Pool

    const adapter = new PrismaMariaDbAdapter(pool, { supportsRelationJoins: false })
    const tx = await adapter.startTransaction()
    await tx.commit()

    expect(connNoRelease.end).toHaveBeenCalledTimes(1)
  })
})
