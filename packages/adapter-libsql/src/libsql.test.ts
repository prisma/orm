import type { Client } from '@libsql/client'
import type { ArgType, SqlDriverAdapter } from '@prisma/driver-adapter-utils'
import { ColumnTypeEnum, IsolationLevel, SqlMigrationAwareDriverAdapterFactory } from '@prisma/driver-adapter-utils'
import { describe, expect, test, vi } from 'vitest'

import { PrismaLibSqlAdapterFactoryBase } from './libsql'
import { PrismaLibSqlAdapterFactory } from './libsql-node'

describe.each([
  (factory: SqlMigrationAwareDriverAdapterFactory) => factory.connect(),
  (factory: SqlMigrationAwareDriverAdapterFactory) => factory.connectToShadowDb(),
])('behavior of the adapter with "%s"', (connect) => {
  test('executes and parses simple queries', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await expect(
      conn.queryRaw({
        sql: 'SELECT ?1 as col1, ?2 as col2',
        args: [1, 'str'],
        argTypes: [
          { arity: 'scalar', scalarType: 'decimal' },
          { arity: 'scalar', scalarType: 'string' },
        ],
      }),
    ).resolves.toMatchObject({
      columnNames: ['col1', 'col2'],
      columnTypes: [ColumnTypeEnum.UnknownNumber, ColumnTypeEnum.Text],
      rows: [[1, 'str']],
    })
  })

  test('executes and parses simple statements', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await expect(
      conn.executeRaw({
        sql: 'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)',
        args: [],
        argTypes: [],
      }),
    ).resolves.toBe(0)

    await expect(
      conn.executeRaw({
        sql: 'INSERT INTO test (id, name) VALUES (?1, ?2)',
        args: [10, 'John'],
        argTypes: [
          { arity: 'scalar', scalarType: 'int' },
          { arity: 'scalar', scalarType: 'string' },
        ],
      }),
    ).resolves.toBe(1)

    expect(
      await conn.queryRaw({
        sql: 'SELECT * FROM test',
        args: [],
        argTypes: [],
      }),
    ).toMatchObject({ rows: [[10, 'John']] })
  })

  test('executes simple scripts', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await expect(
      conn.executeScript(`
    CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO test (id, name) VALUES (10, 'John');`),
    ).resolves.toBe(undefined)

    expect(
      await conn.queryRaw({
        sql: 'SELECT * FROM test',
        args: [],
        argTypes: [],
      }),
    ).toMatchObject({ rows: [[10, 'John']] })
  })

  test('query errors get converted to DriverAdapterError', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await expect(
      conn.queryRaw({
        sql: 'SELECT * FROM non_existent_table',
        args: [],
        argTypes: [],
      }),
    ).rejects.toMatchObject({
      name: 'DriverAdapterError',
      cause: { kind: 'sqlite', extendedCode: 1, message: 'SQLITE_ERROR: no such table: non_existent_table' },
    })
  })

  test('execute errors get converted to DriverAdapterError', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await expect(
      conn.executeRaw({
        sql: "INSERT INTO non_existent_table (id, name) VALUES (10, 'John')",
        args: [],
        argTypes: [],
      }),
    ).rejects.toMatchObject({
      name: 'DriverAdapterError',
      cause: { kind: 'sqlite', extendedCode: 1, message: 'SQLITE_ERROR: no such table: non_existent_table' },
    })
  })

  test('script errors get converted to DriverAdapterError', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await expect(
      conn.executeScript("INSERT INTO non_existent_table (id, name) VALUES (10, 'John')"),
    ).rejects.toMatchObject({
      name: 'DriverAdapterError',
      cause: { kind: 'sqlite', extendedCode: 1, message: 'SQLITE_ERROR: no such table: non_existent_table' },
    })
  })

  test('executes a SERIALIZABLE transaction', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await conn.executeScript(`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`)

    const tx = await conn.startTransaction('SERIALIZABLE')
    expect(tx.options.usePhantomQuery).toBe(true)

    await expect(
      tx.executeRaw({
        sql: "INSERT INTO test (id, name) VALUES (20, 'Jane')",
        args: [],
        argTypes: [],
      }),
    ).resolves.toBe(1)
    await expect(tx.commit()).resolves.toBeUndefined()
  })

  test('rolls back a SERIALIZABLE transaction', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    await conn.executeScript(`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`)

    const tx = await conn.startTransaction('SERIALIZABLE')
    expect(tx.options.usePhantomQuery).toBe(true)

    await expect(
      tx.executeRaw({
        sql: "INSERT INTO test (id, name) VALUES (20, 'Jane')",
        args: [],
        argTypes: [],
      }),
    ).resolves.toBe(1)
    await expect(tx.rollback()).resolves.toBeUndefined()
  })

  test('rejects any other isolation level', async () => {
    const factory = new PrismaLibSqlAdapterFactory({ url: ':memory:' })
    const conn = await connect(factory)

    for (const level of [
      'READ UNCOMMITTED',
      'READ COMMITTED',
      'REPEATABLE READ',
      'SNAPSHOT',
    ] satisfies IsolationLevel[]) {
      await expect(conn.startTransaction(level)).rejects.toMatchObject({
        name: 'DriverAdapterError',
        cause: { kind: 'InvalidIsolationLevel' },
      })
    }
  })
})

