import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.user.aggregate({
      cursor: {
        email: 'a@a.de',
      },
      orderBy: {
        age: 'asc',
      },
      skip: 12,
      take: 10,
      where: {
        age: { gt: 500, lt: '' },
      },
      _count: true,
      _avg: {
        age: true,
        followerCount: true,
      },
      _max: {
        age: true,
        followerCount: true,
      },
      _min: {
        age: true,
        followerCount: true,
      },
      _sum: {
        age: true,
        followerCount: true,
      },
    }),
  )

  expectError(
    await prisma.user.aggregate({
      cursor: {
        email: 'a@a.de',
      },
      orderBy: {
        age: 'asc',
      },
      skip: 12,
      take: 10,
      where: {
        AND: [
          {
            age: { gt: 500, lt: '' },
          },
        ],
        OR: [
          {
            age: { gt: 500 },
          },
        ],
      },
      _count: true,
      _avg: {
        age: true,
        followerCount: true,
      },
      _max: {
        age: true,
        followerCount: true,
      },
      _min: {
        followerCount: true,
      },
      _sum: {
        age: true,
        followerCount: true,
      },
      someField: {}, // TODO: fix types
      someRandomField: {}, // TODO: fix types
    }),
  )
  expectError(
    await prisma.user.aggregate({
      _avg: {
        email: true,
      },
    }),
  )
  expectError(
    await prisma.user.aggregate({
      _sum: {
        email: true,
      },
    }),
  )

  expectError(
    await prisma.user.aggregate({
      _count: 0,
    }),
  )
  expectError(
    await prisma.user.aggregate({
      _count: {
        $all: true,
      },
    }),
  )
})()
