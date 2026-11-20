import { PrismaPg } from '@prisma/adapter-pg'
import { expectTypeOf } from 'expect-type'

import { NewPrismaClient } from '../_utils/types'
// @ts-ignore
import testMatrix from './_matrix'
import type * as imports from './generated/prisma/client'

declare let prisma: imports.PrismaClient
declare const newPrismaClient: NewPrismaClient<imports.PrismaClient, typeof imports.PrismaClient>
declare let loaded: {
  Plan: typeof imports.Plan
}

testMatrix.setupTestSuite(
  ({ driverAdapter, clientRuntime }, _suiteMeta, _clientMeta, _cliMeta, info) => {
    test('can create data with an enum array', async () => {
      const { Plan } = loaded

      await prisma.user.create({
        data: {
          plans: [Plan.FREE],
        },
      })
    })

    test('can retrieve data with an enum array', async () => {
      const { Plan } = loaded

      const user = await prisma.user.create({
        data: {
          plans: [Plan.FREE],
        },
      })

      const data = await prisma.user.findFirstOrThrow({
        where: {
          id: user.id,
        },
      })

      expectTypeOf(data.plans).toEqualTypeOf<imports.Plan[]>()
      expect(data.plans).toEqual([Plan.FREE])
    })

    testIf(driverAdapter === 'js_pg' && clientRuntime === 'client')(
      'can retrieve data with an enum array with a raw query and a custom parser',
      async () => {
        const { Plan } = loaded

        const prisma = newPrismaClient({
          // @ts-test-if: provider !== Providers.MONGODB
          adapter: new PrismaPg(
            {
              connectionString: info.databaseUrl,
            },
            {
              userDefinedTypeParser: async (oid, value, queryable) => {
                const result = await queryable.queryRaw({
                  sql: `
                SELECT t.typtype::text AS type, e.typtype::text AS element_type
                FROM pg_type t
                JOIN pg_type e ON t.typelem = e.oid
                WHERE t.oid = $1`,
                  args: [oid],
                  argTypes: [{ arity: 'scalar', scalarType: 'int' }],
                })
                const [[baseType, elementType]] = result.rows
                if (baseType === 'b' && elementType === 'e') {
                  return (value as string).replace(/^\{/, '').replace(/\}$/, '').split(',')
                } else {
                  return value
                }
              },
            },
          ),
        })

        // @ts-test-if: provider !== Providers.MONGODB
        const users = await prisma.user.createManyAndReturn({
          data: [
            {
              plans: [Plan.FREE, Plan.CUSTOM],
            },
            {
              plans: [Plan.CUSTOM],
            },
          ],
        })

        // @ts-test-if: provider !== Providers.MONGODB
        const data = await prisma.$queryRaw<imports.User[]>`
        SELECT * FROM "User" WHERE "plans" @> Array['CUSTOM']::"Plan"[]
      `

        expect(data).toMatchObject([
          {
            id: users[0].id,
            plans: [Plan.FREE, Plan.CUSTOM],
          },
          {
            id: users[1].id,
            plans: [Plan.CUSTOM],
          },
        ])
      },
    )
  },
  {
    optOut: {
      from: ['sqlserver', 'mysql', 'sqlite'],
      reason: 'enum arrays are not supported',
    },
  },
)
