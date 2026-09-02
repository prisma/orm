import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    beforeAll(async () => {
      // Item 1: localisation "Banana"
      await prisma.item.create({
        data: {
          localization: {
            create: [{ name: 'Banana' }],
          },
        },
      })

      // Item 2: localisation "Apple"
      await prisma.item.create({
        data: {
          localization: {
            create: [{ name: 'Apple' }],
          },
        },
      })

      // Item 3: localisation "Cherry"
      await prisma.item.create({
        data: {
          localization: {
            create: [{ name: 'Cherry' }],
          },
        },
      })

      // Item 4: no localisations (produces NULL in the correlated subquery)
      await prisma.item.create({ data: {} })
    })

    test('orderBy relation field ascending returns items in alphabetical order', async () => {
      const items = await prisma.item.findMany({
        select: {
          localization: { select: { name: true } },
        },
        // Use explicit nulls: 'last' to get deterministic NULL placement across all providers.
        orderBy: {
          localization: { name: { sort: 'asc', nulls: 'last' } },
        },
      })

      // Non-null names: Apple < Banana < Cherry, then the item with no localization last.
      expect(items.map((i) => i.localization.map((l) => l.name))).toEqual([['Apple'], ['Banana'], ['Cherry'], []])
    })

    test('orderBy relation field descending returns items in reverse alphabetical order', async () => {
      const items = await prisma.item.findMany({
        select: {
          localization: { select: { name: true } },
        },
        // Use explicit nulls: 'last' to get deterministic NULL placement across all providers.
        orderBy: {
          localization: { name: { sort: 'desc', nulls: 'last' } },
        },
      })

      // Non-null names: Cherry > Banana > Apple, then the item with no localization last.
      expect(items.map((i) => i.localization.map((l) => l.name))).toEqual([['Cherry'], ['Banana'], ['Apple'], []])
    })

    test('item with no localization appears when nulls are placed first', async () => {
      const items = await prisma.item.findMany({
        select: {
          id: true,
          localization: { select: { name: true } },
        },
        orderBy: {
          localization: { name: { sort: 'asc', nulls: 'first' } },
        },
      })

      // First item should be the one without any localization.
      expect(items[0].localization).toHaveLength(0)
    })

    test('orderBy relation field _count still works after the change', async () => {
      const items = await prisma.item.findMany({
        select: {
          localization: { select: { name: true } },
        },
        orderBy: {
          localization: { _count: 'desc' },
        },
      })

      // All non-empty items have exactly 1 localization each; item 4 has 0.
      // All three non-empty items come first.
      const locCounts = items.map((i) => i.localization.length)
      expect(locCounts[locCounts.length - 1]).toBe(0)
    })

    test('multiple orderBy entries combining scalar field and direct field are supported', async () => {
      const items = await prisma.item.findMany({
        select: {
          id: true,
          localization: { select: { name: true } },
        },
        // nulls: 'last' makes NULL placement deterministic across all SQL providers.
        // Secondary sort by id resolves any tie-breaking for the NULL item.
        orderBy: [{ localization: { name: { sort: 'asc', nulls: 'last' } } }, { id: 'asc' }],
      })

      // Apple, Banana, Cherry ordered by localization.name asc; item with no localization last.
      expect(items).toHaveLength(4)
      expect(items.map((i) => i.localization.map((l) => l.name))).toEqual([['Apple'], ['Banana'], ['Cherry'], []])
    })
  },
  {
    optOut: {
      from: [Providers.MONGODB],
      reason: 'orderBy on to-many relation scalar fields is only supported for SQL providers',
    },
  },
)
