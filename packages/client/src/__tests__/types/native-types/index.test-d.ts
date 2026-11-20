import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.a.findFirst({
      where: {
        bInt: '123',
      },
    }),
  )
  expectError(
    await prisma.d.findFirst({
      where: {
        byteA: 'no string allowed. only buffer',
      },
    }),
  )
})()
