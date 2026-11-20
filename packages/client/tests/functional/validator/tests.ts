import { expectTypeOf } from 'expect-type'

import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare let Prisma: typeof PrismaNamespace

testMatrix.setupTestSuite(
  ({ generatorType }) => {
    testIf(generatorType === 'prisma-client-js')('validation via non-extended client', () => {
      const data1 = Prisma.validator<PrismaNamespace.UserSelect>()({
        id: true,
      })
      expectTypeOf(data1).toMatchTypeOf<{ id: true }>()
      expect(data1).toEqual({ id: true })

      Prisma.validator<PrismaNamespace.UserSelect>()({
        // @ts-expect-error
        wrong: {},
      })

      const data2 = Prisma.validator(
        prisma,
        'user',
        'findFirst',
      )({
        select: { id: true },
      })
      expectTypeOf(data2).toEqualTypeOf<{ select: { id: true } }>()
      expect(data2).toEqual({ select: { id: true } })

      Prisma.validator(
        prisma,
        'user',
        'findFirst',
      )({
        // @ts-expect-error
        select: { wrong: {} },
      })

      const data3 = Prisma.validator(
        prisma,
        'user',
        'create',
        'data',
      )({
        id: '1',
      })
      expectTypeOf(data3).toEqualTypeOf<{ id: '1' }>()
      expect(data3).toEqual({ id: '1' })

      Prisma.validator(
        prisma,
        'user',
        'create',
        'data',
      )({
        // @ts-expect-error
        wrong: {},
      })

      const data4 = Prisma.validator(
        prisma,
        'user',
        'create',
        'select',
      )({
        id: true,
      })
      expectTypeOf(data4).toEqualTypeOf<{ id: true }>()
      expect(data4).toEqual({ id: true })

      Prisma.validator(
        prisma,
        'user',
        'create',
        'select',
      )({
        // @ts-expect-error
        wrong: {},
      })
    })

    testIf(generatorType === 'prisma-client-js')('validation via extended client', () => {
      const xprisma = prisma.$extends({
        result: {
          user: {
            prop: {
              compute() {
                return 1
              },
              needs: { id: true },
            },
          },
        },
      })

      const data1 = Prisma.validator<PrismaNamespace.UserSelect>()({
        id: true,
      })
      expectTypeOf(data1).toMatchTypeOf<{ id: true }>()
      expect(data1).toEqual({ id: true })

      Prisma.validator<PrismaNamespace.UserSelect>()({
        // @ts-expect-error
        wrong: {},
      })

      const data2 = Prisma.validator(
        xprisma,
        'user',
        'findFirst',
      )({
        select: { prop: true },
      })
      expectTypeOf(data2).toEqualTypeOf<{ select: { prop: true } }>()
      expect(data2).toEqual({ select: { prop: true } })

      Prisma.validator(
        xprisma,
        'user',
        'findFirst',
      )({
        // @ts-expect-error
        select: { wrong: {} },
      })

      const data3 = Prisma.validator(
        xprisma,
        'user',
        'create',
        'data',
      )({
        id: '1',
      })
      expectTypeOf(data3).toEqualTypeOf<{ id: '1' }>()
      expect(data3).toEqual({ id: '1' })

      Prisma.validator(
        xprisma,
        'user',
        'create',
        'data',
      )({
        // @ts-expect-error
        wrong: {},
      })

      const data4 = Prisma.validator(
        xprisma,
        'user',
        'create',
        'select',
      )({
        id: true,
        prop: true,
      })
      expectTypeOf(data4).toEqualTypeOf<{ id: true; prop: true }>()
      expect(data4).toEqual({ id: true, prop: true })

      Prisma.validator(
        xprisma,
        'user',
        'create',
        'select',
      )({
        // @ts-expect-error
        wrong: {},
      })
    })
  },
  {
    optOut: {
      from: ['sqlite', 'mysql', 'mongodb', 'cockroachdb', 'sqlserver'],
      reason: 'This is mostly a type-level test, but we want to assert that queries still work with the validator.',
    },
  },
)
