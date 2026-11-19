import { D1Database } from '@cloudflare/workers-types'
import {
  mockAdapter,
  SqlDriverAdapterFactory,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
} from '@prisma/driver-adapter-utils'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'

import { PrismaD1 } from './d1'
import { PrismaD1HttpAdapterFactory } from './d1-http'
import { PrismaD1WorkerAdapterFactory } from './d1-worker'
import { PrismaD1Http } from './index-node'

describe('D1 adapter instance creation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('create a migration-aware adapter with cloudflare env variables', async () => {
    const adapter = mockAdapter('sqlite')
    const connect = vi.spyOn(PrismaD1HttpAdapterFactory.prototype, 'connect').mockResolvedValue(adapter)
    const connectToShadowDb = vi
      .spyOn(PrismaD1HttpAdapterFactory.prototype, 'connectToShadowDb')
      .mockResolvedValue(adapter)

    const factory = new PrismaD1({
      CLOUDFLARE_ACCOUNT_ID: 'test',
      CLOUDFLARE_D1_TOKEN: 'test',
      CLOUDFLARE_DATABASE_ID: 'test',
    })
    await factory.connect()
    await factory.connectToShadowDb()

    expectTypeOf(factory).toExtend<SqlMigrationAwareDriverAdapterFactory>()
    expect(connect).toHaveBeenCalled()
    expect(connectToShadowDb).toHaveBeenCalled()
  })

  test('create a migration-aware adapter using PrismaD1Http with cloudflare env variables', async () => {
    const adapter = mockAdapter('sqlite')
    const connect = vi.spyOn(PrismaD1HttpAdapterFactory.prototype, 'connect').mockResolvedValue(adapter)
    const connectToShadowDb = vi
      .spyOn(PrismaD1HttpAdapterFactory.prototype, 'connectToShadowDb')
      .mockResolvedValue(adapter)

    const factory = new PrismaD1Http({
      CLOUDFLARE_ACCOUNT_ID: 'test',
      CLOUDFLARE_D1_TOKEN: 'test',
      CLOUDFLARE_DATABASE_ID: 'test',
    })
    await factory.connect()
    await factory.connectToShadowDb()

    expectTypeOf(factory).toExtend<SqlMigrationAwareDriverAdapterFactory>()
    expect(connect).toHaveBeenCalled()
    expect(connectToShadowDb).toHaveBeenCalled()
  })

  test('create a non-migration-aware adapter with a D1 database object', async () => {
    const connect = vi.spyOn(PrismaD1WorkerAdapterFactory.prototype, 'connect').mockResolvedValue(mockAdapter('sqlite'))

    const d1 = {} as D1Database
    const factory = new PrismaD1(d1)
    await factory.connect()

    expectTypeOf(factory).toExtend<SqlDriverAdapterFactory>()
    expectTypeOf(factory).not.toExtend<SqlMigrationAwareDriverAdapterFactory>()
    expect(factory['connectToShadowDb']).not.toBeDefined()
    expect(connect).toHaveBeenCalled()
  })

  test('reject a migration aware instance with missing cloudflare env variables', () => {
    // @ts-expect-error missing CLOUDFLARE_DATABASE_ID
    void new PrismaD1({
      CLOUDFLARE_ACCOUNT_ID: 'test',
      CLOUDFLARE_D1_TOKEN: 'test',
    })
  })
})

describe('D1 adapter query errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const query: SqlQuery = {
    sql: 'INSERT INTO User (email) VALUES (?)',
    args: ['a@b.c'],
    argTypes: [{ scalarType: 'string', arity: 'scalar' }],
  }

  test('worker adapter converts a unique constraint error without writing to console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('D1_ERROR: UNIQUE constraint failed: User.email')
    const stmt = {
      bind: () => stmt,
      raw: () => Promise.reject(failure),
      run: () => Promise.reject(failure),
    }
    const d1 = { prepare: () => stmt } as unknown as D1Database

    const adapter = await new PrismaD1WorkerAdapterFactory(d1).connect()

    await expect(adapter.queryRaw(query)).rejects.toMatchObject({
      name: 'DriverAdapterError',
      cause: { kind: 'UniqueConstraintViolation', constraint: { fields: ['email'] }, table: 'User' },
    })
    await expect(adapter.executeRaw(query)).rejects.toMatchObject({ name: 'DriverAdapterError' })
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('http adapter converts a failed query without writing to console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 7500, message: 'UNIQUE constraint failed: User.email' }],
            messages: [],
            result: [],
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const adapter = await new PrismaD1HttpAdapterFactory({
      CLOUDFLARE_ACCOUNT_ID: 'test',
      CLOUDFLARE_D1_TOKEN: 'test',
      CLOUDFLARE_DATABASE_ID: 'test',
    }).connect()

    await expect(adapter.queryRaw(query)).rejects.toMatchObject({ name: 'DriverAdapterError' })
    expect(consoleError).not.toHaveBeenCalled()
  })
})
