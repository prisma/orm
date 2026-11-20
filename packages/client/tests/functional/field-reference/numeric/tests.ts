import { faker } from '@faker-js/faker'

import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare const prisma: PrismaClient

const name = faker.lorem.sentence()
testMatrix.setupTestSuite((_suiteConfig, _suiteMeta) => {
  beforeAll(async () => {
    const { id: storeId } = await prisma.store.create({
      data: { name },
    })
    await prisma.product.create({
      data: {
        title: 'Potato',
        quantity: 100,
        minQuantity: 50,
        maxQuantity: 150,
        wrongType: 1,
        storeId,
      },
    })

    await prisma.product.create({
      data: {
        title: 'Rice',
        quantity: 500,
        minQuantity: 20,
        maxQuantity: 200,
        wrongType: 1,
        storeId,
      },
    })

    await prisma.product.create({
      data: {
        title: 'Tomato',
        quantity: 30,
        minQuantity: 100,
        maxQuantity: 200,
        wrongType: 1,
        storeId,
      },
    })
  })

  test('single condition', async () => {
    const products = await prisma.product.findMany({
      where: {
        quantity: { gt: prisma.product.fields.maxQuantity },
      },
    })

    expect(products).toEqual([expect.objectContaining({ title: 'Rice' })])
  })

  test('multiple condition', async () => {
    const products = await prisma.product.findMany({
      where: {
        quantity: { gt: prisma.product.fields.minQuantity, lt: prisma.product.fields.maxQuantity },
      },
    })

    expect(products).toEqual([expect.objectContaining({ title: 'Potato' })])
  })

  test('aggregate', async () => {
    const products = await prisma.product.aggregate({
      where: {
        quantity: { lt: prisma.product.fields.maxQuantity },
      },
      _sum: {
        quantity: true,
      },
    })
    expect(String(products._sum.quantity)).toBe('130')
  })

  test('relationship', async () => {
    const store = await prisma.store.findFirst({
      where: { name },
      select: { products: { where: { quantity: { gt: prisma.product.fields.maxQuantity } } } },
    })
    expect(store?.products).toEqual([expect.objectContaining({ title: 'Rice' })])
  })

  // TODO: Edge: skipped because of the error snapshot
  test('wrong column numeric type', async () => {
    const products = prisma.product.findMany({
      where: {
        quantity: {
          // @ts-expect-error
          gt: prisma.product.fields.wrongType,
        },
      },
    })

    await expect(products).rejects.toMatchPrismaErrorSnapshot()
  })

  test('via extended client', async () => {
    const xprisma = prisma.$extends({})

    const products = await xprisma.product.findMany({
      where: {
        quantity: { gt: xprisma.product.fields.maxQuantity },
      },
    })

    expect(products).toEqual([expect.objectContaining({ title: 'Rice' })])
  })
})
