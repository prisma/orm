import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(await prisma.$queryRaw(123))
  expectError(await prisma.post.create({}))
  expectError(
    await prisma.post.update({
      data: {},
    }),
  )
  expectError(await prisma.post.updateMany({}))
  expectError(
    await prisma.post.count({
      asd: true,
    }),
  )
})()
