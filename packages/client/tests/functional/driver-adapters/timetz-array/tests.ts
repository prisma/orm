import { Providers } from '../../_utils/providers'
import { defaultTestSuiteOptions } from '../_utils/test-suite-options'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('timetz[] column round-trips through the client API', async () => {
      const times = [new Date('1970-01-01T12:00:00.000Z'), new Date('1970-01-01T08:30:00.000Z')]

      await prisma.a.create({ data: { times } })

      const record = await prisma.a.findFirstOrThrow()
      expect(record.times).toEqual(times)
    })

    test('timetz[] elements are read as UTC with their offset applied', async () => {
      const result = await prisma.$queryRaw<{ times: Date[] }[]>`
        SELECT ARRAY['12:00:00+00'::timetz, '13:00:00-05'::timetz, '08:30:00+05:30'::timetz] AS times
      `
      expect(result[0].times).toEqual([
        new Date('1970-01-01T12:00:00.000Z'),
        new Date('1970-01-01T18:00:00.000Z'),
        new Date('1970-01-01T03:00:00.000Z'),
      ])
    })

    test('timetz[] NULL value returns null', async () => {
      const result = await prisma.$queryRaw<{ v: string[] | null }[]>`
        SELECT NULL::timetz[] AS v
      `
      expect(result[0].v).toBeNull()
    })

    test('timetz[] preserves per-element NULLs alongside values', async () => {
      const result = await prisma.$queryRaw<{ times: (Date | null)[] }[]>`
        SELECT ARRAY[NULL, '12:00:00+00'::timetz] AS times
      `
      expect(result[0].times).toEqual([null, new Date('1970-01-01T12:00:00.000Z')])
    })
  },
  {
    ...defaultTestSuiteOptions,
    skipDefaultClientInstance: false,
    optOut: {
      from: [Providers.COCKROACHDB, Providers.SQLSERVER, Providers.MONGODB, Providers.SQLITE, Providers.MYSQL],
      reason: 'timetz[] is a PostgreSQL-only type',
    },
  },
)
