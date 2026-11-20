/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { assertNever } from '@prisma/internals'
import { randomBytes } from 'crypto'
import { expectTypeOf } from 'expect-type'

import { AdapterProviders, Providers } from '../_utils/providers'
import { wait } from '../_utils/tests/wait'
import { waitFor } from '../_utils/tests/waitFor'
import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { Post, Prisma as PrismaNamespace, PrismaClient, User } from './generated/prisma/client'

// @only-ts-generator
type LogPrismaClient = PrismaClient<'query'>
// @only-js-generator
type LogPrismaClient = PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }>

declare let prisma: LogPrismaClient
declare let Prisma: typeof PrismaNamespace

declare const newPrismaClient: NewPrismaClient<LogPrismaClient, typeof PrismaClient>

const randomId1 = randomBytes(12).toString('hex')
const randomId2 = randomBytes(12).toString('hex')
const randomId3 = randomBytes(12).toString('hex')

jest.retryTimes(3)

testMatrix.setupTestSuite(
  ({ provider, driverAdapter, clientEngineExecutor }, _suiteMeta, _clientMeta) => {
    const isSqlServer = provider === Providers.SQLSERVER
    const usesJsDrivers = driverAdapter !== undefined || clientEngineExecutor === 'remote'

    beforeEach(async () => {
      prisma = newPrismaClient({
        log: [{ emit: 'event', level: 'query' }],
      })

      if ((await prisma.user.findFirst()) === null) {
        await prisma.user.create({
          data: {
            email: 'jane@doe.io',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        })
      }
    })

    afterEach(async () => {
      await prisma.$disconnect()
    })

    test('extending a specific model query', async () => {
      const fnUser = jest.fn()
      const fnPost = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          user: {
            findFirst({ args, query, operation, model }) {
              if (args.select != undefined) {
                args.select.email = undefined
              }
              args.include = undefined
              args.select = undefined
              expectTypeOf(args).not.toBeAny()
              expectTypeOf(query).toBeFunction()
              expectTypeOf(operation).toEqualTypeOf<'findFirst'>()
              expectTypeOf(model).toEqualTypeOf<'User'>()
              fnUser({ args, operation, model })
              return query(args)
            },
          },
          post: {
            async findFirst({ args, query, operation, model }) {
              expectTypeOf(args).not.toBeAny()
              expectTypeOf(query).toBeFunction()
              expectTypeOf(operation).toEqualTypeOf<'findFirst'>()
              expectTypeOf(model).toEqualTypeOf<'Post'>()

              fnPost({ args, operation, model })

              const data = await query(args)

              expectTypeOf(data).not.toBeAny()
              expectTypeOf(data).toBeNullable()
              expectTypeOf(data!).toHaveProperty('id')

              return data
            },
          },
        },
      })

      const args = { where: { id: randomId1 } }
      const cbArgs = { args, operation: 'findFirst', model: 'User' }

      const data = await xprisma.user.findFirst(args)

      expect(data).toMatchInlineSnapshot(`null`)
      expect(fnUser).toHaveBeenCalledWith(cbArgs)
      expect(fnUser).toHaveBeenCalledTimes(1)
      expect(fnPost).not.toHaveBeenCalled()
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('top to bottom execution order', async () => {
      let i = 0
      const fnUser1 = jest.fn()
      const fnUser2 = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                fnUser1(++i)
                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                fnUser2(++i)
                return query(args)
              },
            },
          },
        })

      const args = { where: { id: randomId1 } }

      const data = await xprisma.user.findFirst(args)

      expect(data).toMatchInlineSnapshot(`null`)
      expect(fnUser1).toHaveBeenCalledWith(1)
      expect(fnUser1).toHaveBeenCalledTimes(1)
      expect(fnUser2).toHaveBeenCalledWith(2)
      expect(fnUser2).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('args mutation isolation', async () => {
      const fnEmitter = jest.fn()
      const fnUser = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                args.where = { id: randomId2 }

                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                args.where = { id: randomId3 }

                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                fnUser(args)

                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {},
        })
        .$extends({
          query: {
            user: {},
          },
        })

      const args = { where: { id: randomId1 } }

      const data = await xprisma.user.findFirst(args)

      expect(data).toMatchInlineSnapshot(`null`)
      expect(args).toEqual({ where: { id: randomId1 } })
      expect(fnUser).toHaveBeenCalledWith({ where: { id: randomId3 } })
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('args mutation accumulation', async () => {
      const fnUser = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                args.where = { id: randomId1, ...args.where }

                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                args.where = { email: 'john@doe.io', ...args.where }

                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                fnUser(args)

                return query(args)
              },
            },
          },
        })

      const data = await xprisma.user.findFirst({ skip: 1 })

      expect(data).toMatchInlineSnapshot(`null`)
      expect(fnUser).toHaveBeenCalledWith({ where: { id: randomId1, email: 'john@doe.io' }, skip: 1 })
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('query result override with a simple call', async () => {
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          user: {
            // @ts-expect-error
            findFirst() {
              return 1 // override
            },
          },
        },
      })

      const data = await xprisma.user.findFirst({ skip: 1 })

      expect(data).toBe(1)
      await wait(() => expect(fnEmitter).not.toHaveBeenCalled())
    })

    test('query result override with extra extension after', async () => {
      const fnEmitter = jest.fn()
      const fnUser = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            user: {
              // @ts-expect-error
              findFirst() {
                return 1 // override
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                fnUser(args)

                return query(args)
              },
            },
          },
        })

      const data = await xprisma.user.findFirst({ skip: 1 })

      expect(data).toBe(1)
      expect(fnUser).not.toHaveBeenCalled()
      await wait(() => expect(fnEmitter).not.toHaveBeenCalled())
    })

    test('query result override with extra extension before', async () => {
      const fnEmitter = jest.fn()
      const fnUser = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            user: {
              findFirst({ args, query }) {
                fnUser(args)

                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              // @ts-expect-error
              findFirst() {
                return 1 // override
              },
            },
          },
        })

      const data = await xprisma.user.findFirst({ skip: 1 })

      expect(data).toBe(1)
      expect(fnUser).toHaveBeenCalledWith({ skip: 1 })
      await wait(() => expect(fnEmitter).not.toHaveBeenCalled())
    })

    test('query result mutation with a simple call', async () => {
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          user: {
            async findFirst({ args, query }) {
              const data = await query(args)

              expectTypeOf(data).toBeNullable()
              data!.id = '<redacted>'

              return data
            },
          },
        },
      })

      const data = await xprisma.user.findFirst()

      expect(data).toMatchInlineSnapshot(`
        {
          "email": "jane@doe.io",
          "firstName": "Jane",
          "id": "<redacted>",
          "lastName": "Doe",
        }
      `)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('query result mutation with multiple calls', async () => {
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            user: {
              async findFirst({ args, query }) {
                const data = await query(args)

                expectTypeOf(data).toBeNullable()
                data!.id = '<redacted>'

                return data
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              async findFirst({ args, query }) {
                const data = await query(args)

                expectTypeOf(data).toBeNullable()
                data!.email = '<redacted>'

                return data
              },
            },
          },
        })

      const data = await xprisma.user.findFirst()

      expect(data).toMatchInlineSnapshot(`
        {
          "email": "<redacted>",
          "firstName": "Jane",
          "id": "<redacted>",
          "lastName": "Doe",
        }
      `)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    testIf(provider !== Providers.MONGODB && process.platform !== 'win32')(
      'query result mutations with batch transactions',
      async () => {
        const fnEmitter = jest.fn()

        prisma.$on('query', fnEmitter)

        const xprisma = prisma
          .$extends({
            query: {
              user: {
                async findFirst({ args, query }) {
                  const data = await query(args)

                  expectTypeOf(data).toBeNullable()
                  data!.id = '<redacted>'

                  return data
                },
              },
            },
          })
          .$extends({
            query: {
              user: {
                async findFirst({ args, query }) {
                  const data = await query(args)

                  expectTypeOf(data).toBeNullable()
                  data!.email = '<redacted>'

                  return data
                },
              },
            },
          })

        const data = await xprisma.$transaction([xprisma.user.findFirst(), xprisma.post.findFirst()])

        expect(data).toMatchInlineSnapshot(`
          [
            {
              "email": "<redacted>",
              "firstName": "Jane",
              "id": "<redacted>",
              "lastName": "Doe",
            },
            null,
          ]
        `)
        await waitFor(() => {
          const expectation = [
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('COMMIT') }],
          ]
          if (!usesJsDrivers) {
            // Driver adapters do not issue BEGIN through the query engine.
            expectation.unshift([{ query: expect.stringContaining('BEGIN') }])
          }
          if (isSqlServer && !usesJsDrivers) {
            expectation.unshift([{ query: expect.stringContaining('SET TRANSACTION') }])
          }
          expect(fnEmitter).toHaveBeenCalledTimes(expectation.length)
          expect(fnEmitter.mock.calls).toMatchObject(expectation)
        })
      },
    )

    testIf(provider !== Providers.MONGODB && process.platform !== 'win32')(
      'transforming a simple query into a batch transaction',
      async () => {
        const fnEmitter = jest.fn()

        prisma.$on('query', fnEmitter)

        const xprisma = prisma.$extends({
          query: {
            user: {
              async findFirst({ args, query }) {
                // @ts-test-if: provider !== Providers.MONGODB
                return (await prisma.$transaction([prisma.$queryRaw`SELECT 1`, query(args)]))[1]
              },
            },
          },
        })

        const data = await xprisma.user.findFirst({
          select: {
            lastName: true,
          },
        })

        expect(data).toMatchInlineSnapshot(`
          {
            "lastName": "Doe",
          }
        `)
        await waitFor(() => {
          const expectation = [
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('COMMIT') }],
          ]
          if (!usesJsDrivers) {
            // Driver adapters do not issue BEGIN through the query engine.
            expectation.unshift([{ query: expect.stringContaining('BEGIN') }])
          }
          if (isSqlServer && !usesJsDrivers) {
            expectation.unshift([{ query: expect.stringContaining('SET TRANSACTION') }])
          }
          expect(fnEmitter).toHaveBeenCalledTimes(expectation.length)
          expect(fnEmitter.mock.calls).toMatchObject(expectation)
        })
      },
    )

    // TODO: skipped for PlanetScale adapter because of https://github.com/prisma/team-orm/issues/495
    // TODO: skipped for D1 - unskip once https://github.com/prisma/team-orm/issues/997 is done
    testIf(
      provider !== Providers.MONGODB &&
        process.platform !== 'win32' &&
        driverAdapter !== AdapterProviders.JS_PLANETSCALE &&
        driverAdapter !== AdapterProviders.JS_D1,
    )('hijacking a batch transaction into another one with a simple call', async () => {
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          user: {
            async findFirst({ args, query }) {
              // @ts-test-if: provider !== Providers.MONGODB
              return (await prisma.$transaction([prisma.$queryRaw`SELECT 1`, query(args)]))[1]
            },
          },
        },
      })

      const data = await xprisma.$transaction([
        xprisma.user.findFirst({
          select: {
            lastName: true,
          },
        }),
        xprisma.post.findFirst(),
      ])

      expect(data).toMatchInlineSnapshot(`
        [
          {
            "lastName": "Doe",
          },
          null,
        ]
      `)
      await waitFor(() => {
        const calls = [...fnEmitter.mock.calls]

        // get rid of dandling post.findFirst query
        if (calls[calls.length - 1][0]['query'].includes('SELECT')) {
          calls.pop()
        } else {
          calls.shift()
        }

        const expectation = [
          [{ query: expect.stringContaining('SELECT') }],
          [{ query: expect.stringContaining('SELECT') }],
          [{ query: expect.stringContaining('COMMIT') }],
        ]
        if (!usesJsDrivers) {
          // Driver adapters do not issue BEGIN through the query engine.
          expectation.unshift([{ query: expect.stringContaining('BEGIN') }])
        }
        if (isSqlServer && !usesJsDrivers) {
          expectation.unshift([{ query: expect.stringContaining('SET TRANSACTION') }])
        }

        expect(calls).toMatchObject(expectation)
      })
    })

    // TODO: skipped for PlanetScale adapter because of https://github.com/prisma/team-orm/issues/495
    // TODO: skipped for D1 - unskip once https://github.com/prisma/team-orm/issues/997 is done
    testIf(
      provider !== Providers.MONGODB &&
        process.platform !== 'win32' &&
        driverAdapter !== AdapterProviders.JS_PLANETSCALE &&
        driverAdapter !== AdapterProviders.JS_D1,
    )('hijacking a batch transaction into another one with multiple calls', async () => {
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            user: {
              async findFirst({ args, query }) {
                const data = await query(args)

                expectTypeOf(data).toBeNullable()
                data!.firstName = '<redacted>'

                return data
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              async findFirst({ args, query }) {
                // @ts-test-if: provider !== Providers.MONGODB
                return (await prisma.$transaction([prisma.$queryRaw`SELECT 1`, query(args)]))[1]
              },
            },
          },
        })
        .$extends({
          query: {
            user: {
              async findFirst({ args, query }) {
                const data = await query(args)

                expectTypeOf(data).toBeNullable()
                data!.lastName = '<redacted>'

                return data
              },
            },
          },
        })

      const data = await xprisma.$transaction([
        xprisma.user.findFirst({
          select: {
            firstName: true,
            lastName: true,
          },
        }),
        xprisma.post.findFirst(),
      ])

      expect(data).toMatchInlineSnapshot(`
        [
          {
            "firstName": "<redacted>",
            "lastName": "<redacted>",
          },
          null,
        ]
      `)

      await waitFor(() => {
        const calls = [...fnEmitter.mock.calls]

        // get rid of dandling post.findFirst query
        if (calls[calls.length - 1][0]['query'].includes('SELECT')) {
          calls.pop()
        } else {
          calls.shift()
        }

        if (provider !== Providers.MONGODB) {
          const expectation = [
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('SELECT') }],
            [{ query: expect.stringContaining('COMMIT') }],
          ]

          if (!usesJsDrivers) {
            // Driver adapters do not issue BEGIN through the query engine.
            expectation.unshift([{ query: expect.stringContaining('BEGIN') }])
          }
          if (isSqlServer && !usesJsDrivers) {
            expectation.unshift([{ query: expect.stringContaining('SET TRANSACTION') }])
          }

          expect(calls).toMatchObject(expectation)
        }
      })
    })

    test('extending with $allModels and a specific query', async () => {
      const fnModel = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          $allModels: {
            async findFirst({ args, query, operation, model }) {
              expectTypeOf(args).not.toBeAny()
              expectTypeOf(query).toBeFunction()
              expectTypeOf(operation).toEqualTypeOf<'findFirst'>()
              type Model = typeof model
              expectTypeOf<Model>().toEqualTypeOf<'Post' | 'User'>()

              fnModel({ args, operation, model })

              const data = await query(args)

              expectTypeOf(data).not.toBeAny()

              return data
            },
          },
        },
      })

      const args = { where: { id: randomId1 } }
      const cbArgsUser = { args, operation: 'findFirst', model: 'User' }
      const cbArgsPost = { args, operation: 'findFirst', model: 'Post' }

      const dataUser = await xprisma.user.findFirst(args)
      const dataPost = await xprisma.post.findFirst(args)

      expect(dataUser).toMatchInlineSnapshot(`null`)
      expect(dataPost).toMatchInlineSnapshot(`null`)
      expect(fnModel).toHaveBeenCalledTimes(2)
      expect(fnModel).toHaveBeenNthCalledWith(1, cbArgsUser)
      expect(fnModel).toHaveBeenNthCalledWith(2, cbArgsPost)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(2))
    })

    test('extending with $allModels and $allOperations', async () => {
      const fnModel = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          $allModels: {
            async $allOperations({ args, query, operation, model }) {
              expectTypeOf(args).not.toBeAny()
              expectTypeOf(query).toBeFunction()

              expectTypeOf(operation).toMatchTypeOf<
                | 'findFirst'
                | 'findFirstOrThrow'
                | 'findUnique'
                | 'findUniqueOrThrow'
                | 'findMany'
                | 'create'
                | 'createMany'
                | 'createManyAndReturn' // PostgreSQL, CockroachDB & SQLite only
                | 'update'
                | 'updateMany'
                | 'updateManyAndReturn' // PostgreSQL, CockroachDB & SQLite only
                | 'upsert'
                | 'delete'
                | 'deleteMany'
                | 'aggregate'
                | 'groupBy'
                | 'count'
                | 'aggregateRaw' // MongoDB only
                | 'findRaw' // MongoDB only
              >()

              type Model = typeof model
              expectTypeOf<Model>().toEqualTypeOf<'Post' | 'User'>()

              fnModel({ args, operation, model })

              const data = await query(args)

              expectTypeOf(data).not.toBeAny()

              return data
            },
          },
        },
      })

      const args = { where: { id: randomId1 } }
      const cbArgsUser = { args, operation: 'findFirst', model: 'User' }
      const cbArgsPost = { args, operation: 'findFirst', model: 'Post' }
      const cbArgsPosts = { args, operation: 'findMany', model: 'Post' }

      const dataUser = await xprisma.user.findFirst(args)
      const dataPost = await xprisma.post.findFirst(args)
      const dataPosts = await xprisma.post.findMany(args)

      expect(dataUser).toMatchInlineSnapshot(`null`)
      expect(dataPost).toMatchInlineSnapshot(`null`)
      expect(dataPosts).toMatchInlineSnapshot(`[]`)
      expect(fnModel).toHaveBeenCalledTimes(3)
      expect(fnModel).toHaveBeenNthCalledWith(1, cbArgsUser)
      expect(fnModel).toHaveBeenNthCalledWith(2, cbArgsPost)
      expect(fnModel).toHaveBeenNthCalledWith(3, cbArgsPosts)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(3))
    })

    test('extending with specific model and $allOperations', async () => {
      const fnModel = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          post: {
            async $allOperations({ args, query, operation, model }) {
              expectTypeOf(args).not.toBeAny()
              expectTypeOf(query).toBeFunction()

              expectTypeOf(operation).toMatchTypeOf<
                | 'findFirst'
                | 'findFirstOrThrow'
                | 'findUnique'
                | 'findUniqueOrThrow'
                | 'findMany'
                | 'create'
                | 'createMany'
                | 'createManyAndReturn' // PostgreSQL, CockroachDB & SQLite only
                | 'update'
                | 'updateMany'
                | 'updateManyAndReturn' // PostgreSQL, CockroachDB & SQLite only
                | 'upsert'
                | 'delete'
                | 'deleteMany'
                | 'aggregate'
                | 'groupBy'
                | 'count'
                | 'aggregateRaw' // MongoDB only
                | 'findRaw' // MongoDB only
              >()

              expectTypeOf(model).toEqualTypeOf<'Post'>()

              fnModel({ args, operation, model })

              const data = await query(args)

              expectTypeOf(data).not.toBeAny()

              return data
            },
          },
        },
      })

      const args = { where: { id: randomId1 } }
      const cbArgsPost = { args, operation: 'findFirst', model: 'Post' }
      const cbArgsPosts = { args, operation: 'findMany', model: 'Post' }

      const dataPost = await xprisma.post.findFirst(args)
      const dataPosts = await xprisma.post.findMany(args)

      expect(dataPost).toMatchInlineSnapshot(`null`)
      expect(dataPosts).toMatchInlineSnapshot(`[]`)
      expect(fnModel).toHaveBeenCalledTimes(2)
      expect(fnModel).toHaveBeenNthCalledWith(1, cbArgsPost)
      expect(fnModel).toHaveBeenNthCalledWith(2, cbArgsPosts)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(2))
    })

    test('errors in callback', async () => {
      const xprisma = prisma.$extends({
        name: 'Faulty query ext',
        query: {
          user: {
            findFirst() {
              return Promise.reject('All is lost!')
            },
          },
        },
      })

      await expect(xprisma.user.findFirst({})).rejects.toMatchInlineSnapshot(`"All is lost!"`)
    })

    test('errors in with no extension name', async () => {
      const xprisma = prisma.$extends({
        query: {
          user: {
            findFirst() {
              return Promise.reject('All is lost!')
            },
          },
        },
      })

      await expect(xprisma.user.findFirst({})).rejects.toMatchInlineSnapshot(`"All is lost!"`)
    })

    test('empty args becomes an empty object', async () => {
      const fnUser1 = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          user: {
            findFirst({ args, query }) {
              fnUser1(args)
              return query(args)
            },
          },
        },
      })

      const args = undefined

      const data = await xprisma.user.findFirst(args)

      expect(data).not.toBe(null)
      expect(fnUser1).toHaveBeenCalledWith({})
      expect(fnUser1).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('passing incorrect argument errors', () => {
      prisma.$extends({
        query: {
          user: {
            async findFirst({ args, query }) {
              const user = await query(args)

              expectTypeOf(user).toBeNullable()
              expectTypeOf(user!).toHaveProperty('id').toEqualTypeOf<string | undefined>()

              // @ts-expect-error
              return query(user)
            },
          },
        },
      })
    })

    test('result extensions are applied after query extension', async () => {
      const xprisma = prisma.$extends({
        result: {
          user: {
            fullName: {
              needs: { firstName: true, lastName: true },
              compute(user) {
                return `${user.firstName} ${user.lastName}`
              },
            },
          },
        },
        query: {
          user: {
            findFirstOrThrow() {
              return Promise.resolve({ email: 'ext@example.com', firstName: 'From', lastName: 'Query' })
            },
          },
        },
      })

      const result = await xprisma.user.findFirstOrThrow()
      expect(result.fullName).toBe('From Query')
    })

    testIf(provider !== Providers.SQLITE)('top-level raw queries interception', async () => {
      const fnEmitter = jest.fn()
      const fnUser = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          // @ts-test-if: provider !== Providers.MONGODB
          $queryRaw({ args, query, operation }) {
            expect(operation).toEqual('$queryRaw')
            expect(args).toEqual(Prisma.sql`SELECT 2`)
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(args).toEqualTypeOf<PrismaNamespace.Sql>()
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(operation).toEqualTypeOf<'$queryRaw'>()
            fnUser(args)
            return query(args)
          },
          // @ts-test-if: provider !== Providers.MONGODB
          $executeRaw({ args, query, operation }) {
            expect(operation).toEqual('$executeRaw')
            expect(args).toEqual(Prisma.sql`SELECT 1`)
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(args).toEqualTypeOf<PrismaNamespace.Sql>()
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(operation).toEqualTypeOf<'$executeRaw'>()
            fnUser(args)
            return query(args)
          },
          // @ts-test-if: provider !== Providers.MONGODB
          $queryRawUnsafe({ args, query, operation }) {
            expect(operation).toEqual('$queryRawUnsafe')
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(args).toEqualTypeOf<[query: string, ...values: any[]]>()
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(operation).toEqualTypeOf<'$queryRawUnsafe'>()
            fnUser(args)
            return query(args)
          },
          // @ts-test-if: provider !== Providers.MONGODB
          $executeRawUnsafe({ args, query, operation }) {
            expect(operation).toEqual('$executeRawUnsafe')
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(args).toEqualTypeOf<[query: string, ...values: any[]]>()
            // @ts-test-if: provider !== Providers.MONGODB
            expectTypeOf(operation).toEqualTypeOf<'$executeRawUnsafe'>()
            fnUser(args)
            return query(args)
          },
          // @ts-test-if: provider === Providers.MONGODB
          $runCommandRaw({ args, query, operation }) {
            expect(operation).toEqual('$runCommandRaw')
            // @ts-test-if: provider === Providers.MONGODB
            expectTypeOf(args).toEqualTypeOf<PrismaNamespace.InputJsonObject>()
            // @ts-test-if: provider === Providers.MONGODB
            expectTypeOf(operation).toEqualTypeOf<'$runCommandRaw'>()
            fnUser(args)
            return query(args)
          },
        },
      })

      if (provider !== Providers.MONGODB) {
        // @ts-test-if: provider !== Providers.MONGODB
        await xprisma.$executeRaw`SELECT 1`
        // @ts-test-if: provider !== Providers.MONGODB
        await xprisma.$queryRaw`SELECT 2`
        // @ts-test-if: provider !== Providers.MONGODB
        await xprisma.$executeRawUnsafe(`SELECT 3`)
        // @ts-test-if: provider !== Providers.MONGODB
        await xprisma.$queryRawUnsafe(`SELECT 4`)

        await wait(() => expect(fnEmitter).toHaveBeenCalledTimes(4))
        expect(fnUser).toHaveBeenNthCalledWith(1, Prisma.sql`SELECT 1`)
        expect(fnUser).toHaveBeenNthCalledWith(2, Prisma.sql`SELECT 2`)
        expect(fnUser).toHaveBeenNthCalledWith(3, [`SELECT 3`])
        expect(fnUser).toHaveBeenNthCalledWith(4, [`SELECT 4`])
      } else {
        // @ts-test-if: provider === Providers.MONGODB
        await xprisma.$runCommandRaw({ aggregate: 'User', pipeline: [], explain: false })
        // await wait(() => expect(fnEmitter).toHaveBeenCalledTimes(1)) // not working
        expect(fnUser).toHaveBeenNthCalledWith(1, { aggregate: 'User', pipeline: [], explain: false })
      }
    })

    testIf(provider !== Providers.MONGODB)(
      'extending with $allModels.$allOperations and a top-level query',
      async () => {
        const fnOperation = jest.fn()
        const fnEmitter = jest.fn()

        prisma.$on('query', fnEmitter)

        const xprisma = prisma.$extends({
          query: {
            // @ts-test-if: provider !== Providers.MONGODB
            $queryRawUnsafe({ args, query, operation, model }: any) {
              fnOperation({ args, operation, model })

              return query(args)
            },
            $allModels: {
              $allOperations({ args, query, operation, model }) {
                fnOperation({ args, operation, model })

                return query(args)
              },
            },
          },
        })

        const rawQueryArgs = `SELECT 1`
        const modelQueryArgs = { where: { id: randomId1 } }

        const cbArgsRaw = { args: [rawQueryArgs], operation: '$queryRawUnsafe', model: undefined }
        const cbArgsUser = { args: modelQueryArgs, operation: 'findFirst', model: 'User' }
        const cbArgsPost = { args: modelQueryArgs, operation: 'findFirst', model: 'Post' }

        // @ts-test-if: provider !== Providers.MONGODB
        const dataRaw = await xprisma.$queryRawUnsafe(rawQueryArgs)
        const dataUser = await xprisma.user.findFirst(modelQueryArgs)
        const dataPost = await xprisma.post.findFirst(modelQueryArgs)

        expect(dataRaw).toBeTruthy()
        expect(dataUser).toMatchInlineSnapshot(`null`)
        expect(dataPost).toMatchInlineSnapshot(`null`)
        expect(fnOperation).toHaveBeenCalledTimes(3)
        expect(fnOperation).toHaveBeenNthCalledWith(1, cbArgsRaw)
        expect(fnOperation).toHaveBeenNthCalledWith(2, cbArgsUser)
        expect(fnOperation).toHaveBeenNthCalledWith(3, cbArgsPost)
        await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(3))
      },
    )

    test('extending with $allModels and another $allModels', async () => {
      const fnModel = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma
        .$extends({
          query: {
            $allModels: {
              findFirst({ args, query, model, operation }) {
                fnModel({ args, operation, model })

                return query(args)
              },
            },
          },
        })
        .$extends({
          query: {
            $allModels: {
              findFirst({ args, query, operation, model }) {
                fnModel({ args, operation, model })

                return query(args)
              },
            },
          },
        })

      const args = { where: { id: randomId1 } }
      const cbArgsUser = { args: args, operation: 'findFirst', model: 'User' }

      const dataUser = await xprisma.user.findFirst(args)

      expect(dataUser).toMatchInlineSnapshot(`null`)
      expect(fnModel).toHaveBeenCalledTimes(2)
      expect(fnModel).toHaveBeenNthCalledWith(1, cbArgsUser)
      expect(fnModel).toHaveBeenNthCalledWith(2, cbArgsUser)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('extending with top-level $allOperations', async () => {
      const fnModel = jest.fn()
      const fnEmitter = jest.fn()

      prisma.$on('query', fnEmitter)

      const xprisma = prisma.$extends({
        query: {
          $allOperations({ args, query, operation, model }) {
            fnModel({ args, operation, model })

            return query(args)
          },
        },
      })

      const args = { where: { id: randomId1 } }
      const cbArgsUser = { args: args, operation: 'findFirst', model: 'User' }

      const dataUser1 = await xprisma.user.findFirst(args)

      expect(dataUser1).toMatchInlineSnapshot(`null`)
      expect(fnModel).toHaveBeenCalledTimes(1)
      expect(fnModel).toHaveBeenNthCalledWith(1, cbArgsUser)
      await waitFor(() => expect(fnEmitter).toHaveBeenCalledTimes(1))
    })

    test('unions can be properly discriminated', () => {
      prisma.$extends({
        query: {
          $allModels: {
            findFirst({ args, query, model }) {
              ;() => {
                if (model === 'User') {
                  args.select?.firstName
                  return query(args)
                }

                if (model === 'Post') {
                  // @ts-expect-error
                  args.select?.firstName
                  return query(args)
                }

                return undefined
              }

              return query(args)
            },
            $allOperations({ args, query, operation }) {
              ;() => {
                if (operation === 'findFirst') {
                  args.select?.id
                  return query(args)
                }

                if (operation === 'groupBy') {
                  // @ts-expect-error
                  args.select?.id
                  return query(args)
                }

                return undefined
              }

              return query(args)
            },
          },
        },
      })
    })

    test('arg types and return types are correct', () => {
      type OptionalDeep<T> = {
        [P in keyof T]?: OptionalDeep<T[P]>
      }
      ;() =>
        prisma.$extends({
          query: {
            user: {
              async aggregate({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'aggregate'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserAggregateArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.AggregateUser>>()

                return data
              },
              async count({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'count'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCountArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.UserCountAggregateOutputType> | number>()

                return data
              },
              async create({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'create'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async createMany({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'createMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                return data
              },
              // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
              async createManyAndReturn({ args, query, operation }) {
                const data = await query(args)

                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(operation).toEqualTypeOf<'createManyAndReturn'>()
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyAndReturnArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async delete({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'delete'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async deleteMany({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'deleteMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                return data
              },
              async findMany({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[] | undefined>()
                expectTypeOf(data?.[0]?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async findFirst({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findFirst'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async findUnique({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findUnique'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async findFirstOrThrow({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findFirstOrThrow'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstOrThrowArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()

                return data
              },
              async findUniqueOrThrow({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findUniqueOrThrow'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueOrThrowArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()

                return data
              },
              async groupBy({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'groupBy'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserGroupByArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.UserGroupByOutputType>[]>()

                return data
              },
              async update({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'update'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async updateMany({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'updateMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                return data
              },
              async updateManyAndReturn({ args, query, operation }) {
                const data = await query(args)

                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(operation).toEqualTypeOf<'updateManyAndReturn'>()
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyAndReturnArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async upsert({ args, query, operation }) {
                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'upsert'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpsertArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async $allOperations({ args, query, operation }) {
                // same as the user query extensions above but with if statements
                if (operation === 'aggregate') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'aggregate'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserAggregateArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.AggregateUser>>()

                  return data
                }
                if (operation === 'count') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'count'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCountArgs>()
                  expectTypeOf(data).toMatchTypeOf<
                    OptionalDeep<PrismaNamespace.UserCountAggregateOutputType> | number
                  >()

                  return data
                }
                if (operation === 'create') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'create'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'createMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'createMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                  return data
                }
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                if (operation === 'createManyAndReturn') {
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  const data = await query(args)

                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(operation).toEqualTypeOf<'createManyAndReturn'>()
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyAndReturnArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                  expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'delete') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'delete'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'deleteMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'deleteMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                  return data
                }
                if (operation === 'findMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[] | undefined>()
                  expectTypeOf(data?.[0]?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'findFirst') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findFirst'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                  expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'findUnique') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findUnique'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                  expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'findFirstOrThrow') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findFirstOrThrow'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstOrThrowArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'findUniqueOrThrow') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findUniqueOrThrow'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueOrThrowArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'groupBy') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'groupBy'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserGroupByArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.UserGroupByOutputType>[]>()

                  return data
                }
                if (operation === 'update') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'update'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'updateMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'updateMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                  return data
                }
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                if (operation === 'updateManyAndReturn') {
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  const data = await query(args)

                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(operation).toEqualTypeOf<'updateManyAndReturn'>()
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyAndReturnArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                  expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (operation === 'upsert') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'upsert'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpsertArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }

                // @ts-test-if: provider !== Providers.MONGODB
                assertNever(operation, 'Unknown operation')
              },
            },
            $allModels: {
              async $allOperations({ operation, args, query, model }) {
                // same as above but also check the model is User in the if condition
                if (model === 'User' && operation === 'aggregate') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'aggregate'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserAggregateArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.AggregateUser>>()

                  return data
                }
                if (model === 'User' && operation === 'count') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'count'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCountArgs>()
                  expectTypeOf(data).toMatchTypeOf<
                    OptionalDeep<PrismaNamespace.UserCountAggregateOutputType> | number
                  >()

                  return data
                }
                if (model === 'User' && operation === 'create') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'create'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'createMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'createMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                  return data
                }
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                if (model === 'User' && operation === 'createManyAndReturn') {
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  const data = await query(args)

                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(operation).toEqualTypeOf<'createManyAndReturn'>()
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyAndReturnArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                  expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'delete') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'delete'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'deleteMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'deleteMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                  return data
                }
                if (model === 'User' && operation === 'findMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[] | undefined>()
                  expectTypeOf(data?.[0]?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'findFirst') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findFirst'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                  expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'findUnique') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findUnique'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                  expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'findFirstOrThrow') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findFirstOrThrow'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstOrThrowArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'findUniqueOrThrow') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'findUniqueOrThrow'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueOrThrowArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'groupBy') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'groupBy'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserGroupByArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.UserGroupByOutputType>[]>()

                  return data
                }
                if (model === 'User' && operation === 'update') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'update'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'updateMany') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'updateMany'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                  return data
                }
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                if (model === 'User' && operation === 'updateManyAndReturn') {
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  const data = await query(args)

                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(operation).toEqualTypeOf<'updateManyAndReturn'>()
                  // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyAndReturnArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                  expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }
                if (model === 'User' && operation === 'upsert') {
                  const data = await query(args)

                  expectTypeOf(operation).toEqualTypeOf<'upsert'>()
                  expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpsertArgs>()
                  expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                  expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                  return data
                }

                return query(args)
              },

              async aggregate({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'aggregate'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserAggregateArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.AggregateUser>>()

                return data
              },
              async count({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'count'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCountArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.UserCountAggregateOutputType> | number>()

                return data
              },
              async create({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'create'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async createMany({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'createMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                return data
              },
              // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
              async createManyAndReturn({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(operation).toEqualTypeOf<'createManyAndReturn'>()
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserCreateManyAndReturnArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async delete({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'delete'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async deleteMany({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'deleteMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserDeleteManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                return data
              },
              async findMany({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[] | undefined>()
                expectTypeOf(data?.[0]?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async findFirst({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findFirst'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                expectTypeOf(data).toBeNullable()
                expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async findUnique({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findUnique'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User> | null>()
                expectTypeOf(data).toBeNullable()
                expectTypeOf(data?.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async findFirstOrThrow({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findFirstOrThrow'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindFirstOrThrowArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data).not.toBeNullable()

                return data
              },
              async findUniqueOrThrow({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'findUniqueOrThrow'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserFindUniqueOrThrowArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data).not.toBeNullable()

                return data
              },
              async groupBy({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'groupBy'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserGroupByArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.UserGroupByOutputType>[]>()

                return data
              },
              async update({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'update'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async updateMany({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'updateMany'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<PrismaNamespace.BatchPayload>>()

                return data
              },
              async updateManyAndReturn({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(operation).toEqualTypeOf<'updateManyAndReturn'>()
                // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpdateManyAndReturnArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>[]>()
                expectTypeOf(data[0].posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },
              async upsert({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                expectTypeOf(operation).toEqualTypeOf<'upsert'>()
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserUpsertArgs>()
                expectTypeOf(data).toMatchTypeOf<OptionalDeep<User>>()
                expectTypeOf(data.posts).toMatchTypeOf<OptionalDeep<Post>[] | undefined>()

                return data
              },

              // This MYSQL & SQLSERVER does not make sense...
              // This was added to avoid a "Unused '@ts-expect-error' directive." error.
              // @ts-test-if: provider === Providers.MONGODB || provider === Providers.MYSQL || provider === Providers.SQLSERVER
              async aggregateRaw({ args, query, operation, model }) {
                if (model !== 'User') return query(args)

                const data = await query(args)

                // @ts-test-if: provider === Providers.MONGODB
                expectTypeOf(operation).toEqualTypeOf<'aggregateRaw'>()
                // @ts-test-if: provider === Providers.MONGODB
                expectTypeOf(args).toEqualTypeOf<PrismaNamespace.UserAggregateRawArgs>()
                // @ts-test-if: provider === Providers.MONGODB
                expectTypeOf(data).toEqualTypeOf<PrismaNamespace.JsonObject>()

                return data
              },
            },

            // @ts-test-if: provider !== Providers.MONGODB
            async $executeRaw({ args, query, operation, model }) {
              const data = await query(args)

              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(model).toEqualTypeOf<undefined>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(operation).toEqualTypeOf<'$executeRaw'>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(args).toEqualTypeOf<PrismaNamespace.Sql>()
              expectTypeOf(data).toEqualTypeOf<any>()

              return query(args)
            },
            // @ts-test-if: provider !== Providers.MONGODB
            async $queryRaw({ args, query, operation, model }) {
              const data = await query(args)

              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(model).toEqualTypeOf<undefined>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(operation).toEqualTypeOf<'$queryRaw'>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(args).toEqualTypeOf<PrismaNamespace.Sql>()
              expectTypeOf(data).toEqualTypeOf<any>()

              return query(args)
            },

            // @ts-test-if: provider !== Providers.MONGODB
            async $executeRawUnsafe({ args, query, operation, model }) {
              const data = await query(args)

              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(model).toEqualTypeOf<undefined>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(operation).toEqualTypeOf<'$executeRawUnsafe'>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(args).toEqualTypeOf<[string, ...any[]]>()
              expectTypeOf(data).toEqualTypeOf<any>()

              return query(args)
            },
            // @ts-test-if: provider !== Providers.MONGODB
            async $queryRawUnsafe({ args, query, operation, model }) {
              const data = await query(args)

              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(model).toEqualTypeOf<undefined>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(operation).toEqualTypeOf<'$queryRawUnsafe'>()
              // @ts-test-if: provider !== Providers.MONGODB
              expectTypeOf(args).toEqualTypeOf<[string, ...any[]]>()
              expectTypeOf(data).toEqualTypeOf<any>()

              return query(args)
            },
            // @ts-test-if: provider === Providers.MONGODB
            async $runCommandRaw({ args, query, operation, model }) {
              const data = await query(args)

              // @ts-test-if: provider === Providers.MONGODB
              expectTypeOf(model).toEqualTypeOf<undefined>()
              // @ts-test-if: provider === Providers.MONGODB
              expectTypeOf(operation).toEqualTypeOf<'$runCommandRaw'>()
              // @ts-test-if: provider === Providers.MONGODB
              expectTypeOf(args).toEqualTypeOf<PrismaNamespace.InputJsonObject>()
              // @ts-test-if: provider === Providers.MONGODB
              expectTypeOf(data).toEqualTypeOf<PrismaNamespace.JsonObject>()

              return query(args)
            },
            async $allOperations({ args, query, operation, model }) {
              const data = await query(args)

              expectTypeOf(model).toEqualTypeOf<undefined | string>()
              expectTypeOf(operation).toEqualTypeOf<string>()
              expectTypeOf(args).toEqualTypeOf<any>()
              expectTypeOf(data).toEqualTypeOf<any>()

              return query(args)
            },
          },
        })
    })
  },
  {
    skipDefaultClientInstance: true,
  },
)
