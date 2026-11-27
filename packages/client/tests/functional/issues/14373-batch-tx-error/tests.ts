import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(({ clientEngineExecutor }) => {
  test('correctly reports location of a batch error', async () => {
    const result = prisma.$transaction([
      prisma.user.findMany({}),
      prisma.user.update({
        where: {
          email: 'notthere@example.com',
        },
        data: {
          memo: 'id is 1',
        },
      }),
    ])

    await expect(result).rejects.toThrow('Invalid `prisma.user.update()` invocation')
  })

  test('reports the index of the failed query in a batch', async () => {
    const error = await prisma
      .$transaction([
        prisma.user.findMany({}),
        prisma.user.update({
          where: {
            email: 'notthere@example.com',
          },
          data: {
            memo: 'id is 1',
          },
        }),
        prisma.user.findMany({}),
      ])
      .catch((error) => error)

    expect(error.name).toBe('PrismaClientKnownRequestError')
    expect(error.code).toBe('P2025')
    expect(error.batchRequestIdx).toBe(1)
    expect(error.message).toContain('Invalid `prisma.user.update()` invocation')
  })

  test('reports the index of a record not found in a batch of findUniqueOrThrow', async () => {
    await prisma.user.create({ data: { email: 'found@example.com' } })

    const error = await prisma
      .$transaction([
        prisma.user.findUniqueOrThrow({ where: { email: 'found@example.com' } }),
        prisma.user.findUniqueOrThrow({ where: { email: 'notthere@example.com' } }),
      ])
      .catch((error) => error)

    expect(error.name).toBe('PrismaClientKnownRequestError')
    expect(error.code).toBe('P2025')
    expect(error.batchRequestIdx).toBe(1)
  })

  test('reports the failed query even when a query skipped after it rejects first', async () => {
    await prisma.user.create({ data: { email: 'taken@example.com' } })

    let openGate!: () => void
    const gate = new Promise<void>((resolve) => (openGate = resolve))
    const seen: { operation: string; code: string; batchRequestIdx: unknown }[] = []
    const xprisma = prisma.$extends({
      query: {
        $allOperations: async ({ operation, args, query }) => {
          try {
            return await query(args)
          } catch (error) {
            seen.push({
              operation,
              code: error.code,
              batchRequestIdx: error.batchRequestIdx,
            })
            // the failed create rejects only after the skipped findMany has rejected
            if (operation === 'create') await gate
            else openGate()
            throw error
          }
        },
      },
    })

    const error = await xprisma
      .$transaction([
        xprisma.user.findMany({}),
        xprisma.user.create({ data: { email: 'taken@example.com' } }),
        xprisma.user.findMany({}),
      ])
      .catch((error) => error)

    expect(error.name).toBe('PrismaClientKnownRequestError')
    expect(error.code).toBe('P2002')
    expect(error.batchRequestIdx).toBe(1)
    expect(error.message).toContain('.user.create()` invocation')
    expect(seen).toEqual([
      { operation: 'create', code: 'P2002', batchRequestIdx: 1 },
      { operation: 'findMany', code: 'P2002', batchRequestIdx: 1 },
    ])
  })

  // the remote executor rethrows the error Accelerate returned, which has no model for the skipped queries
  testIf(clientEngineExecutor !== 'remote')('gives the queries skipped after the failed one its model', async () => {
    const seen: { model: unknown; code: string; modelName: unknown }[] = []
    const xprisma = prisma.$extends({
      query: {
        $allOperations: async ({ model, args, query }) => {
          try {
            return await query(args)
          } catch (error) {
            seen.push({ model, code: error.code, modelName: error.meta?.modelName })
            throw error
          }
        },
      },
    })

    const error = await xprisma
      .$transaction([
        xprisma.user.findMany({}),
        xprisma.user.update({ where: { email: 'notthere@example.com' }, data: { memo: 'id is 1' } }),
        xprisma.post.findMany({}),
      ])
      .catch((error) => error)

    expect(error.code).toBe('P2025')
    expect(error.batchRequestIdx).toBe(1)
    expect(error.meta.modelName).toBe('User')
    expect(seen).toEqual([
      { model: 'User', code: 'P2025', modelName: 'User' },
      { model: 'Post', code: 'P2025', modelName: 'User' },
    ])
  })
})
