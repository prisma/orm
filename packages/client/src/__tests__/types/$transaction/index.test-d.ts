import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(await prisma.$transaction([prisma.user.findMany(), prisma.$queryRaw`SELECT 1`, 'random string'], {}))
  expectError(await prisma.$transaction([prisma.$connect()]))
  expectError(await prisma.$transaction([prisma.$disconnect()]))
  expectError(await prisma.$transaction([new Promise((res) => res('You Shall Not Pass'))]))
  expectError(await prisma.$transaction([5]))
  expectError(await prisma.$transaction(['str']))
  expectError(await prisma.$transaction([{}]))
})()
