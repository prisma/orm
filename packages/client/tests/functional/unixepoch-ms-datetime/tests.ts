import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { randomUUID } from 'crypto'

import { AdapterProviders } from '../_utils/providers'
import { DatasourceInfo } from '../_utils/setupTestSuiteEnv'
import { NewPrismaClient } from '../_utils/types'
// @ts-ignore
import testMatrix from './_matrix'
import type * as imports from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<imports.PrismaClient, typeof imports.PrismaClient>

testMatrix.setupTestSuite(
  ({ driverAdapter }, _suiteMeta, _clientMeta, _cliMeta, info) => {
    test('can retrieve a unixepoch-ms date time with a find unique query', async () => {
      const prisma = createClient(info, driverAdapter)

      const created = await prisma.event.create({ data: { name: 'event' } })
      expect(created).toMatchObject({ createdAt: expect.any(Date) })

      const found = await prisma.event.findUnique({
        where: {
          uuid_createdAt: {
            uuid: created.uuid,
            createdAt: created.createdAt,
          },
        },
      })
      expect(found).toMatchObject(created)
    })

    test('can retrieve a unixepoch-ms date time with a find unique query when it was stored directly as a millis number', async () => {
      const prisma = createClient(info, driverAdapter)

      const uuid = randomUUID()
      const now = new Date()
      await prisma.$executeRaw`INSERT INTO Event (name, uuid, createdAt) VALUES ('event', ${uuid}, ${now.getTime()})`

      const found = await prisma.event.findUnique({
        where: {
          uuid_createdAt: {
            uuid,
            createdAt: now,
          },
        },
      })
      expect(found).toMatchObject({ createdAt: now })
    })

    test('can retrieve a unixepoch-ms date time with a raw query', async () => {
      const prisma = createClient(info, driverAdapter)

      const created = await prisma.event.create({ data: { name: 'event' } })
      expect(created).toMatchObject({ createdAt: expect.any(Date) })

      const [event] = (await prisma.$queryRaw`SELECT * FROM Event WHERE createdAt = ${created.createdAt}`) as unknown[]
      expect(event).toMatchObject(created)
    })

    test('can retrieve a unixepoch-ms date time with a raw query by a millis number', async () => {
      const prisma = createClient(info, driverAdapter)

      const created = await prisma.event.create({ data: { name: 'event' } })
      expect(created).toMatchObject({ createdAt: expect.any(Date) })

      const [event] =
        (await prisma.$queryRaw`SELECT * FROM Event WHERE createdAt = ${created.createdAt.getTime()}`) as unknown[]
      expect(event).toMatchObject(created)
    })

    test('can retrieve a unixepoch-ms date time with a find many query', async () => {
      const prisma = createClient(info, driverAdapter)

      const created = await prisma.event.create({ data: { name: 'event' } })
      expect(created).toMatchObject({
        createdAt: expect.any(Date),
      })

      const found = await prisma.event.findMany({
        where: {
          uuid: created.uuid,
          createdAt: created.createdAt,
        },
      })
      expect(found).toEqual([created])
    })

    test('can retrieve a unixepoch-ms date time with compactable find unique queries', async () => {
      const prisma = createClient(info, driverAdapter)

      const created = await prisma.event.create({ data: { name: 'event' } })
      expect(created).toMatchObject({
        createdAt: expect.any(Date),
      })

      const find = () =>
        prisma.event.findUnique({
          where: {
            uuid_createdAt: {
              uuid: created.uuid,
              createdAt: created.createdAt,
            },
          },
        })

      // These two queries are going to be compacted together and run as one.
      await expect(Promise.all([find(), find()])).resolves.toMatchObject([created, created])
    })

    test('findUnique() returns valid Date when createdAt is stored as unix millis directly', async () => {
      const prisma = createClient(info, driverAdapter)

      const uuid = randomUUID()
      const nowMillis = Date.now()

      await prisma.$executeRaw`
        INSERT INTO Event (name, uuid, createdAt)
        VALUES ('event', ${uuid}, ${nowMillis})
      `

      const found = await prisma.event.findFirst({
        where: {
          uuid,
        },
      })

      expect(found?.createdAt).toBeInstanceOf(Date)
      expect(isNaN(found!.createdAt.getTime())).toBe(false)
    })

    test('aggregate() returns valid Date when unix millis are stored directly', async () => {
      const prisma = createClient(info, driverAdapter)

      const uuid = randomUUID()
      const nowMillis = Date.now()

      await prisma.$executeRaw`
        INSERT INTO Event (name, uuid, createdAt)
        VALUES ('event', ${uuid}, ${nowMillis})
      `

      const agg = await prisma.event.aggregate({
        _min: { createdAt: true },
        _max: { createdAt: true },
      })

      expect(agg._min.createdAt).toBeInstanceOf(Date)
      expect(isNaN(agg._min.createdAt!.getTime())).toBe(false)
      expect(agg._max.createdAt).toBeInstanceOf(Date)
      expect(isNaN(agg._max.createdAt!.getTime())).toBe(false)
    })

    test('manually created INTEGER DateTime column returns valid Date values', async () => {
      const prisma = createClient(info, driverAdapter)

      await prisma.$executeRaw`
        DROP TABLE IF EXISTS Event
      `

      await prisma.$executeRaw`
        CREATE TABLE Event (
          name TEXT NOT NULL,
          uuid TEXT NOT NULL,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
          PRIMARY KEY (uuid, createdAt)
        )
      `

      const created = await prisma.event.create({
        data: {
          name: 'event',
        },
      })

      expect(created.createdAt).toBeInstanceOf(Date)
      expect(isNaN(created.createdAt.getTime())).toBe(false)

      const found = await prisma.event.findUnique({
        where: {
          uuid_createdAt: {
            uuid: created.uuid,
            createdAt: created.createdAt,
          },
        },
      })

      expect(found?.createdAt).toBeInstanceOf(Date)
      expect(isNaN(found!.createdAt.getTime())).toBe(false)

      const agg = await prisma.event.aggregate({
        _min: { createdAt: true },
        _max: { createdAt: true },
      })

      expect(agg._min.createdAt).toBeInstanceOf(Date)
      expect(isNaN(agg._min.createdAt!.getTime())).toBe(false)
      expect(agg._max.createdAt).toBeInstanceOf(Date)
      expect(isNaN(agg._max.createdAt!.getTime())).toBe(false)
    })
  },
  {
    optOut: {
      from: ['sqlserver', 'mysql', 'postgresql', 'cockroachdb', 'mongodb'],
      reason: 'testing sqlite-specific timestamp behavior',
    },
    skipDriverAdapter: {
      from: ['js_d1'],
      reason: 'D1 does not need to support the QE unixepoch-ms format',
    },
    skipDefaultClientInstance: true,
    skip: (skip, options) => skip(options.driverAdapter === undefined, 'testing only driver adapters'),
  },
)

function createClient(info: DatasourceInfo, driverAdapter?: `${AdapterProviders}`) {
  const constructor = driverAdapter === AdapterProviders.JS_BETTER_SQLITE3 ? PrismaBetterSqlite3 : PrismaLibSql

  return newPrismaClient({
    // @ts-test-if: driverAdapter !== undefined
    adapter: new constructor(
      {
        url: info.databaseUrl,
      },
      {
        timestampFormat: 'unixepoch-ms',
      },
    ),
  })
}
