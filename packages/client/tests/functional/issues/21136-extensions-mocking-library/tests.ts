import { expectTypeOf } from 'expect-type'

import { Providers } from '../../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type * as $ from './generated/prisma/client'

declare let prisma: $.PrismaClient

// this is a minimal type representation of a mocking library originally taken
// from `vitest-mock-extended` which is a fork of `jest-mock-extended`
interface Mock<A extends any[] = any[], R = any> {
  new (...args: A): R
  (...args: A): R

  mockReturnValue(obj: R): this
  mockResolvedValue(obj: Awaited<R>): this
  calledWith: (...args: A) => Mock<A, R>
}

// this is the actual interesting bit, a proxy that recursively mocks all
// functions, and also happened not to play well with Accelerate inference
type DeepMockProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<A, R> : DeepMockProxy<T[K]>
} & T

// this is ma minimal representation of a mocking proxy, doesn't do anything
declare function mockDeep<T>(_mockImplementation?: T): DeepMockProxy<T>

function getOverrideExtension(prisma: $.PrismaClient) {
  return prisma.$extends({
    model: {
      $allModels: {
        aggregate<T, A>(
          this: T,
          _args: $.Prisma.Exact<A, $.Prisma.Args<T, 'aggregate'>>,
        ): $.Prisma.Result<T, A, 'aggregate'> {
          return {} as any
        },
        count<T, A>(this: T, _args?: $.Prisma.Exact<A, $.Prisma.Args<T, 'count'>>): $.Prisma.Result<T, A, 'count'> {
          return {} as any
        },
        findFirst<T, A>(
          this: T,
          _args?: $.Prisma.Exact<A, $.Prisma.Args<T, 'findFirst'>>,
        ): $.Prisma.Result<T, A, 'findFirst'> {
          return {} as any
        },
        findFirstOrThrow<T, A>(
          this: T,
          _args?: $.Prisma.Exact<A, $.Prisma.Args<T, 'findFirstOrThrow'>>,
        ): $.Prisma.Result<T, A, 'findFirstOrThrow'> {
          return {} as any
        },
        findMany<T, A>(
          this: T,
          _args?: $.Prisma.Exact<A, $.Prisma.Args<T, 'findMany'>>,
        ): $.Prisma.Result<T, A, 'findMany'> {
          return {} as any
        },
        findUnique<T, A>(
          this: T,
          _args: $.Prisma.Exact<A, $.Prisma.Args<T, 'findUnique'>>,
        ): $.Prisma.Result<T, A, 'findUnique'> {
          return {} as any
        },
        findUniqueOrThrow<T, A>(
          this: T,
          _args: $.Prisma.Exact<A, $.Prisma.Args<T, 'findUniqueOrThrow'>>,
        ): $.Prisma.Result<T, A, 'findUniqueOrThrow'> {
          return {} as any
        },
        groupBy<T, A>(
          this: T,
          _args: $.Prisma.Exact<A, $.Prisma.Args<T, 'groupBy'>>,
        ): $.Prisma.Result<T, A, 'groupBy'> {
          return {} as any
        },
      },
    },
  })
}

