import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('simple object', async () => {
      const result = await prisma.entry.create({
        data: { json: { x: 1 } },
      })
      expect(result).toMatchObject({
        json: { x: 1 },
      })
    })

    test('empty object', async () => {
      const result = await prisma.entry.create({
        data: { json: {} },
      })
      expect(result).toMatchObject({
        json: {},
      })
    })

    // Regression test for https://github.com/prisma/prisma/issues/30859
    test('primitive values', async () => {
      const values = ['some string', 'another string', 42, 1.5, true]

      for (const json of values) {
        const result = await prisma.entry.create({
          data: { json },
        })
        expect(result).toMatchObject({ json })
      }
    })

    // Regression test for https://github.com/prisma/prisma/issues/14274
    // and https://github.com/prisma/prisma/issues/14342
    test('object with no prototype', async () => {
      const result = await prisma.entry.create({
        data: { json: Object.create(null) },
      })
      expect(result).toMatchObject({
        json: {},
      })
    })

    // regression test for https://github.com/prisma/prisma/issues/20192
    test('object with .toJSON method', async () => {
      const value = {
        toJSON: () => 'some value',
      }
      const url = new URL('http://example.com/')

      const result = await prisma.entry.create({
        data: { json: { value, url } },
      })

      expect(result).toMatchObject({
        json: {
          value: 'some value',
          url: 'http://example.com/',
        },
      })
    })
  },
  {
    optOut: {
      from: ['sqlserver'],
      reason: `
        sqlserver - connector does not support Json type
      `,
    },
  },
)
