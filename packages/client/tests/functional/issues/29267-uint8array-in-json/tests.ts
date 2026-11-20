import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('serializes Uint8Array nested in object as base64', async () => {
      const uint8 = new Uint8Array([72, 101, 108, 108, 111])

      const record = await prisma.testRecord.create({
        data: {
          data: { payload: uint8, label: 'test' } as any,
        },
      })

      expect(record.data).toEqual({
        payload: 'SGVsbG8=',
        label: 'test',
      })
    })

    test('serializes Uint8Array nested in array as base64', async () => {
      const uint8 = new Uint8Array([72, 101, 108, 108, 111])

      const record = await prisma.testRecord.create({
        data: {
          data: [uint8, 'hello'] as any,
        },
      })

      expect(record.data).toEqual(['SGVsbG8=', 'hello'])
    })

    test('serializes Uint8Array directly as base64', async () => {
      const uint8 = new Uint8Array([72, 101, 108, 108, 111])

      const record = await prisma.testRecord.create({
        data: {
          data: uint8 as any,
        },
      })

      expect(record.data).toBe('SGVsbG8=')
    })

    test('serializes deeply nested Uint8Array as base64', async () => {
      const uint8 = new Uint8Array([1, 2, 3])

      const record = await prisma.testRecord.create({
        data: {
          data: { outer: { inner: uint8 } } as any,
        },
      })

      expect(record.data).toEqual({
        outer: { inner: 'AQID' },
      })
    })
  },
  {
    optOut: {
      from: ['sqlserver'],
      reason: 'SQL Server does not support JSON fields',
    },
  },
)