testMatrix.setupTestSuite(
  () => {
    describe('with full override extension', () => {
      test('output inference (via `mockResolvedValue`)', () => {
        ;() => {
          const prismaMock = mockDeep(getOverrideExtension(prisma))

          prismaMock.user.aggregate.mockResolvedValue({})
          prismaMock.user.count.mockResolvedValue(0)
          prismaMock.user.findFirst.mockResolvedValue({})
          prismaMock.user.findFirstOrThrow.mockResolvedValue({})
          prismaMock.user.findMany.mockResolvedValue([{}])
          prismaMock.user.findUnique.mockResolvedValue({})
          prismaMock.user.findUniqueOrThrow.mockResolvedValue({})
          prismaMock.user.groupBy.mockResolvedValue([{}])

          expectTypeOf(prismaMock.user.aggregate.mockResolvedValue).parameter(0).toEqualTypeOf<{}>()
          expectTypeOf(prismaMock.user.count.mockResolvedValue).parameter(0).toEqualTypeOf<number>()
          expectTypeOf(prismaMock.user.findFirst.mockResolvedValue).parameter(0).toEqualTypeOf<{} | null>()
          expectTypeOf(prismaMock.user.findFirstOrThrow.mockResolvedValue).parameter(0).toEqualTypeOf<{}>()
          expectTypeOf(prismaMock.user.findMany.mockResolvedValue).parameter(0).toEqualTypeOf<{}[]>()
          expectTypeOf(prismaMock.user.findUnique.mockResolvedValue).parameter(0).toEqualTypeOf<{} | null>()
          expectTypeOf(prismaMock.user.findUniqueOrThrow.mockResolvedValue).parameter(0).toEqualTypeOf<{}>()
          expectTypeOf(prismaMock.user.groupBy.mockResolvedValue).parameter(0).toEqualTypeOf<{}[]>()
        }
      })

      test('input inference (via `calledWith`)', () => {
        ;() => {
          const prismaMock = mockDeep(getOverrideExtension(prisma))

          prismaMock.user.aggregate.calledWith({ where: { id: 1 } })
          prismaMock.user.count.calledWith({ where: { id: 1 } })
          prismaMock.user.findFirst.calledWith({ where: { id: 1 } })
          prismaMock.user.findFirstOrThrow.calledWith({ where: { id: 1 } })
          prismaMock.user.findMany.calledWith({ where: { id: 1 } })
          prismaMock.user.findUnique.calledWith({ where: { id: 1 } })
          prismaMock.user.findUniqueOrThrow.calledWith({ where: { id: 1 } })
          prismaMock.user.groupBy.calledWith({ where: { id: 1 } })

          expectTypeOf(prismaMock.user.aggregate.calledWith).parameter(0).toEqualTypeOf<{}>()
          expectTypeOf(prismaMock.user.count.calledWith).parameter(0).toEqualTypeOf<{} | undefined>()
          expectTypeOf(prismaMock.user.findFirst.calledWith).parameter(0).toEqualTypeOf<{} | undefined>()
          expectTypeOf(prismaMock.user.findFirstOrThrow.calledWith).parameter(0).toEqualTypeOf<{} | undefined>()
          expectTypeOf(prismaMock.user.findMany.calledWith).parameter(0).toEqualTypeOf<{} | undefined>()
          expectTypeOf(prismaMock.user.findUnique.calledWith).parameter(0).toEqualTypeOf<{}>()
          expectTypeOf(prismaMock.user.findUniqueOrThrow.calledWith).parameter(0).toEqualTypeOf<{}>()
          expectTypeOf(prismaMock.user.groupBy.calledWith).parameter(0).toEqualTypeOf<{}>()
        }
      })

      test('call still work as usual', () => {
        ;() => {
          const prismaMock = mockDeep(getOverrideExtension(prisma))

          const data = prismaMock.user.findFirst({ where: { id: '1' } })
          expectTypeOf(data).toEqualTypeOf<{ id: string } | null>()
        }
      })
    })

    describe('with empty extension', () => {
      test('output inference (via `mockResolvedValue`)', () => {
        ;() => {
          const xprisma = prisma.$extends({})
          const prismaMock = mockDeep(xprisma)

          prismaMock.user.aggregate.mockResolvedValue({})
          prismaMock.user.count.mockResolvedValue(0)
          prismaMock.user.findFirst.mockResolvedValue({ id: '1' })
          prismaMock.user.findFirstOrThrow.mockResolvedValue({ id: '1' })
          prismaMock.user.findMany.mockResolvedValue([{ id: '1' }])
          prismaMock.user.findUnique.mockResolvedValue({ id: '1' })
          prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: '1' })
          prismaMock.user.groupBy.mockResolvedValue([{}])

          expectTypeOf(prismaMock.user.aggregate.mockResolvedValue)
            .parameter(0)
            .toEqualTypeOf<Awaited<ReturnType<typeof xprisma.user.aggregate>>>()
          expectTypeOf(prismaMock.user.count.mockResolvedValue).parameter(0).toEqualTypeOf<number>()
          expectTypeOf(prismaMock.user.findFirst.mockResolvedValue)
            .parameter(0)
            .toEqualTypeOf<Awaited<ReturnType<typeof xprisma.user.findFirst>>>()
          expectTypeOf(prismaMock.user.findFirstOrThrow.mockResolvedValue)
            .parameter(0)
            .toEqualTypeOf<Awaited<ReturnType<typeof xprisma.user.findFirstOrThrow>>>()
          expectTypeOf(prismaMock.user.findMany.mockResolvedValue)
            .parameter(0)
            .toEqualTypeOf<Awaited<ReturnType<typeof xprisma.user.findMany>>>()
          expectTypeOf(prismaMock.user.findUnique.mockResolvedValue)
            .parameter(0)
            .toEqualTypeOf<Awaited<ReturnType<typeof xprisma.user.findUnique>>>()
          expectTypeOf(prismaMock.user.findUniqueOrThrow.mockResolvedValue)
            .parameter(0)
            .toEqualTypeOf<Awaited<ReturnType<typeof xprisma.user.findUniqueOrThrow>>>()
          expectTypeOf(prismaMock.user.groupBy.mockResolvedValue)
            .parameter(0)
            .toEqualTypeOf<Awaited<ReturnType<typeof xprisma.user.groupBy>>>()
        }
      })

      test('input inference (via `calledWith`)', () => {
        ;() => {
          const xprisma = prisma.$extends({})
          const prismaMock = mockDeep(xprisma)

          prismaMock.user.aggregate.calledWith({ where: { id: '1' } })
          prismaMock.user.count.calledWith({ where: { id: '1' } })
          prismaMock.user.findFirst.calledWith({ where: { id: '1' } })
          prismaMock.user.findFirstOrThrow.calledWith({ where: { id: '1' } })
          prismaMock.user.findMany.calledWith({ where: { id: '1' } })
          prismaMock.user.findUnique.calledWith({ where: { id: '1' } })
          prismaMock.user.findUniqueOrThrow.calledWith({ where: { id: '1' } })
          prismaMock.user.groupBy.calledWith({ by: ['id'] })

          expectTypeOf(prismaMock.user.aggregate.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.aggregate>[0]>()
          expectTypeOf(prismaMock.user.count.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.count>[0]>()
          expectTypeOf(prismaMock.user.findFirst.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.findFirst>[0]>()
          expectTypeOf(prismaMock.user.findFirstOrThrow.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.findFirstOrThrow>[0]>()
          expectTypeOf(prismaMock.user.findMany.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.findMany>[0]>()
          expectTypeOf(prismaMock.user.findUnique.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.findUnique>[0]>()
          expectTypeOf(prismaMock.user.findUniqueOrThrow.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.findUniqueOrThrow>[0]>()
          expectTypeOf(prismaMock.user.groupBy.calledWith)
            .parameter(0)
            .toEqualTypeOf<Parameters<typeof xprisma.user.groupBy>[0]>()
        }
      })

      test('call still work as usual', () => {
        ;async () => {
          const xprisma = prisma.$extends({})
          const prismaMock = mockDeep(xprisma)

          const data = await prismaMock.user.findFirst({ where: { id: '1' } })
          expectTypeOf(data).toEqualTypeOf<{ id: string } | null>()
        }
      })
    })
  },
  {
    optOut: {
      from: [Providers.SQLSERVER, Providers.MYSQL, Providers.POSTGRESQL, Providers.COCKROACHDB, Providers.MONGODB],
      reason: 'this is a type-level only test',
    },
    skipDb: true,
  },
)
