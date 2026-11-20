import { PrismaPg } from '@prisma/adapter-pg'
import {
  ColumnTypeEnum,
  type SqlDriverAdapter,
  type SqlDriverAdapterFactory,
  type SqlQuery,
  type SqlResultSet,
  type Transaction,
} from '@prisma/driver-adapter-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createAdapter } from './adapter'

vi.mock('@prisma/adapter-pg', () => {
  return {
    PrismaPg: vi.fn().mockImplementation(function () {
      return { adapterName: '@prisma/adapter-pg' }
    }),
  }
})

describe('createAdapter', () => {
  test('PostgreSQL protocols', () => {
    const postgresUrls = ['postgres://user:pass@localhost:5432/db', 'postgresql://user:pass@localhost:5432/db']

    for (const url of postgresUrls) {
      const adapter = createAdapter(url)
      expect(adapter.adapterName).toBe('@prisma/adapter-pg')
    }
  })

  test('MySQL/MariaDB protocols', () => {
    const mysqlUrls = ['mysql://user:pass@localhost:3306/db', 'mariadb://user:pass@localhost:3306/db']

    for (const url of mysqlUrls) {
      const adapter = createAdapter(url)
      expect(adapter.adapterName).toBe('@prisma/adapter-mariadb')
    }
  })

  test('SQL Server protocol', () => {
    const sqlserverUrl =
      'sqlserver://localhost:1433;database=master;user=SA;password=YourStrong@Passw0rd;trustServerCertificate=true;'
    const adapter = createAdapter(sqlserverUrl)
    expect(adapter.adapterName).toBe('@prisma/adapter-mssql')
  })

  test('unsupported protocol', () => {
    // These URLs are valid but have unsupported protocols
    const unsupportedUrls = [
      'http://localhost:8080',
      'https://localhost:8080',
      'ftp://localhost:21',
      'mongodb://localhost:27017/db',
      'redis://localhost:6379',
    ]

    for (const url of unsupportedUrls) {
      expect(() => createAdapter(url)).toThrowError(`Unsupported protocol in database URL: ${new URL(url).protocol}`)
    }
  })

  test('invalid database URLs', () => {
    // These URLs are invalid or not recognized as database URLs
    const invalidUrls = ['', 'not-a-url', 'no-protocol.com/db?param=value']

    for (const url of invalidUrls) {
      expect(() => createAdapter(url)).toThrowError('Invalid database URL')
    }
  })
})

describe('PostgreSQL TLS parameters', () => {
  test("SSL params aren't added if not originally present", () => {
    const url = 'postgresql://user:pass@localhost:5432/db'
    createAdapter(url)

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: url,
    })
  })

  test("sslmode=disable isn't modified", () => {
    const url = 'postgresql://user:pass@localhost:5432/db?sslmode=disable'
    createAdapter(url)

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: url,
    })
  })

  test('sslmode values that enable SSL without certificate verification', () => {
    const modesWithoutVerification = ['prefer', 'require', 'no-verify']

    for (const mode of modesWithoutVerification) {
      vi.clearAllMocks()
      const url = `postgresql://user:pass@localhost:5432/db?sslmode=${mode}`
      createAdapter(url)

      expect(PrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@localhost:5432/db?sslmode=no-verify',
      })
    }
  })

  test('sslmode values that enable SSL with certificate verification', () => {
    const modesWithVerification = ['verify-ca', 'verify-full']

    for (const mode of modesWithVerification) {
      vi.clearAllMocks()
      const url = `postgresql://user:pass@localhost:5432/db?sslmode=${mode}`
      createAdapter(url)

      expect(PrismaPg).toHaveBeenCalledWith({
        connectionString: url,
      })
    }
  })

  test('custom certificate parameters should throw error', () => {
    const certParams = ['sslcert', 'sslkey', 'sslrootcert']

    for (const param of certParams) {
      const url = `postgresql://user:pass@localhost:5432/db?${param}=/path/to/cert`
      expect(() => createAdapter(url)).toThrowError(
        'Unsupported parameters in connection string: uploading and using custom TLS certificates is not currently supported',
      )
    }
  })
})

