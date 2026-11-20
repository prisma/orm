import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

// See: https://github.com/prisma/prisma/issues/28192
testMatrix.setupTestSuite(
  () => {
    describe('historical dates with 2-digit years (00-99 AD)', () => {
      const testData = [
        { label: '31 AD timestamp', timestampString: '0031-01-01T00:00:00.000Z' },
        { label: '32 AD timestamp', timestampString: '0032-01-01T00:00:00.000Z' },
        { label: '40 AD timestamp', timestampString: '0040-01-01T00:00:00.000Z' },
        { label: '99 AD timestamp', timestampString: '0099-12-31T23:59:59.999Z' },
        { label: '120 AD timestamp', timestampString: '0120-01-01T00:00:00+00:00' },
        { label: 'timestamp with milliseconds', timestampString: '0040-06-15 12:30:45.123' },
        { label: 'modern date timestamp', timestampString: '1999-12-31 23:59:59.999' },
        { label: '3-digit year timestamp', timestampString: '0999-06-15 12:00:00' },
        { label: 'timestamptz with milliseconds and timezone', timestampString: '0050-01-15 10:20:30.456+02' },
      ] satisfies Array<{ label: string; timestampString: string }>

      test.each(testData)(`correctly parses $label`, async ({ timestampString }) => {
        const timestamp = new Date(timestampString)
        const result = await prisma.testData.create({ data: { date: timestamp, timestamp, timestamptz: timestamp } })

        // `date` is stripped of the time part
        const date = new Date(new Date(timestampString).toISOString().split('T')[0])
        expect(result).toMatchObject({ date, timestamp: timestamp, timestamptz: timestamp })
      })
    })
  },
  {
    optOut: {
      from: ['sqlite', 'mysql', 'mongodb', 'cockroachdb', 'sqlserver'],
      reason: 'Testing PostgreSQL specific behavior with enum arrays',
    },
  },
)
