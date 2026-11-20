import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('correctly pushes to array field', async () => {
      const item = await prisma.item.create({
        data: {
          name: 'Test',
          tags: ['a', 'b', 'c'],
        },
      })

      const updated = await prisma.item.update({
        where: { id: item.id },
        data: { tags: { push: ['foo', 'bar'] } },
      })

      expect(updated).toMatchObject({
        id: item.id,
        name: 'Test',
        tags: ['a', 'b', 'c', 'foo', 'bar'],
      })
    })
  },
  {
    optOut: {
      from: ['mysql', 'sqlite', 'sqlserver'],
      reason: 'Array push is not supported on these providers',
    },
  },
)
