/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { expectTypeOf } from 'expect-type'

import { Prisma as PrismaDefault } from '../../../extension'
import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare let Prisma: typeof PrismaNamespace

expectTypeOf<PrismaDefault.PrismaPromise<unknown>>().toEqualTypeOf<PrismaNamespace.PrismaPromise<unknown>>()

function clientExtensionCallback() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      client: {
        $myMethod() {},
      },
    })
  })
}

function clientExtensionObject() {
  return Prisma.defineExtension({
    client: {
      $myMethod() {},
    },
  })
}

function modelExtensionCallback() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      model: {
        user: {
          myUserMethod() {},
        },
      },
    })
  })
}

function modelExtensionObject() {
  return Prisma.defineExtension({
    model: {
      user: {
        myUserMethod() {},
      },
    },
  })
}

function resultExtensionCallback() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      result: {
        user: {
          computedField: {
            needs: { id: true },
            compute: () => {},
          },
        },
      },
    })
  })
}

function resultExtensionObject() {
  return Prisma.defineExtension({
    result: {
      user: {
        computedField: {
          needs: { id: true },
          compute: () => {},
        },
      },
    },
  })
}

function clientExtensionCallbackViaDefault() {
  return PrismaDefault.defineExtension((client) => {
    return client.$extends({
      client: {
        $myMethodViaDefault() {},
      },
    })
  })
}

function clientExtensionObjectViaDefault() {
  return PrismaDefault.defineExtension({
    client: {
      $myMethodViaDefault() {},
    },
  })
}

function modelExtensionCallbackViaDefault() {
  return PrismaDefault.defineExtension((client) => {
    return client.$extends({
      model: {
        user: {
          myUserMethodViaDefault() {},
        },
      },
    })
  })
}

function modelExtensionObjectViaDefault() {
  return PrismaDefault.defineExtension({
    model: {
      user: {
        myUserMethodViaDefault() {},
      },
    },
  })
}

function modelGenericExtensionCallbackViaDefault() {
  return PrismaDefault.defineExtension((client) => {
    return client.$extends({
      model: {
        $allModels: {
          myGenericMethodViaDefault<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findFirst'>>) {
            // eslint-disable-next-line
            const ctx = Prisma.getExtensionContext(this) // just for testing that it is exported

            return {} as {
              // just for testing the types
              args: A
              payload: PrismaDefault.Payload<T, 'findFirst'>
              result: PrismaDefault.Result<T, A, 'findFirst'>
            }
          },
        },
      },
    })
  })
}

function modelGenericExtensionObjectViaDefault() {
  return PrismaDefault.defineExtension({
    model: {
      $allModels: {
        myGenericMethodViaDefault<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findFirst'>>) {
          // eslint-disable-next-line
          const ctx = Prisma.getExtensionContext(this) // just for testing that it is exported

          return {} as {
            // just for testing the types
            args: A
            payload: PrismaDefault.Payload<T, 'findFirst'>
            result: PrismaDefault.Result<T, A, 'findFirst'>
          }
        },
      },
    },
  })
}

function clientGenericExtensionObjectViaDefault() {
  return PrismaDefault.defineExtension({
    client: {
      myGenericMethodViaDefault<T, A extends any[]>(
        this: T,
        ..._args: PrismaDefault.Exact<A, [...PrismaDefault.Args<T, '$executeRaw'>]>
      ) {
        // eslint-disable-next-line
        const ctx = Prisma.getExtensionContext(this) // just for testing that it is exported

        return {} as {
          // just for testing the types
          args: A
          payload: PrismaDefault.Payload<T, '$executeRaw'>
          result: PrismaDefault.Result<T, A, '$executeRaw'>
        }
      },
    },
  })
}

// this is just actually used for testing that the type work correctly
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function queryGenericExtensionObjectViaDefault() {
  return PrismaDefault.defineExtension({
    query: {
      // eslint-disable-next-line @typescript-eslint/require-await
      async $queryRaw({ args, operation, query, model }) {
        expectTypeOf(args).toMatchTypeOf<object>()
        expectTypeOf(args['select']).toMatchTypeOf<object | undefined>()
        expectTypeOf(operation).toEqualTypeOf<string>()
        expectTypeOf(query).toMatchTypeOf<Function>()
        expectTypeOf(model).toEqualTypeOf<string | undefined>()
      },
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/require-await
        async findFirst({ args, operation, query, model }) {
          expectTypeOf(args).toMatchTypeOf<unknown>()
          expectTypeOf(operation).toEqualTypeOf<string>()
          expectTypeOf(query).toMatchTypeOf<Function>()
          expectTypeOf(model).toEqualTypeOf<string>()
        },
      },
    },
  })
}