describe('createAdapter wrapper error handling', () => {
  describe('factory error handling', () => {
    test.each([
      {
        description: 'basic connection errors',
        error: new Error('Connection failed to postgresql://user:secret@host:5432/db'),
        expectedError: {
          message: 'Connection failed to [REDACTED]',
        },
      },
      {
        description: 'quoted connection strings',
        error: new Error('Connection string "mysql://user:pass@host:3306/db" is invalid'),
        expectedError: {
          message: 'Connection string [REDACTED] is invalid',
        },
      },
      {
        description: 'single-quoted connection strings',
        error: new Error("Connection string 'postgresql://user:pass@host:5432/db' failed"),
        expectedError: {
          message: 'Connection string [REDACTED] failed',
        },
      },
      {
        description: 'backtick-quoted connection strings',
        error: new Error('Connection string `sqlserver://sa:password@localhost:1433/db` could not be parsed'),
        expectedError: {
          message: 'Connection string [REDACTED] could not be parsed',
        },
      },
      {
        description: 'multiple connection strings',
        error: new Error(
          'Failed to connect to mysql://user:pass@host1:3306/db1 or postgresql://admin:secret@host2:5432/db2',
        ),
        expectedError: {
          message: 'Failed to connect to [REDACTED] or [REDACTED]',
        },
      },
      {
        description: 'AggregateError with nested connection strings',
        error: new AggregateError(
          [
            new Error('Connection 1 failed: mysql://user1:pass1@host1:3306/db1'),
            new Error('Connection 2 failed: postgresql://user2:pass2@host2:5432/db2'),
          ],
          'Multiple connection failures',
        ),
        expectedError: {
          message: 'Multiple connection failures',
          errors: [{ message: 'Connection 1 failed: [REDACTED]' }, { message: 'Connection 2 failed: [REDACTED]' }],
        },
      },
      {
        description: 'connection strings in arbitrary error properties',
        error: (() => {
          const err = new Error('Generic connection error')
          ;(err as any).config = {
            url: 'mysql://admin:password123@prod-server:3306/app_db',
            fallbackUrl: 'postgresql://backup:secret@backup-server:5432/app_db',
          }
          ;(err as any).debugInfo = 'Attempted mysql://user:pass@localhost:3306/debug'
          return err
        })(),
        expectedError: {
          message: 'Generic connection error',
          config: {
            url: '[REDACTED]',
            fallbackUrl: '[REDACTED]',
          },
          debugInfo: 'Attempted [REDACTED]',
        },
      },
      {
        description: 'cyclic error references without infinite recursion',
        error: (() => {
          const error1 = new Error('Error 1 with mysql://user:pass@host1:3306/db1')
          const error2 = new Error('Error 2 with postgresql://admin:secret@host2:5432/db2')
          error1.cause = error2
          error2.cause = error1
          ;(error1 as any).relatedError = error2
          ;(error2 as any).relatedError = error1
          return error1
        })(),
        expectedError: {
          message: 'Error 1 with [REDACTED]',
          cause: {
            message: 'Error 2 with [REDACTED]',
          },
        },
      },
      {
        description: 'complex nested errors with both AggregateError and cause chain',
        error: (() => {
          const deepestError = new Error('Deep error with mysql://user:pass@host:3306/deep')
          const middleError = new Error('Middle error with postgresql://admin:secret@server:5432/middle', {
            cause: deepestError,
          })
          const rootCauseError = new Error('Root cause', { cause: middleError })

          const nestedAggregateError = new AggregateError(
            [
              new Error('Nested 1: sqlserver://sa:password@cluster:1433/nested1'),
              new Error('Nested 2: mariadb://root:secret@db:3306/nested2'),
            ],
            'Nested aggregate with connections',
          )

          return new AggregateError(
            [
              rootCauseError,
              new Error('Direct error: postgres://user:pass@localhost:5432/direct'),
              nestedAggregateError,
            ],
            'Main aggregate error',
          )
        })(),
        expectedError: {
          message: 'Main aggregate error',
          errors: [
            {
              message: 'Root cause',
              cause: {
                message: 'Middle error with [REDACTED]',
                cause: {
                  message: 'Deep error with [REDACTED]',
                },
              },
            },
            {
              message: 'Direct error: [REDACTED]',
            },
            {
              message: 'Nested aggregate with connections',
              errors: [{ message: 'Nested 1: [REDACTED]' }, { message: 'Nested 2: [REDACTED]' }],
            },
          ],
        },
      },
    ])('sanitizes $description', async ({ error, expectedError }) => {
      const failingFactory: SqlDriverAdapterFactory = {
        provider: 'postgres',
        adapterName: '@prisma/dummy',
        connect: vi.fn().mockRejectedValue(error),
      }

      const wrappedFactory = createAdapter('postgresql://user:secret@host:5432/db', [
        {
          protocols: ['postgresql', 'postgres', 'mysql', 'sqlserver', 'mariadb'],
          create: () => failingFactory,
        },
      ])

      try {
        await wrappedFactory.connect()
        expect.fail('Should have thrown an error')
      } catch (caughtError) {
        expect(caughtError).toMatchObject(expectedError)
      }
    })

    test('handles errors without connection strings unchanged', async () => {
      const genericError = new Error('Generic database connection error')
      const failingFactory: SqlDriverAdapterFactory = {
        provider: 'postgres',
        adapterName: '@prisma/dummy',
        connect: vi.fn().mockRejectedValue(genericError),
      }

      const wrappedFactory = createAdapter('postgresql://user:pass@host:5432/db', [
        {
          protocols: ['postgresql'],
          create: () => failingFactory,
        },
      ])

      await expect(wrappedFactory.connect()).rejects.toThrow('Generic database connection error')
    })
  })

  describe('adapter error handling', () => {
    let mockAdapter: SqlDriverAdapter
    let successfulFactory: SqlDriverAdapterFactory

    beforeEach(() => {
      mockAdapter = {
        provider: 'postgres',
        adapterName: '@prisma/dummy',
        dispose: vi.fn(),
        executeRaw: vi.fn(),
        queryRaw: vi.fn(),
        executeScript: vi.fn(),
        startTransaction: vi.fn(),
      }

      successfulFactory = {
        provider: 'postgres',
        adapterName: '@prisma/dummy',
        connect: vi.fn().mockResolvedValue(mockAdapter),
      }
    })

    test.each([
      {
        method: 'dispose' as const,
        execute: async (adapter: SqlDriverAdapter) => adapter.dispose(),
      },
      {
        method: 'executeRaw' as const,
        execute: async (adapter: SqlDriverAdapter) => {
          const query: SqlQuery = { sql: 'SELECT 1', args: [], argTypes: [] }
          return adapter.executeRaw(query)
        },
      },
      {
        method: 'queryRaw' as const,
        execute: async (adapter: SqlDriverAdapter) => {
          const query: SqlQuery = { sql: 'SELECT * FROM users', args: [], argTypes: [] }
          return adapter.queryRaw(query)
        },
      },
      {
        method: 'executeScript' as const,
        execute: async (adapter: SqlDriverAdapter) => adapter.executeScript('CREATE TABLE test (id INT);'),
      },
      {
        method: 'startTransaction' as const,
        execute: async (adapter: SqlDriverAdapter) => adapter.startTransaction('READ COMMITTED'),
      },
    ])('wraps adapter.$method() to sanitize errors', async ({ method, execute }) => {
      const error = new Error(`${method} failed for postgresql://user:pass@host:5432/db`)
      ;(mockAdapter as any)[method] = vi.fn().mockRejectedValue(error)

      const wrappedFactory = createAdapter('postgresql://user:pass@host:5432/db', [
        {
          protocols: ['postgresql'],
          create: () => successfulFactory,
        },
      ])

      const adapter = await wrappedFactory.connect()
      await expect(execute(adapter)).rejects.toThrow(`${method} failed for [REDACTED]`)
    })

    test('successful adapter methods pass through without modification', async () => {
      const mockResult: SqlResultSet = {
        columnTypes: [ColumnTypeEnum.Text],
        columnNames: ['name'],
        rows: [['test']],
      }

      mockAdapter.executeRaw = vi.fn().mockResolvedValue(1)
      mockAdapter.queryRaw = vi.fn().mockResolvedValue(mockResult)
      mockAdapter.executeScript = vi.fn().mockResolvedValue(undefined)
      mockAdapter.dispose = vi.fn().mockResolvedValue(undefined)

      const wrappedFactory = createAdapter('postgresql://user:pass@host:5432/db', [
        {
          protocols: ['postgresql'],
          create: () => successfulFactory,
        },
      ])

      const adapter = await wrappedFactory.connect()
      const query: SqlQuery = { sql: 'SELECT 1', args: [], argTypes: [] }

      expect(await adapter.executeRaw(query)).toBe(1)
      expect(await adapter.queryRaw(query)).toEqual(mockResult)
      await expect(adapter.executeScript('SELECT 1;')).resolves.toBeUndefined()
      await expect(adapter.dispose()).resolves.toBeUndefined()

      /* eslint-disable @typescript-eslint/unbound-method */
      expect(mockAdapter.executeRaw).toHaveBeenCalledWith(query)
      expect(mockAdapter.queryRaw).toHaveBeenCalledWith(query)
      expect(mockAdapter.executeScript).toHaveBeenCalledWith('SELECT 1;')
      expect(mockAdapter.dispose).toHaveBeenCalledOnce()
      /* eslint-enable @typescript-eslint/unbound-method */
    })
  })

  describe('transaction error handling', () => {
    let mockTransaction: Transaction
    let mockAdapter: SqlDriverAdapter
    let successfulFactory: SqlDriverAdapterFactory

    beforeEach(() => {
      mockTransaction = {
        provider: 'postgres',
        adapterName: '@prisma/dummy',
        options: { usePhantomQuery: false },
        commit: vi.fn(),
        rollback: vi.fn(),
        executeRaw: vi.fn(),
        queryRaw: vi.fn(),
        createSavepoint: vi.fn(),
        rollbackToSavepoint: vi.fn(),
        releaseSavepoint: vi.fn(),
      }

      mockAdapter = {
        provider: 'postgres',
        adapterName: '@prisma/dummy',
        dispose: vi.fn(),
        executeRaw: vi.fn(),
        queryRaw: vi.fn(),
        executeScript: vi.fn(),
        startTransaction: vi.fn().mockResolvedValue(mockTransaction),
      }

      successfulFactory = {
        provider: 'postgres',
        adapterName: '@prisma/dummy',
        connect: vi.fn().mockResolvedValue(mockAdapter),
      }
    })

    test.each([
      {
        method: 'commit' as const,
        execute: async (tx: Transaction) => tx.commit(),
      },
      {
        method: 'rollback' as const,
        execute: async (tx: Transaction) => tx.rollback(),
      },
      {
        method: 'executeRaw' as const,
        execute: async (tx: Transaction) => {
          const query: SqlQuery = { sql: 'INSERT INTO users (name) VALUES (?)', args: ['test'], argTypes: [] }
          return tx.executeRaw(query)
        },
      },
      {
        method: 'queryRaw' as const,
        execute: async (tx: Transaction) => {
          const query: SqlQuery = { sql: 'SELECT * FROM orders', args: [], argTypes: [] }
          return tx.queryRaw(query)
        },
      },
      {
        method: 'createSavepoint' as const,
        execute: async (tx: Transaction) => tx.createSavepoint?.('sp1'),
      },
      {
        method: 'rollbackToSavepoint' as const,
        execute: async (tx: Transaction) => tx.rollbackToSavepoint?.('sp1'),
      },
      {
        method: 'releaseSavepoint' as const,
        execute: async (tx: Transaction) => tx.releaseSavepoint?.('sp1'),
      },
    ])('wraps transaction.$method() to sanitize errors', async ({ method, execute }) => {
      const error = new Error(`${method} failed for postgresql://user:pass@host:5432/db`)
      ;(mockTransaction as any)[method] = vi.fn().mockRejectedValue(error)

      const wrappedFactory = createAdapter('postgresql://user:pass@host:5432/db', [
        {
          protocols: ['postgresql'],
          create: () => successfulFactory,
        },
      ])

      const adapter = await wrappedFactory.connect()
      const tx = await adapter.startTransaction()
      await expect(execute(tx)).rejects.toThrow(`${method} failed for [REDACTED]`)
    })

    test('successful transaction methods pass through without modification', async () => {
      const mockResult: SqlResultSet = {
        columnTypes: [ColumnTypeEnum.Text],
        columnNames: ['id'],
        rows: [['123']],
      }

      mockTransaction.commit = vi.fn().mockResolvedValue(undefined)
      mockTransaction.rollback = vi.fn().mockResolvedValue(undefined)
      mockTransaction.executeRaw = vi.fn().mockResolvedValue(1)
      mockTransaction.queryRaw = vi.fn().mockResolvedValue(mockResult)
      mockTransaction.createSavepoint = vi.fn().mockResolvedValue(undefined)
      mockTransaction.rollbackToSavepoint = vi.fn().mockResolvedValue(undefined)
      mockTransaction.releaseSavepoint = vi.fn().mockResolvedValue(undefined)

      const wrappedFactory = createAdapter('postgresql://user:pass@host:5432/db', [
        {
          protocols: ['postgresql'],
          create: () => successfulFactory,
        },
      ])

      const adapter = await wrappedFactory.connect()
      const tx = await adapter.startTransaction()
      const query: SqlQuery = { sql: 'SELECT id FROM users', args: [], argTypes: [] }

      await expect(tx.commit()).resolves.toBeUndefined()
      await expect(tx.rollback()).resolves.toBeUndefined()
      expect(await tx.executeRaw(query)).toBe(1)
      expect(await tx.queryRaw(query)).toEqual(mockResult)
      await expect(tx.createSavepoint?.('sp1')).resolves.toBeUndefined()
      await expect(tx.rollbackToSavepoint?.('sp1')).resolves.toBeUndefined()
      await expect(tx.releaseSavepoint?.('sp1')).resolves.toBeUndefined()

      /* eslint-disable @typescript-eslint/unbound-method */
      expect(mockTransaction.commit).toHaveBeenCalledOnce()
      expect(mockTransaction.rollback).toHaveBeenCalledOnce()
      expect(mockTransaction.executeRaw).toHaveBeenCalledWith(query)
      expect(mockTransaction.queryRaw).toHaveBeenCalledWith(query)
      expect(mockTransaction.createSavepoint).toHaveBeenCalledWith('sp1')
      expect(mockTransaction.rollbackToSavepoint).toHaveBeenCalledWith('sp1')
      expect(mockTransaction.releaseSavepoint).toHaveBeenCalledWith('sp1')
      /* eslint-enable @typescript-eslint/unbound-method */
    })

    test('preserves transaction properties and options', async () => {
      const wrappedFactory = createAdapter('postgresql://user:pass@host:5432/db', [
        {
          protocols: ['postgresql'],
          create: () => successfulFactory,
        },
      ])

      const adapter = await wrappedFactory.connect()
      const tx = await adapter.startTransaction()

      expect(tx.provider).toBe('postgres')
      expect(tx.adapterName).toBe('@prisma/dummy')
      expect(tx.options).toEqual({ usePhantomQuery: false })
    })
  })
})
