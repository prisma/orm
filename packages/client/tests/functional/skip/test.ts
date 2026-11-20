import { expectTypeOf } from 'expect-type'

import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare let Prisma: typeof PrismaNamespace

testMatrix.setupTestSuite(() => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          name: 'Boaty McBoatface',
          email: 'boat@example.com',
        },
        {
          name: 'Horsey McHorseFace',
          email: 'horse@example.com',
        },
      ],
    })
  })

  test('skips arguments', async () => {
    const result = await prisma.user.findMany({
      where: Prisma.skip,
      orderBy: { name: 'asc' },
    })

    expect(result).toMatchInlineSnapshot(
      [{ id: expect.any(String) }, { id: expect.any(String) }],
      `
      [
        {
          "email": "boat@example.com",
          "id": Any<String>,
          "name": "Boaty McBoatface",
        },
        {
          "email": "horse@example.com",
          "id": Any<String>,
          "name": "Horsey McHorseFace",
        },
      ]
    `,
    )
  })

  test('skips input fields', async () => {
    const result = await prisma.user.findMany({
      where: {
        name: Prisma.skip,
      },
      orderBy: { name: 'asc' },
    })

    expect(result).toMatchInlineSnapshot(
      [{ id: expect.any(String) }, { id: expect.any(String) }],
      `
      [
        {
          "email": "boat@example.com",
          "id": Any<String>,
          "name": "Boaty McBoatface",
        },
        {
          "email": "horse@example.com",
          "id": Any<String>,
          "name": "Horsey McHorseFace",
        },
      ]
    `,
    )
  })

  test('skips relations in include', async () => {
    const result = await prisma.user.findFirstOrThrow({
      include: {
        posts: Prisma.skip,
      },
    })

    expect(result).not.toHaveProperty('posts')
    expectTypeOf(result).not.toHaveProperty('posts')
  })

  test('skips relations in select', async () => {
    const result = await prisma.user.findFirstOrThrow({
      select: {
        id: true,
        posts: Prisma.skip,
      },
    })

    expect(result).not.toHaveProperty('posts')
    expectTypeOf(result).not.toHaveProperty('posts')
  })

  test('skips fields in omit', async () => {
    const result = await prisma.user.findFirstOrThrow({
      omit: {
        email: Prisma.skip,
      },
    })

    expect(result).toHaveProperty('email')
    expectTypeOf(result).toHaveProperty('email')
  })

  test('skips fields in create', async () => {
    const { id: authorId } = await prisma.user.findUniqueOrThrow({
      where: {
        email: 'boat@example.com',
      },
    })

    const result = await prisma.post.create({
      data: {
        authorId,
        title: 'Concise post',
        content: Prisma.skip,
      },
    })

    expect(result.content).toBe(null)
  })

  test('skips fields in nested create', async () => {
    const result = await prisma.user.update({
      where: {
        email: 'boat@example.com',
      },
      data: {
        posts: {
          create: {
            title: 'Nested post',
            content: Prisma.skip,
          },
        },
      },
      include: {
        posts: true,
      },
    })

    expect(result.posts.length).toBeGreaterThan(0)
    expect(result.posts[0].content).toBe(null)
  })

  test('skips fields in create with non-nullable field with default', async () => {
    const result = await prisma.user.create({
      data: {
        email: 'testuser@example.com',
        name: Prisma.skip,
      },
    })

    expect(result.name).toBe('Test User')
  })

  describe('after extension', () => {
    test('skips relations in include', async () => {
      const result = await prisma.$extends({}).user.findFirstOrThrow({
        include: {
          posts: Prisma.skip,
        },
      })

      expect(result).not.toHaveProperty('posts')
      expectTypeOf(result).not.toHaveProperty('posts')
    })

    test('skips relations in select', async () => {
      const result = await prisma.$extends({}).user.findFirstOrThrow({
        select: {
          id: true,
          posts: Prisma.skip,
        },
      })

      expect(result).not.toHaveProperty('posts')
      expectTypeOf(result).not.toHaveProperty('posts')
    })

    test('skips fields in omit', async () => {
      const result = await prisma.$extends({}).user.findFirstOrThrow({
        omit: {
          email: Prisma.skip,
        },
      })

      expect(result).toHaveProperty('email')
      expectTypeOf(result).toHaveProperty('email')
    })
  })

  describe('after query extension', () => {
    const getExtendedClient = () =>
      prisma.$extends({
        query: {
          $allModels: {
            $allOperations: (params) => params.query(params.args),
          },
        },
      })

    test('skips fields in create with query extension', async () => {
      const result = await getExtendedClient().user.create({
        data: {
          email: 'query-ext-test@example.com',
          name: Prisma.skip,
        },
      })

      expect(result.name).toBe('Test User')
    })

    test('skips input fields in findMany with query extension', async () => {
      const result = await getExtendedClient().user.findMany({
        where: {
          name: Prisma.skip,
        },
        orderBy: { name: 'asc' },
      })

      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    test('skips arguments in findMany with query extension', async () => {
      const result = await getExtendedClient().user.findMany({
        where: Prisma.skip,
        orderBy: { name: 'asc' },
      })

      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    test('skips relations in include with query extension', async () => {
      const result = await getExtendedClient().user.findFirstOrThrow({
        include: {
          posts: Prisma.skip,
        },
      })

      expect(result).not.toHaveProperty('posts')
    })

    test('skips relations in select with query extension', async () => {
      const result = await getExtendedClient().user.findFirstOrThrow({
        select: {
          id: true,
          posts: Prisma.skip,
        },
      })

      expect(result).not.toHaveProperty('posts')
    })
  })
})