// this is just actually used for testing that the type work correctly
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function itxWithinGenericExtension() {
  return PrismaDefault.defineExtension((client) => {
    const xclient = client.$extends({
      client: {
        helperMethod() {},
      },
    })

    void xclient.$transaction((tx) => {
      expectTypeOf(tx).toHaveProperty('helperMethod')
      expectTypeOf(tx).not.toHaveProperty('$extends')
      return Promise.resolve()
    })

    return xclient
  })
}

function resultExtensionCallbackViaDefault() {
  return PrismaDefault.defineExtension((client) => {
    return client.$extends({
      result: {
        user: {
          computedFieldViaDefault: {
            needs: { id: true },
            compute: () => {},
          },
        },
      },
    })
  })
}

function resultExtensionObjectViaDefault() {
  return PrismaDefault.defineExtension({
    result: {
      user: {
        computedFieldViaDefault: {
          needs: { id: true },
          compute: () => {},
        },
      },
    },
  })
}

// extension that mirrors the types of all existing methods
function allResultsGenericExtensionObjectViaDefault() {
  return PrismaDefault.defineExtension({
    client: {
      _$executeRaw<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, '$executeRaw'>>) {
        return {} as PrismaDefault.Result<T, A, '$executeRaw'>
      },
      _$executeRawUnsafe<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, '$executeRawUnsafe'>>) {
        return {} as PrismaDefault.Result<T, A, '$executeRawUnsafe'>
      },
      _$queryRaw<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, '$queryRaw'>>) {
        return {} as PrismaDefault.Result<T, A, '$queryRaw'>
      },
      _$queryRawUnsafe<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, '$queryRawUnsafe'>>) {
        return {} as PrismaDefault.Result<T, A, '$queryRawUnsafe'>
      },
      _$runCommandRaw<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, '$runCommandRaw'>>) {
        return {} as PrismaDefault.Result<T, A, '$runCommandRaw'>
      },
    },
    model: {
      $allModels: {
        _aggregate<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'aggregate'>>) {
          return {} as PrismaDefault.Result<T, A, 'aggregate'>
        },
        _aggregateRaw<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'aggregateRaw'>>) {
          return {} as PrismaDefault.Result<T, A, 'aggregateRaw'>
        },
        _count<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'count'>>) {
          return {} as PrismaDefault.Result<T, A, 'count'>
        },
        _create<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'create'>>) {
          return {} as PrismaDefault.Result<T, A, 'create'>
        },
        _createMany<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'createMany'>>) {
          return {} as PrismaDefault.Result<T, A, 'createMany'>
        },
        _createManyAndReturn<T, A>(
          this: T,
          _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'createManyAndReturn'>>,
        ) {
          return {} as PrismaDefault.Result<T, A, 'createManyAndReturn'>
        },
        _delete<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'delete'>>) {
          return {} as PrismaDefault.Result<T, A, 'delete'>
        },
        _deleteMany<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'deleteMany'>>) {
          return {} as PrismaDefault.Result<T, A, 'deleteMany'>
        },
        _findFirst<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findFirst'>>) {
          return {} as PrismaDefault.Result<T, A, 'findFirst'>
        },
        _findFirstOrThrow<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findFirstOrThrow'>>) {
          return {} as PrismaDefault.Result<T, A, 'findFirstOrThrow'>
        },
        _findMany<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findMany'>>) {
          return {} as PrismaDefault.Result<T, A, 'findMany'>
        },
        _findRaw<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findRaw'>>) {
          return {} as PrismaDefault.Result<T, A, 'findRaw'>
        },
        _findUnique<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findUnique'>>) {
          return {} as PrismaDefault.Result<T, A, 'findUnique'>
        },
        _findUniqueOrThrow<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'findUniqueOrThrow'>>) {
          return {} as PrismaDefault.Result<T, A, 'findUniqueOrThrow'>
        },
        _groupBy<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'groupBy'>>) {
          return {} as PrismaDefault.Result<T, A, 'groupBy'>
        },
        _update<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'update'>>) {
          return {} as PrismaDefault.Result<T, A, 'update'>
        },
        _updateMany<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'updateMany'>>) {
          return {} as PrismaDefault.Result<T, A, 'updateMany'>
        },
        _updateManyAndReturn<T, A>(
          this: T,
          _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'updateManyAndReturn'>>,
        ) {
          return {} as PrismaDefault.Result<T, A, 'updateManyAndReturn'>
        },
        _upsert<T, A>(this: T, _args: PrismaDefault.Exact<A, PrismaDefault.Args<T, 'upsert'>>) {
          return {} as PrismaDefault.Result<T, A, 'upsert'>
        },
      },
    },
  })
}

