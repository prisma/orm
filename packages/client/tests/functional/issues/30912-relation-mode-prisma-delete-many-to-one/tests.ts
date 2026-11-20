import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    beforeEach(async () => {
      await prisma.child.deleteMany()
      await prisma.parent.deleteMany()
      await prisma.group.deleteMany()
      await prisma.nullableChild.deleteMany()
      await prisma.nullableParent.deleteMany()
    })

    test('deleteMany removes every one-to-one child when several parents cascade', async () => {
      await prisma.parent.createMany({ data: [{ id: 'p1' }, { id: 'p2' }] })
      await prisma.child.createMany({
        data: [
          { id: 'c1', parentId: 'p1' },
          { id: 'c2', parentId: 'p2' },
        ],
      })

      await expect(prisma.parent.deleteMany({ where: { id: { in: ['p1', 'p2'] } } })).resolves.toEqual({ count: 2 })

      expect(await prisma.parent.findMany()).toEqual([])
      expect(await prisma.child.findMany()).toEqual([])
    })

    test('deleting one group cascades through each parent one-to-one child', async () => {
      await prisma.group.create({ data: { id: 'g1' } })
      await prisma.parent.createMany({
        data: [
          { id: 'p1', groupId: 'g1' },
          { id: 'p2', groupId: 'g1' },
        ],
      })
      await prisma.child.createMany({
        data: [
          { id: 'c1', parentId: 'p1' },
          { id: 'c2', parentId: 'p2' },
        ],
      })

      await prisma.group.delete({ where: { id: 'g1' } })

      expect(await prisma.group.findMany()).toEqual([])
      expect(await prisma.parent.findMany()).toEqual([])
      expect(await prisma.child.findMany()).toEqual([])
    })

    test('deleteMany still cascades when only one of the parents has a child', async () => {
      await prisma.parent.createMany({ data: [{ id: 'p1' }, { id: 'p2' }] })
      await prisma.child.create({ data: { id: 'c1', parentId: 'p1' } })

      await expect(prisma.parent.deleteMany({ where: { id: { in: ['p1', 'p2'] } } })).resolves.toEqual({ count: 2 })

      expect(await prisma.child.findMany()).toEqual([])
    })

    test('deleteMany of one parent still cascades its one child', async () => {
      await prisma.parent.create({ data: { id: 'p1' } })
      await prisma.child.create({ data: { id: 'c1', parentId: 'p1' } })

      await expect(prisma.parent.deleteMany({ where: { id: 'p1' } })).resolves.toEqual({ count: 1 })

      expect(await prisma.child.findMany()).toEqual([])
    })

    test('setNull on a one-to-one clears every child when several parents are deleted', async () => {
      await prisma.nullableParent.createMany({ data: [{ id: 'p1' }, { id: 'p2' }] })
      await prisma.nullableChild.createMany({
        data: [
          { id: 'c1', parentId: 'p1' },
          { id: 'c2', parentId: 'p2' },
        ],
      })

      await expect(prisma.nullableParent.deleteMany()).resolves.toEqual({ count: 2 })

      expect(await prisma.nullableChild.findMany({ orderBy: { id: 'asc' } })).toEqual([
        { id: 'c1', parentId: null },
        { id: 'c2', parentId: null },
      ])
    })
  },
  {
    optOut: {
      from: ['mongodb', 'sqlserver', 'cockroachdb'],
      reason: 'relationMode = "prisma" cascade emulation is covered on sqlite, mysql, and postgresql',
    },
  },
)
