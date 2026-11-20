import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

class Name {
  constructor(readonly equals: string) {}
  toJSON() {
    return 'from-toJSON'
  }
}

/**
 * Regression test for https://github.com/prisma/orm/issues/30738
 * A query extension must not change how an argument with a toJSON method is serialized.
 */
testMatrix.setupTestSuite(() => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [{ name: 'from-toJSON' }, { name: 'from-field' }] })
  })

  test('base client serializes the value through toJSON', async () => {
    const users = await prisma.user.findMany({ where: { name: new Name('from-field') }, select: { name: true } })

    expect(users).toEqual([{ name: 'from-toJSON' }])
  })

  test('client with a pass-through query extension serializes the value through toJSON', async () => {
    const xprisma = prisma.$extends({
      query: {
        $allOperations: ({ args, query }) => query(args),
      },
    })

    const users = await xprisma.user.findMany({ where: { name: new Name('from-field') }, select: { name: true } })

    expect(users).toEqual([{ name: 'from-toJSON' }])
  })
})