// TODO: fix this, it got somehow broken for both Prisma generators after we got rid of Library Engine.
// ```
// Message:
// Type 'unknown' does not satisfy the constraint '"Expected: unknown, Actual: never"'.
// At: tests/functional/extensions/.generated/extensions.defineExtension (provider=postgresql, qpe=remote)/defineExtension.ts:686:60
// ```
//
testMatrix.setupTestSuite(() => {
  test('client - callback', () => {
    const xprisma = prisma.$extends(clientExtensionCallback())
    const xprismaViaDefault = prisma.$extends(clientExtensionCallbackViaDefault())
    expectTypeOf(xprisma).toHaveProperty('$myMethod')
    expectTypeOf(xprismaViaDefault).toHaveProperty('$myMethodViaDefault')
  })

  test('client - object', () => {
    const xprisma = prisma.$extends(clientExtensionObject())
    const xprismaViaDefault = prisma.$extends(clientExtensionObjectViaDefault())
    expectTypeOf(xprisma).toHaveProperty('$myMethod')
    expectTypeOf(xprismaViaDefault).toHaveProperty('$myMethodViaDefault')
  })

  test('model - callback', () => {
    const xprisma = prisma.$extends(modelExtensionCallback())
    const xprismaViaDefault = prisma.$extends(modelExtensionCallbackViaDefault())
    expectTypeOf(xprisma.user).toHaveProperty('myUserMethod')
    expectTypeOf(xprismaViaDefault.user).toHaveProperty('myUserMethodViaDefault')
  })

  test('model - object', () => {
    const xprisma = prisma.$extends(modelExtensionObject())
    const xprismaViaDefault = prisma.$extends(modelExtensionObjectViaDefault())
    expectTypeOf(xprisma.user).toHaveProperty('myUserMethod')
    expectTypeOf(xprismaViaDefault.user).toHaveProperty('myUserMethodViaDefault')
  })

  test('result - callback', async () => {
    const xprisma = prisma.$extends(resultExtensionCallback())
    const xprismaViaDefault = prisma.$extends(resultExtensionCallbackViaDefault())
    const user = await xprisma.user.findFirst({})
    const userViaDefault = await xprismaViaDefault.user.findFirst({})
    expectTypeOf(user!).toHaveProperty('computedField')
    expectTypeOf(userViaDefault!).toHaveProperty('computedFieldViaDefault')
  })

  test('result - object', async () => {
    const xprisma = prisma.$extends(resultExtensionObject())
    const xprismaViaDefault = prisma.$extends(resultExtensionObjectViaDefault())
    const user = await xprisma.user.findFirst({})
    const userViaDefault = await xprismaViaDefault.user.findFirst({})
    expectTypeOf(user!).toHaveProperty('computedField')
    expectTypeOf(userViaDefault!).toHaveProperty('computedFieldViaDefault')
  })

  test('chained', async () => {
    const xprisma = prisma
      .$extends(modelExtensionObject())
      .$extends(clientExtensionCallback())
      .$extends(resultExtensionCallback())
      .$extends(modelExtensionObjectViaDefault())
      .$extends(clientExtensionCallbackViaDefault())
      .$extends(resultExtensionCallbackViaDefault())

    expectTypeOf(xprisma).toHaveProperty('$myMethod')
    expectTypeOf(xprisma).toHaveProperty('$myMethodViaDefault')
    expectTypeOf(xprisma.user).toHaveProperty('myUserMethod')
    expectTypeOf(xprisma.user).toHaveProperty('myUserMethodViaDefault')
    const user = await xprisma.user.findFirst({})
    expectTypeOf(user!).toHaveProperty('computedField')
    expectTypeOf(user!).toHaveProperty('computedFieldViaDefault')
  })

  test('invalid', () => {
    Prisma.defineExtension({
      // @ts-expect-error
      notAComponent: {},
    })

    Prisma.defineExtension({
      model: {
        // @ts-expect-error
        notAModel: {
          myMethod() {},
        },
      },
    })

    Prisma.defineExtension({
      result: {
        // -@ts-expect-error TODO: this should be an error but somehow isn't showing up like eg. `model`
        notAModel: {
          field: {
            needs: { id: true },
            compute: () => {},
          },
        },
      },
    })

    Prisma.defineExtension({
      result: {
        user: {
          field: {
            needs: {
              // @ts-expect-error
              notUserField: true,
            },
            compute: () => {},
          },
        },
      },
    })

    Prisma.defineExtension({
      result: {
        user: {
          field: {
            needs: {
              id: true,
            },
            compute: (user) => {
              // @ts-expect-error
              return user.bad
            },
          },
        },
      },
    })

    Prisma.defineExtension({
      query: {
        // @ts-expect-error
        notAModel: {
          findFirst() {},
        },
      },
    })

    Prisma.defineExtension({
      query: {
        user: {
          // @ts-expect-error
          notAnOperation() {},
        },
      },
    })
  })

  // here we want to check that type utils also work via default
  test('generic model - callback via default', () => {
    const xprisma = prisma.$extends(modelGenericExtensionCallbackViaDefault())
    expectTypeOf(xprisma.user).toHaveProperty('myGenericMethodViaDefault')

    const data1 = xprisma.user.myGenericMethodViaDefault({
      select: {
        email: true,
      },
    })

    const data2 = xprisma.user.myGenericMethodViaDefault({
      select: {
        email: true as boolean,
      },
    })

    expectTypeOf<(typeof data1)['args']>().toEqualTypeOf<{ select: { email: true } }>()
    expectTypeOf<(typeof data1)['payload']>().toMatchTypeOf<object>()
    expectTypeOf<(typeof data1)['payload']['scalars']>().toHaveProperty('email').toEqualTypeOf<string>()
    expectTypeOf<(typeof data1)['result'] & {}>().toHaveProperty('email').toEqualTypeOf<string>()

    expectTypeOf<(typeof data2)['args']>().toEqualTypeOf<{ select: { email: boolean } }>()
    expectTypeOf<(typeof data2)['payload']>().toMatchTypeOf<object>()
    expectTypeOf<(typeof data2)['payload']['scalars']>().toHaveProperty('email').toEqualTypeOf<string>()
    expectTypeOf<(typeof data2)['result'] & {}>().toHaveProperty('email').toEqualTypeOf<string>()
  })

  // here we want to check that type utils also work via default
  test('generic model - object via default', () => {
    const xprisma = prisma.$extends(modelGenericExtensionObjectViaDefault())
    expectTypeOf(xprisma.user).toHaveProperty('myGenericMethodViaDefault')

    const data1 = xprisma.user.myGenericMethodViaDefault({
      select: {
        email: true,
      },
    })

    const data2 = xprisma.user.myGenericMethodViaDefault({
      select: {
        email: true as boolean,
      },
    })

    expectTypeOf<(typeof data1)['args']>().toEqualTypeOf<{ select: { email: true } }>()
    expectTypeOf<(typeof data1)['payload']>().toMatchTypeOf<object>()
    expectTypeOf<(typeof data1)['payload']['scalars']>().toHaveProperty('email').toEqualTypeOf<string>()
    expectTypeOf<(typeof data1)['result'] & {}>().toHaveProperty('email').toEqualTypeOf<string>()

    expectTypeOf<(typeof data2)['args']>().toEqualTypeOf<{ select: { email: boolean } }>()
    expectTypeOf<(typeof data2)['payload']>().toMatchTypeOf<object>()
    expectTypeOf<(typeof data2)['payload']['scalars']>().toHaveProperty('email').toEqualTypeOf<string>()
    expectTypeOf<(typeof data2)['result'] & {}>().toHaveProperty('email').toEqualTypeOf<string>()
  })

  // here we want to check that type utils also work via default
  test('generic client - object via default', () => {
    const xprisma = prisma.$extends(clientGenericExtensionObjectViaDefault())
    expectTypeOf(xprisma).toHaveProperty('myGenericMethodViaDefault')

    const data = xprisma.myGenericMethodViaDefault`SELECT * FROM User WHERE id = ${1}`

    expectTypeOf<(typeof data)['args']>().toEqualTypeOf<[TemplateStringsArray, number]>()
    expectTypeOf<(typeof data)['payload']>().toEqualTypeOf<any>()
    expectTypeOf<(typeof data)['result']>().toEqualTypeOf<number>()
  })

  // here we want to check that type utils are equivalent to real results
  test('generic client - generic type utilities', () => {
    ;async () => {
      const xprisma = prisma.$extends(allResultsGenericExtensionObjectViaDefault())

      const _aggregate = xprisma.user._aggregate({ _min: { id: true } })
      const aggregate = await xprisma.user.aggregate({ _min: { id: true } })
      expectTypeOf<typeof _aggregate>().toEqualTypeOf<typeof aggregate>()

      const _count = xprisma.user._count({})
      const count = await xprisma.user.count({})
      expectTypeOf<typeof _count>().toEqualTypeOf<typeof count>()

      const _create = xprisma.user._create({ data: { email: '', firstName: '', lastName: '' } })
      const create = await xprisma.user.create({ data: { email: '', firstName: '', lastName: '' } })
      expectTypeOf<typeof _create>().toEqualTypeOf<typeof create>()

      const _createMany = xprisma.user._createMany({ data: [{ email: '', firstName: '', lastName: '' }] })
      const createMany = await xprisma.user.createMany({ data: [{ email: '', firstName: '', lastName: '' }] })
      expectTypeOf<typeof _createMany>().toEqualTypeOf<typeof createMany>()

      const _createManyAndReturn = xprisma.user._createManyAndReturn({
        data: [{ email: '', firstName: '', lastName: '' }],
      })
      const createManyAndReturn = await xprisma.user._createManyAndReturn({
        data: [{ email: '', firstName: '', lastName: '' }],
      })
      expectTypeOf<typeof _createManyAndReturn>().toEqualTypeOf<typeof createManyAndReturn>()

      const _delete = xprisma.user._delete({ where: { id: '1' } })
      const deleted = await xprisma.user.delete({ where: { id: '1' } })
      expectTypeOf<typeof _delete>().toEqualTypeOf<typeof deleted>()

      const _deleteMany = xprisma.user._deleteMany({ where: { id: '1' } })
      const deleteMany = await xprisma.user.deleteMany({ where: { id: '1' } })
      expectTypeOf<typeof _deleteMany>().toEqualTypeOf<typeof deleteMany>()

      const _findFirst = xprisma.user._findFirst({})
      const findFirst = await xprisma.user.findFirst({})
      expectTypeOf<typeof _findFirst>().toEqualTypeOf<typeof findFirst>()

      const _findFirstOrThrow = xprisma.user._findFirstOrThrow({})
      const findFirstOrThrow = await xprisma.user.findFirstOrThrow({})
      expectTypeOf<typeof _findFirstOrThrow>().toEqualTypeOf<typeof findFirstOrThrow>()

      const _findMany = xprisma.user._findMany({ include: { posts: true } })
      const findMany = await xprisma.user.findMany({ include: { posts: true } })
      expectTypeOf<typeof _findMany>().toEqualTypeOf<typeof findMany>()

      const _findUnique = xprisma.user._findUnique({ where: { id: '1' } })
      const findUnique = await xprisma.user.findUnique({ where: { id: '1' } })
      expectTypeOf<typeof _findUnique>().toEqualTypeOf<typeof findUnique>()

      const _findUniqueOrThrow = xprisma.user._findUniqueOrThrow({ where: { id: '1' } })
      const findUniqueOrThrow = await xprisma.user.findUniqueOrThrow({ where: { id: '1' } })
      expectTypeOf<typeof _findUniqueOrThrow>().toEqualTypeOf<typeof findUniqueOrThrow>()

      const _groupBy = xprisma.user._groupBy({ by: ['id'] })
      const groupBy = await xprisma.user.groupBy({ by: ['id'] })
      expectTypeOf<typeof _groupBy>().toEqualTypeOf<typeof groupBy>()

      const _update = xprisma.user._update({ where: { id: '1' }, data: { email: '' } })
      const update = await prisma.user.update({ where: { id: '1' }, data: { email: '' } })
      expectTypeOf<typeof _update>().toEqualTypeOf<typeof update>()

      const _updateMany = xprisma.user._updateMany({ where: { id: '1' }, data: { email: '' } })
      const updateMany = await prisma.user.updateMany({ where: { id: '1' }, data: { email: '' } })
      expectTypeOf<typeof _updateMany>().toEqualTypeOf<typeof updateMany>()

      const _updateManyAndReturn = xprisma.user._updateManyAndReturn({ where: { id: '1' }, data: { email: '' } })
      // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
      const updateManyAndReturn = await prisma.user.updateManyAndReturn({ where: { id: '1' }, data: { email: '' } })
      // @ts-test-if: provider == Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.SQLITE
      expectTypeOf<typeof _updateManyAndReturn>().toEqualTypeOf<typeof updateManyAndReturn>()

      const _upsert = xprisma.user._upsert({
        where: { id: '1' },
        create: { email: '', firstName: '', lastName: '' },
        update: { email: '' },
      })
      const upsert = await prisma.user.upsert({
        where: { id: '1' },
        create: { email: '', firstName: '', lastName: '' },
        update: { email: '' },
      })
      expectTypeOf<typeof _upsert>().toEqualTypeOf<typeof upsert>()

      const _findRaw = xprisma.user._findRaw({})
      // @ts-test-if: provider === Providers.MONGODB
      const findRaw = await prisma.user.findRaw({})
      // @ts-test-if: provider === Providers.MONGODB
      expectTypeOf<typeof _findRaw>().toEqualTypeOf<typeof findRaw>()

      const _aggregateRaw = xprisma.user._aggregateRaw({})
      // @ts-test-if: provider === Providers.MONGODB
      const aggregateRaw = await prisma.user.aggregateRaw({})
      // @ts-test-if: provider === Providers.MONGODB
      expectTypeOf<typeof _aggregateRaw>().toEqualTypeOf<typeof aggregateRaw>()

      const _runCommandRaw = xprisma._$runCommandRaw({})
      // @ts-test-if: provider === Providers.MONGODB
      const runCommandRaw = await prisma.$runCommandRaw({})
      // @ts-test-if: provider === Providers.MONGODB
      expectTypeOf<typeof _runCommandRaw>().toEqualTypeOf<typeof runCommandRaw>()

      const _executeRaw = xprisma._$executeRaw([])
      // @ts-test-if: provider !== Providers.MONGODB
      const executeRaw = await prisma.$executeRaw([] as any as TemplateStringsArray)
      // @ts-test-if: provider !== Providers.MONGODB
      expectTypeOf<typeof _executeRaw>().toEqualTypeOf<typeof executeRaw>()

      const _executeRawUnsafe = xprisma._$executeRawUnsafe('')
      // @ts-test-if: provider !== Providers.MONGODB
      const executeRawUnsafe = await prisma.$executeRawUnsafe('')
      // @ts-test-if: provider !== Providers.MONGODB
      expectTypeOf<typeof _executeRawUnsafe>().toEqualTypeOf<typeof executeRawUnsafe>()

      const _queryRaw = xprisma._$queryRaw([])
      // @ts-test-if: provider !== Providers.MONGODB
      const queryRaw = await prisma.$queryRaw([] as any as TemplateStringsArray)
      // @ts-test-if: provider !== Providers.MONGODB
      expectTypeOf<typeof _queryRaw>().toEqualTypeOf<typeof queryRaw>()

      const _queryRawUnsafe = xprisma._$queryRawUnsafe('')
      // @ts-test-if: provider !== Providers.MONGODB
      const queryRawUnsafe = await prisma.$queryRawUnsafe('')
      // @ts-test-if: provider !== Providers.MONGODB
      expectTypeOf<typeof _queryRawUnsafe>().toEqualTypeOf<typeof queryRawUnsafe>()
    }
  })
})
