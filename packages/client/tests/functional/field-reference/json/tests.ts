import { Providers } from '../../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  ({ provider }, _suiteMeta) => {
    afterEach(async () => {
      await prisma.product.deleteMany({})
    })

    test('simple equality', async () => {
      await prisma.product.createMany({
        data: [
          {
            title: 'Potato',
            properties1: {
              kind: 'root vegetable',
            },
            properties2: {
              kind: 'root vegetable',
            },
          },

          {
            title: 'Apple',
            properties1: {
              color: 'red',
            },
            properties2: {
              kind: 'fruit',
            },
          },
        ],
      })

      const products = await prisma.product.findMany({
        where: { properties1: { equals: prisma.product.fields.properties2 } },
      })

      expect(products).toEqual([expect.objectContaining({ title: 'Potato' })])
    })

    test('does not conflict with {_ref: "something"} json value', async () => {
      await prisma.product.createMany({
        data: [
          {
            title: 'Potato',
            properties1: {
              kind: 'root vegetable',
            },
            properties2: {
              kind: 'root vegetable',
            },
          },
        ],
      })
      const products = await prisma.product.findMany({
        where: { properties1: { equals: { _ref: 'properties2' } } },
      })

      expect(products).toEqual([])
    })

    testIf(provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB)('string filter', async () => {
      await prisma.product.createMany({
        data: [
          {
            title: 'potato',
            properties1: {
              kind: 'vegetable',
            },
          },
          {
            title: 'apple',
            properties1: {
              kind: 'very tasty apple',
            },
          },
        ],
      })
      const products = await prisma.product.findMany({
        where: {
          properties1: {
            // @ts-test-if: provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB
            path: ['kind'],
            string_ends_with: prisma.product.fields.title,
          },
        },
      })

      expect(products).toEqual([expect.objectContaining({ title: 'apple' })])
    })

    testIf(provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB)('array filter', async () => {
      await prisma.product.createMany({
        data: [
          {
            title: 'potato',
            properties1: { object: { meta: { tags: ['potato'] } } },
            properties2: 'potato',
          },
          {
            title: 'apple',
            properties1: { object: { meta: { tags: ['red', 'tasty'] } } },
            properties2: 'not potato',
          },
        ],
      })
      const products = await prisma.product.findMany({
        where: {
          properties1: {
            // @ts-test-if: provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB
            path: ['object', 'meta', 'tags'],
            array_contains: prisma.product.fields.properties2,
          },
        },
      })

      expect(products).toEqual([expect.objectContaining({ title: 'potato' })])
    })

    // TODO: Edge: skipped because of the error snapshot
    test('wrong field type', async () => {
      const products = prisma.product.findMany({
        where: {
          properties1: {
            // @ts-expect-error
            equals: prisma.product.fields.title,
          },
        },
      })

      await expect(products).rejects.toMatchPrismaErrorSnapshot()
    })

    test('via extended client', async () => {
      const xprisma = prisma.$extends({})

      await xprisma.product.createMany({
        data: [
          {
            title: 'Potato',
            properties1: {
              kind: 'root vegetable',
            },
            properties2: {
              kind: 'root vegetable',
            },
          },
        ],
      })

      const products = await xprisma.product.findMany({
        where: { properties1: { equals: xprisma.product.fields.properties2 } },
      })

      expect(products).toEqual([expect.objectContaining({ title: 'Potato' })])
    })
  },
  {
    optOut: {
      from: ['sqlserver'],
      reason: 'JSON column type is not supported',
    },
  },
)
