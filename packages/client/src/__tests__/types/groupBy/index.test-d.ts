import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  // by missing
  expectError(
    await prisma.user.groupBy({
      where: {
        age: {
          gt: -1,
        },
      },
      orderBy: [
        {
          name: 'desc',
        },
      ],
      skip: 0,
      take: 10_000,
    }),
  )

  // empty by
  expectError(
    await prisma.user.groupBy({
      by: [],
    }),
  )

  // orderBy missing, required by skip & take
  expectError(
    await prisma.user.groupBy({
      by: ['name'],
      where: {
        age: {
          gt: -1,
        },
      },
      skip: 0,
      take: 10_000,
    }),
  )

  // orderBy missing, required by skip
  expectError(
    await prisma.user.groupBy({
      by: ['name'],
      where: {
        age: {
          gt: -1,
        },
      },
      skip: 0,
    }),
  )

  // orderBy missing, required by take
  expectError(
    await prisma.user.groupBy({
      by: ['name'],
      where: {
        age: {
          gt: -1,
        },
      },
      take: 10_000,
    }),
  )

  // age must by in by, as it's in orderBy - with take
  expectError(
    await prisma.user.groupBy({
      by: ['name'],
      orderBy: {
        age: 'desc',
      },
      where: {
        age: {
          gt: -1,
        },
      },
      take: 10_000,
    }),
  )

  // age must by in by, as it's in orderBy
  expectError(
    await prisma.user.groupBy({
      by: ['name'],
      orderBy: {
        age: 'desc',
      },
      where: {
        age: {
          gt: -1,
        },
      },
    }),
  )

  // age must by in by, as it's in orderBy - minimal
  expectError(
    await prisma.user.groupBy({
      by: ['name'],
      orderBy: {
        age: 'desc',
      },
    }),
  )

  // age must by in by, as it's in orderBy - array
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      orderBy: [
        {
          age: 'desc',
        },
      ],
    }),
  )

  // name must by in by, as it's in having
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        name: '',
      },
    }),
  )

  // name must by in by, as it's in nested having - OR
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        OR: {
          name: '',
        },
      },
    }),
  )

  // name must by in by, as it's in nested having - OR[]
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        OR: [
          {
            name: '',
          },
        ],
      },
    }),
  )

  // name must by in by, as it's in nested having - AND
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        AND: {
          name: '',
        },
      },
    }),
  )

  // name must by in by, as it's in nested having - AND[]
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        AND: [
          {
            name: '',
          },
        ],
      },
    }),
  )

  // name must by in by, as it's in nested having - NOT
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        NOT: {
          name: '',
        },
      },
    }),
  )

  // TODO: Fix these cases
  // // name must by in by, as it's in nested having - NOT[]
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        NOT: [
          {
            email: '',
          },
          {
            name: '',
          },
        ],
      },
    }),
  )

  // name must by in by, as it's in nested having - NOT
  expectError(
    await prisma.user.groupBy({
      by: ['email'],
      having: {
        email: '',
        NOT: {
          AND: [
            {
              OR: [
                {
                  email: '',
                },
                {
                  name: '',
                },
              ],
            },
          ],
        },
      },
    }),
  )
})()
