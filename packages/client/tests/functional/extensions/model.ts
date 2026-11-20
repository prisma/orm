/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { expectTypeOf } from 'expect-type'

import { Providers } from '../_utils/providers'
import { waitFor } from '../_utils/tests/waitFor'
import { NewPrismaClient } from '../_utils/types'
import { providersSupportingRelationJoins } from '../relation-load-strategy/_common'
import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let Prisma: typeof PrismaNamespace
let prisma: PrismaClient
declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

testMatrix.setupTestSuite(
  ({ provider, driverAdapter, clientEngineExecutor }, _suiteMeta, _clientMeta, cliMeta) => {
    const isSqlServer = provider === Providers.SQLSERVER

    beforeEach(() => {
      prisma = newPrismaClient({
        log: [{ emit: 'event', level: 'query' }],
      })
    })

    afterEach(async () => {
      await prisma.$disconnect()
    })

    test('extend specific model', () => {
      const extMethod = jest.fn()
      const xprisma = prisma.$extends({
        model: {
          user: {
            extMethod,
          },
        },
      })

      xprisma.user.extMethod()

      expect(extMethod).toHaveBeenCalledTimes(1)
      expect((xprisma.post as any).extMethod).toBeUndefined()
    })

    test('chain $on with $extends', () => {
      const fnEmitter = jest.fn()
      const extMethod = jest.fn()

      const xprisma = newPrismaClient({
        log: [{ emit: 'event', level: 'query' }],
      })
        // @ts-expect-error - client not typed for log opts for cross generator compatibility - can be improved once we drop the prisma-client-js generator
        .$on('query', fnEmitter)
        .$extends({
          model: {
            user: {
              extMethod,
            },
          },
        })

      xprisma.user.extMethod()

      expect(extMethod).toHaveBeenCalledTimes(1)
    })

    test('extend all models', () => {
      const extMethod = jest.fn()
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            extMethod,
          },
        },
      })

      xprisma.user.extMethod()
      xprisma.post.extMethod()

      expect(extMethod).toHaveBeenCalledTimes(2)
    })

    test('pass arguments to ext method', () => {
      const extMethod = jest.fn()
      const xprisma = prisma.$extends({
        model: {
          user: {
            extMethod,
          },
        },
      })

      xprisma.user.extMethod('hello', 'world')
      expect(extMethod).toHaveBeenCalledWith('hello', 'world')
    })

    test('return value to ext method', () => {
      const extMethod = jest.fn().mockReturnValue('hi!')
      const xprisma = prisma.$extends({
        model: {
          user: {
            extMethod,
          },
        },
      })

      expect(xprisma.user.extMethod()).toBe('hi!')
    })

    test('specific model extension has precedence over $allModels', () => {
      const genericMethod = jest.fn()
      const specificMethod = jest.fn()
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            extMethod: genericMethod,
          },
          user: {
            extMethod: specificMethod,
          },
        },
      })

      xprisma.user.extMethod()

      expect(specificMethod).toHaveBeenCalled()
      expect(genericMethod).not.toHaveBeenCalled()
    })

    test('last extension takes precedence over earlier ones', () => {
      const firstMethod = jest.fn()
      const secondMethod = jest.fn()
      const xprisma = prisma
        .$extends({
          model: {
            user: {
              extMethod: firstMethod,
            },
          },
        })
        .$extends({
          model: {
            user: {
              extMethod: secondMethod,
            },
          },
        })

      xprisma.user.extMethod()

      expect(secondMethod).toHaveBeenCalled()
      expect(firstMethod).not.toHaveBeenCalled()
    })

    test('allows to override built-in methods', () => {
      const extMethod = jest.fn()
      const xprisma = prisma.$extends({
        model: {
          user: {
            findFirst() {
              extMethod()

              return undefined
            },
          },
        },
      })

      const findFirstData = xprisma.user.findFirst()
      // @ts-expect-error
      void xprisma.user.findFirst({})

      expect(findFirstData).toBeUndefined()
      expectTypeOf(findFirstData).toEqualTypeOf<undefined>()
      expect(extMethod).toHaveBeenCalled()
    })

    test('non-conflicting extensions can co-exist', () => {
      const firstMethod = jest.fn()
      const secondMethod = jest.fn()
      const xprisma = prisma
        .$extends({
          model: {
            user: {
              firstMethod,
            },
          },
        })
        .$extends({
          model: {
            user: {
              secondMethod,
            },
          },
        })

      xprisma.user.firstMethod()
      xprisma.user.secondMethod()

      expect(firstMethod).toHaveBeenCalled()
      expect(secondMethod).toHaveBeenCalled()
    })

    test('extension methods can call each other', () => {
      const helper = jest.fn()
      const xprisma = prisma.$extends({
        model: {
          user: {
            helper,
            extMethod() {
              this.helper()
            },
          },
        },
      })

      xprisma.user.extMethod()
      expect(helper).toHaveBeenCalled()
    })

    test('extension methods can call model methods', async () => {
      const xprisma = prisma.$extends({
        model: {
          user: {
            myFind() {
              const ctx = Prisma.getExtensionContext(this)

              return ctx.findMany({})
            },
          },
        },
      })

      const users = await xprisma.user.myFind()
      expect(users).toEqual([])
    })

    test('extension methods can call methods of other extensions', () => {
      const firstMethod = jest.fn()
      const xprisma = prisma
        .$extends({
          model: {
            user: {
              firstMethod,
            },
          },
        })
        .$extends({
          model: {
            user: {
              secondMethod() {
                const ctx = Prisma.getExtensionContext(this)

                ctx.firstMethod()
              },
            },
          },
        })

      xprisma.user.secondMethod()

      expect(firstMethod).toHaveBeenCalled()
    })

    test('empty extension does nothing', async () => {
      const xprisma = prisma
        .$extends({
          model: {
            user: {
              myFind() {
                const ctx = Prisma.getExtensionContext(this)

                return ctx.findMany({})
              },
            },
          },
        })
        .$extends({})
        .$extends({
          model: {
            user: {},
          },
        })

      const users = await xprisma.user.myFind()
      expect(users).toEqual([])
    })

    test('only accepts methods', () => {
      prisma.$extends({
        // TODO -@-ts-expect-error
        model: {
          badInput: 1,
        },
      })
    })

    test('error in extension methods', () => {
      const xprisma = prisma.$extends({
        name: 'Faulty model',
        model: {
          user: {
            fail() {
              throw new Error('Fail!')
            },
          },
        },
      })

      expect(() => xprisma.user.fail()).toThrowErrorMatchingInlineSnapshot(`"Fail!"`)
    })

    test('error in async methods', async () => {
      const xprisma = prisma.$extends({
        name: 'Faulty model',
        model: {
          user: {
            fail() {
              return Promise.reject(new Error('Fail!'))
            },
          },
        },
      })

      await expect(xprisma.user.fail()).rejects.toThrowErrorMatchingInlineSnapshot(`"Fail!"`)
    })

    test('error in async PrismaPromise methods', async () => {
      const xprisma = prisma.$extends((client) => {
        return client.$extends({
          name: 'Faulty model',
          model: {
            user: {
              fail() {
                const ctx = Prisma.getExtensionContext(this)
                return ctx.findUnique({
                  // @ts-expect-error
                  badInput: true,
                })
              },
            },
          },
        })
      })

      if (cliMeta.previewFeatures.includes('relationJoins') && providersSupportingRelationJoins.includes(provider)) {
        await expect(xprisma.user.fail()).rejects.toThrowErrorMatchingInlineSnapshot(`
          "
          Invalid \`prisma.user.findUnique()\` invocation:

          {
            badInput: true,
            ~~~~~~~~
          ? where?: UserWhereUniqueInput,
          ? relationLoadStrategy?: RelationLoadStrategy
          }

          Unknown argument \`badInput\`. Available options are marked with ?."
        `)
      } else {
        await expect(xprisma.user.fail()).rejects.toThrowErrorMatchingInlineSnapshot(`
          "
          Invalid \`prisma.user.findUnique()\` invocation:

          {
            badInput: true,
            ~~~~~~~~
          ? where?: UserWhereUniqueInput
          }

          Unknown argument \`badInput\`. Available options are marked with ?."
        `)
      }
    })

    testIf(provider !== Providers.MONGODB && process.platform !== 'win32')(
      'batching of PrismaPromise returning custom model methods',
      async () => {
        const fnEmitter = jest.fn()

        // @ts-expect-error - client not typed for log opts for cross generator compatibility - can be improved once we drop the prisma-client-js generator
        prisma.$on('query', fnEmitter)

        const xprisma = prisma.$extends({
          model: {
            user: {
              fn() {
                const ctx = Prisma.getExtensionContext(this)
                return Object.assign(ctx.findFirst(), { prop: 'value' })
              },
            },
          },
        })

        const data = await xprisma.$transaction([xprisma.user.fn(), xprisma.user.fn()])

        expect(data).toMatchInlineSnapshot(`
        [
          null,
          null,
        ]
      `)

        await waitFor(() => {
          const expectation = [
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('COMMIT') }],
          ]
          if (driverAdapter === undefined && clientEngineExecutor !== 'remote') {
            // Driver adapters do not issue BEGIN through the query engine.
            expectation.unshift([{ query: expect.stringContaining('BEGIN') }])
            if (isSqlServer) {
              expectation.unshift([{ query: expect.stringContaining('SET TRANSACTION') }])
            }
          }
          expect(fnEmitter).toHaveBeenCalledTimes(expectation.length)
          expect(fnEmitter.mock.calls).toMatchObject(expectation)
        })
      },
    )

    testIf(provider !== Providers.MONGODB && process.platform !== 'win32')(
      'batching of PrismaPromise returning custom model methods and query',
      async () => {
        const fnEmitter = jest.fn()

        // @ts-expect-error - client not typed for log opts for cross generator compatibility - can be improved once we drop the prisma-client-js generator
        prisma.$on('query', fnEmitter)

        const xprisma = prisma
          .$extends({
            model: {
              user: {
                fn() {
                  const ctx = Prisma.getExtensionContext(this)
                  return Object.assign(ctx.findFirst(), { prop: 'value' })
                },
              },
            },
          })
          .$extends({
            query: {
              $allModels: {
                async $allOperations({ query, args }) {
                  // test if await has any side effects
                  const data = await query(args)

                  return data
                },
              },
            },
          })

        const data = await xprisma.$transaction([xprisma.user.fn(), xprisma.user.fn()])

        expect(data).toMatchInlineSnapshot(`
                [
                  null,
                  null,
                ]
              `)

        await waitFor(() => {
          const expectation = [
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('COMMIT') }],
          ]
          if (driverAdapter === undefined && clientEngineExecutor !== 'remote') {
            // Driver adapters do not issue BEGIN through the query engine.
            expectation.unshift([{ query: expect.stringContaining('BEGIN') }])
            if (isSqlServer) {
              expectation.unshift([{ query: expect.stringContaining('SET TRANSACTION') }])
            }
          }
          expect(fnEmitter).toHaveBeenCalledTimes(expectation.length)
          expect(fnEmitter.mock.calls).toMatchObject(expectation)
        })
      },
    )

    test('error in extension methods without name', () => {
      const xprisma = prisma.$extends({
        model: {
          user: {
            fail() {
              throw new Error('Fail!')
            },
          },
        },
      })

      expect(() => xprisma.user.fail()).toThrowErrorMatchingInlineSnapshot(`"Fail!"`)
    })

    test('custom method re-using input types to augment them via intersection', () => {
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            findFirstOrCreate<T, A>(
              this: T,
              args: PrismaNamespace.Exact<
                A,
                PrismaNamespace.Args<T, 'findUniqueOrThrow'> & {
                  cache: boolean
                }
              >,
            ): A {
              return args as any as A
            },
          },
        },
      })

      const args = xprisma.user.findFirstOrCreate({
        cache: true,
        where: {
          id: '1',
        },
      })

      expectTypeOf(args).toHaveProperty('cache').toEqualTypeOf<true>()
      expectTypeOf(args).toHaveProperty('where').toEqualTypeOf<{ id: '1' }>()
    })

    test('custom method re-using input types to augment them via mapped type', () => {
      type Nullable<T> = {
        [K in keyof T]: T[K] | null
      }

      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            findFirstOrCreate<T, A>(
              this: T,
              args: PrismaNamespace.Exact<A, Nullable<PrismaNamespace.Args<T, 'findUniqueOrThrow'>>>,
            ): A {
              return args as any
            },
          },
        },
      })

      const args = xprisma.user.findFirstOrCreate({
        include: null,
        where: {
          id: '1',
        },
      })

      expectTypeOf(args).toHaveProperty('include').toEqualTypeOf<null>()
      expectTypeOf(args).toHaveProperty('where').toEqualTypeOf<{ id: '1' }>()
    })

    test('custom method re-using output to augment it via intersection', () => {
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            findFirstOrCreate<T, A>(
              this: T,
              _args: PrismaNamespace.Exact<A, PrismaNamespace.Args<T, 'findUniqueOrThrow'>>,
            ): PrismaNamespace.Result<T, A, 'findUniqueOrThrow'> & { extra: boolean } {
              return {} as any
            },
          },
        },
      })

      const data = xprisma.user.findFirstOrCreate({
        where: {
          id: '1',
        },
      })

      expectTypeOf(data).toHaveProperty('extra').toEqualTypeOf<boolean>()
      expectTypeOf(data).toHaveProperty('id').toEqualTypeOf<string>()
      expectTypeOf(data).toHaveProperty('email').toEqualTypeOf<string>()
      expectTypeOf(data).toHaveProperty('firstName').toEqualTypeOf<string>()
      expectTypeOf(data).toHaveProperty('lastName').toEqualTypeOf<string>()
    })

    test('custom method re-using payload output types', () => {
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            findFirstOrCreate<T>(this: T) {
              return {} as PrismaNamespace.Payload<T, 'findUniqueOrThrow'>
            },
          },
        },
      })

      const data = xprisma.user.findFirstOrCreate()

      expectTypeOf<typeof data>().toHaveProperty('scalars').toMatchTypeOf<object>()
      expectTypeOf<typeof data>().toHaveProperty('objects').toMatchTypeOf<object>()
      expectTypeOf<(typeof data)['scalars']>().toHaveProperty('id').toMatchTypeOf<string>()
      expectTypeOf<(typeof data)['objects']>().toHaveProperty('posts').toMatchTypeOf<object>()
      expectTypeOf<(typeof data)['objects']['posts']>().toMatchTypeOf<object[]>()
      expectTypeOf<(typeof data)['objects']['posts'][0]>().toMatchTypeOf<object>()
      expectTypeOf<(typeof data)['objects']['posts'][0]>().toHaveProperty('scalars').toMatchTypeOf<object>()
      expectTypeOf<(typeof data)['objects']['posts'][0]>().toHaveProperty('objects').toMatchTypeOf<object>()
    })

    test('custom method that uses exact for narrowing inputs', () => {
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            findFirstOrCreate<T, A>(
              this: T,
              _args: PrismaNamespace.Exact<
                A,
                {
                  guestName: string
                  foodChoice: ('starters' | 'main' | 'desert' | 'drink')[]
                  allergies: string[]
                  vegan: boolean
                }
              >,
            ): A {
              return {} as any
            },
          },
        },
      })

      const data = xprisma.user.findFirstOrCreate({
        allergies: ['nuts'],
        foodChoice: ['starters', 'main'],
        guestName: 'John',
        vegan: false,
      })

      expectTypeOf(data).toEqualTypeOf<{
        allergies: ['nuts']
        foodChoice: ['starters', 'main']
        guestName: 'John'
        vegan: false
      }>()

      void xprisma.user.findFirstOrCreate({
        // @ts-expect-error
        allergies: 'invalid',
        // @ts-expect-error
        foodChoice: ['starters', 'invalid'],
        // @ts-expect-error
        guestName: null,
        // @ts-expect-error
        vegan: 'invalid',
      })
    })

    test('custom method that uses exact for narrowing generic inputs', () => {
      type Pick<T, K extends string | number | symbol> = {
        [P in keyof T as P extends K ? P : never]: T[P]
      }

      type Input<T> = {
        where: Pick<
          PrismaNamespace.Args<T, 'findMany'>['where'],
          keyof PrismaNamespace.Payload<T, 'findMany'>['scalars']
        >
        include: PrismaNamespace.Args<T, 'findMany'>['include']
      }

      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            findFirstOrCreate<T, A>(this: T, _args: PrismaNamespace.Exact<A, Input<T>>): A {
              return {} as any
            },
          },
        },
      })

      const data = xprisma.user.findFirstOrCreate({
        where: {
          email: 'test',
          // @ts-expect-error
          posts: {
            none: {
              id: '1',
            },
          },
        },
        include: {},
      })

      expectTypeOf(data).toEqualTypeOf<{
        where: {
          email: 'test'
          posts: {
            none: {
              id: '1'
            }
          }
        }
        include: {}
      }>()
    })

    test('getExtension context on specific model and non-generic this', () => {
      const xprisma = prisma.$extends({
        model: {
          user: {
            myCustomCallB() {},
            myCustomCallA() {
              const ctx = Prisma.getExtensionContext(this)

              expect(ctx.name).toEqual('User')
              expect(ctx.$name).toEqual('User')

              return ctx
            },
          },
        },
      })

      const ctx = xprisma.user.myCustomCallA()
      expectTypeOf(ctx).toHaveProperty('name').toEqualTypeOf<'User'>()
      expectTypeOf(ctx).toHaveProperty('myCustomCallB').toEqualTypeOf<() => void>()
      expectTypeOf(ctx).toHaveProperty('update').toMatchTypeOf<Function>()
    })

    test('getExtension context on generic model and non-generic this', () => {
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            myCustomCallB() {},
            myCustomCallA() {
              const ctx = Prisma.getExtensionContext(this)

              expect(ctx.name).toEqual('User')
              expect(ctx.$name).toEqual('User')

              return ctx
            },
          },
        },
      })

      const ctx = xprisma.user.myCustomCallA()
      expectTypeOf(ctx).toHaveProperty('name').toEqualTypeOf<string | undefined>()
      expectTypeOf(ctx).toHaveProperty('$name').toEqualTypeOf<string | undefined>()
      expectTypeOf(ctx).toHaveProperty('myCustomCallB').toEqualTypeOf<() => void>()
      expectTypeOf(ctx).not.toHaveProperty('update')
    })

    test('getExtension context on specific model and generic this', () => {
      const xprisma = prisma.$extends({
        model: {
          user: {
            myCustomCallB() {},
            myCustomCallA<T>(this: T) {
              const ctx = Prisma.getExtensionContext(this)

              expect(ctx.name).toEqual('User')
              expect(ctx.$name).toEqual('User')

              return ctx
            },
          },
        },
      })

      const ctx = xprisma.user.myCustomCallA()
      expectTypeOf(ctx).toHaveProperty('name').toEqualTypeOf<string | undefined>()
      expectTypeOf(ctx).toHaveProperty('$name').toEqualTypeOf<string | undefined>()
      expectTypeOf(ctx).toHaveProperty('myCustomCallB').toEqualTypeOf<() => void>()
      expectTypeOf(ctx).toHaveProperty('update').toMatchTypeOf<Function>()
    })

    test('getExtension context on generic model and generic this', () => {
      const xprisma = prisma.$extends({
        model: {
          $allModels: {
            myCustomCallB() {},
            myCustomCallA<T>(this: T) {
              const ctx = Prisma.getExtensionContext(this)

              expect(ctx.name).toEqual('User')
              expect(ctx.$name).toEqual('User')

              return ctx
            },
          },
        },
      })

      const ctx = xprisma.user.myCustomCallA()
      expectTypeOf(ctx).toHaveProperty('name').toEqualTypeOf<string | undefined>()
      expectTypeOf(ctx).toHaveProperty('$name').toEqualTypeOf<string | undefined>()
      expectTypeOf(ctx).toHaveProperty('myCustomCallB').toEqualTypeOf<() => void>()
      expectTypeOf(ctx).toHaveProperty('update').toMatchTypeOf<Function>()
    })

    test('one specific user extension along a generic $allModels model extension', () => {
      const myCustomCallA = jest.fn()
      const myCustomCallB = jest.fn()

      const xprisma = prisma.$extends({
        model: {
          user: {
            myCustomCallB(input: string) {
              myCustomCallB(input)
              return input
            },
          },
          $allModels: {
            myCustomCallA(input: number) {
              myCustomCallA(input)
              return input
            },
          },
        },
      })

      const results = [
        xprisma.user.myCustomCallA(42),
        xprisma.user.myCustomCallA(42),
        xprisma.user.myCustomCallB('Hello'),
      ] as const

      // @ts-expect-error
      expect(() => xprisma.post.myCustomCallB('Hello')).toThrow()

      expect(results).toEqual([42, 42, 'Hello'])
      expectTypeOf(results).toEqualTypeOf<readonly [number, number, string]>()

      expect(myCustomCallA).toHaveBeenCalledTimes(2)
      expect(myCustomCallA).toHaveBeenCalledWith(42)
      expect(myCustomCallB).toHaveBeenCalledTimes(1)
      expect(myCustomCallB).toHaveBeenCalledWith('Hello')
    })

    test('does not allow to pass invalid properties', async () => {
      const xprisma = prisma.$extends({})

      await expect(
        xprisma.user.findFirst({
          // @ts-expect-error
          invalid: true,
        }),
      ).rejects.toThrow()
    })

    test('input type should be able to be passed to method accepting same input types', () => {
      const xprisma = prisma.$extends({})

      const args: PrismaNamespace.UserUpsertArgs = {
        where: {
          id: '1',
        },
        create: {
          email: 'test',
          firstName: 'test',
          lastName: 'test',
        },
        update: {},
      }

      void prisma.user.upsert(args)
      void xprisma.user.upsert(args)
    })

    test('an extension can also reference a previous one via parent on a specific model', async () => {
      const xprisma = prisma
        .$extends({
          model: {
            user: {
              async findFirst(a: 'SomeString') {
                return Promise.resolve(a)
              },
            },
          },
        })
        .$extends({
          model: {
            user: {
              async findFirst() {
                const ctx = Prisma.getExtensionContext(this)

                const data = await ctx.$parent.user.findFirst('SomeString')

                expect(data).toEqual('SomeString')
                expectTypeOf(data).toEqualTypeOf<'SomeString'>()
              },
            },
          },
        })

      await xprisma.user.findFirst()

      expect.assertions(1)
    })

    test('an extension can also reference a previous one via parent on $allModels', async () => {
      const xprisma = prisma
        .$extends({
          model: {
            user: {
              async findFirst(a: 'SomeString') {
                return Promise.resolve(a)
              },
            },
          },
        })
        .$extends({
          model: {
            $allModels: {
              async findFirst() {
                const ctx = Prisma.getExtensionContext(this)

                const data = await ctx.$parent!['user'].findFirst('SomeString')

                expect(data).toEqual('SomeString')
                expectTypeOf(data).toEqualTypeOf<any>()
              },
            },
          },
        })

      await xprisma.user.findFirst()

      expect.assertions(1)
    })
  },
  {
    skipDefaultClientInstance: true,
  },
)