describe.each([
  (factory: SqlMigrationAwareDriverAdapterFactory) => factory.connect(),
  (factory: SqlMigrationAwareDriverAdapterFactory) => factory.connectToShadowDb(),
])('usage of the underlying connection with "%s"', (connect) => {
  test('dispose closes the underlying connection', async () => {
    const factory = new PrismaLibSqlAdapterFactoryMock({ url: ':memory:' })
    const conn = await connect(factory)
    await expect(conn.dispose()).resolves.toBeUndefined()
    expect(factory.connection.close).toHaveBeenCalledTimes(1)
  })

  test('commit commits the underlying transaction', async () => {
    const factory = new PrismaLibSqlAdapterFactoryMock({ url: ':memory:' })
    const conn = await connect(factory)
    const tx = await conn.startTransaction('SERIALIZABLE')
    expect(tx.options.usePhantomQuery).toBe(true)
    await expect(tx.commit()).resolves.toBeUndefined()
    expect(factory.transaction.commit).toHaveBeenCalledTimes(1)
  })

  test('rollback rolls back the underlying transaction', async () => {
    const factory = new PrismaLibSqlAdapterFactoryMock({ url: ':memory:' })
    const conn = await connect(factory)
    const tx = await conn.startTransaction('SERIALIZABLE')
    expect(tx.options.usePhantomQuery).toBe(true)
    await expect(tx.rollback()).resolves.toBeUndefined()
    expect(factory.transaction.rollback).toHaveBeenCalledTimes(1)
  })
})

function selectWithParams(adapter: SqlDriverAdapter, count: number) {
  const argType: ArgType = { scalarType: 'int', arity: 'scalar' }
  return adapter.queryRaw({
    sql: `SELECT 1 WHERE 1 IN (${Array.from({ length: count }, () => '?').join(', ')})`,
    args: Array.from({ length: count }, () => 1),
    argTypes: Array.from({ length: count }, () => argType),
  })
}

describe('getConnectionInfo', () => {
  test.each(['connect', 'connectToShadowDb'] as const)(
    '%s reports the bind parameter limit of the database',
    async (method) => {
      const adapter = await new PrismaLibSqlAdapterFactory({ url: ':memory:' })[method]()
      try {
        const maxBindValues = adapter.getConnectionInfo?.().maxBindValues

        // libSQL bundles SQLite >= 3.32.0, which raised the limit from 999 to 32766.
        expect(maxBindValues).toBeGreaterThan(999)
        await expect(selectWithParams(adapter, maxBindValues!)).resolves.toMatchObject({ rows: [[1]] })
        await expect(selectWithParams(adapter, maxBindValues! + 1)).rejects.toThrow('too many SQL variables')
      } finally {
        await adapter.dispose()
      }
    },
  )

  test('leaves maxBindValues unset when the database does not report it', async () => {
    const factory = new PrismaLibSqlAdapterFactoryMock({ url: ':memory:' })
    const adapter = await factory.connect()
    expect(adapter.getConnectionInfo?.().maxBindValues).toBeUndefined()
  })

  test('leaves maxBindValues unset when the server refuses the pragma', async () => {
    const factory = new PrismaLibSqlAdapterFactoryMock({ url: ':memory:' })
    factory.connection.execute.mockRejectedValueOnce(new Error('SQL_PARSE_ERROR: pragma not allowed'))
    const adapter = await factory.connect()
    expect(adapter.getConnectionInfo?.().maxBindValues).toBeUndefined()
  })

  test('does not report relation join support', async () => {
    const adapter = await new PrismaLibSqlAdapterFactory({ url: ':memory:' }).connect()
    try {
      expect(adapter.getConnectionInfo?.().supportsRelationJoins).toBe(false)
    } finally {
      await adapter.dispose()
    }
  })
})

class PrismaLibSqlAdapterFactoryMock extends PrismaLibSqlAdapterFactoryBase {
  connection = {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    batch: vi.fn(),
    close: vi.fn(),
    closed: false,
    executeMultiple: vi.fn(),
    protocol: 'file',
    sync: vi.fn(),
  }

  transaction = {
    ...this.connection,
    commit: vi.fn(),
    rollback: vi.fn(),
  }

  createClient(): Client {
    return {
      ...this.connection,
      transaction: () => Promise.resolve(this.transaction),
      migrate: vi.fn().mockResolvedValue([]),
      reconnect: vi.fn(),
    }
  }
}
