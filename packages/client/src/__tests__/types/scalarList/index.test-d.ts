import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.forest.findMany({
      where: {
        trees: {
          hasSome: 'ash123',
        },
      },
    }),
  )
  expectError(
    await prisma.forest.findMany({
      where: {
        randomInts: {
          hasEvery: ['ash123'],
        },
      },
    }),
  )
})()
