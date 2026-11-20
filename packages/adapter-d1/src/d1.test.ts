import { D1Database } from '@cloudflare/workers-types'
import {
  mockAdapter,
  SqlDriverAdapterFactory,
  SqlMigrationAwareDriverAdapterFactory,
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
