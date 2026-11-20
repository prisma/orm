import { faker } from '@faker-js/faker'
import { copycat } from '@snaplet/copycat'
import { expectTypeOf } from 'expect-type'

import { AdapterProviders } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

const email = faker.internet.email()

testMatrix.setupTestSuite(
  (_suiteConfig, _suiteMeta) => {
    beforeEach(async () => {
      await prisma.post.deleteMany()
      await prisma.user.deleteMany()
      const { id: userId } = await prisma.user.create({
        data: {
          email,
          firstName: 'John',
          lastName: 'Smith',
        },
      })

      await prisma.post.create({
        data: {
          user: { connect: { id: userId } },
        },
      })
    })

    test('extended client in tx can rollback via normal call', async () => {
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
      })

      const result = xprisma.$transaction([
        xprisma.user.create({
          data: {
            id: copycat.uuid(1).replaceAll('-', '').slice(-24),
            email: 'jane@smith.com',
            firstName: 'Jane',
            lastName: 'Smith',
          },
        }),
        xprisma.user.create({
          data: {
            id: copycat.uuid(2).replaceAll('-', '').slice(-24),
            email: 'jane@smith.com',
            firstName: 'Jane',
            lastName: 'Smith',
          },
        }),
      ])

      await expect(result).rejects.toMatchPrismaErrorSnapshot()

      const users = await prisma.user.findMany({ where: { email: 'jane@smith.com' } })

      expect(users).toHaveLength(0)
    })

    test('extended client in tx works via normal call', async () => {
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
      })

      await xprisma.$transaction([
        xprisma.user.create({
          data: {
            email: 'jane@smith.com',
            firstName: 'Jane',
            lastName: 'Smith',
          },
        }),
      ])

      const users = await prisma.user.findMany({ where: { email: 'jane@smith.com' } })

      expect(users).toHaveLength(1)
    })

    test('extended client in tx can rollback via custom call', async () => {
      const xprisma = prisma
        .$extends({
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
        })
        .$extends({
          model: {
            $allModels: {
              createAlt(args: any) {
                return (this as any).create(args)
              },
            },
          },
        })

      const result = xprisma.$transaction([
        xprisma.user.createAlt({
          data: {
            id: copycat.uuid(1).replaceAll('-', '').slice(-24),
            email: 'jane@smith.com',
            firstName: 'Jane',
            lastName: 'Smith',
          },
        }),
        xprisma.user.createAlt({
          data: {
            id: copycat.uuid(2).replaceAll('-', '').slice(-24),
            email: 'jane@smith.com',
            firstName: 'Jane',
            lastName: 'Smith',
          },
        }),
      ])

      await expect(result).rejects.toMatchPrismaErrorSnapshot()

      const users = await prisma.user.findMany({ where: { email: 'jane@smith.com' } })

      expect(users).toHaveLength(0)
    })

    test('extended client in tx works via custom call', async () => {
      const xprisma = prisma
        .$extends({
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
        })
        .$extends({
          model: {
            $allModels: {
              createAlt(args: any) {
                return (this as any).create(args)
              },
            },
          },
        })

      await xprisma.$transaction([
        xprisma.user.create({
          data: {
            email: 'jane@smith.com',
            firstName: 'Jane',
            lastName: 'Smith',
          },
        }),
      ])

      const users = await prisma.user.findMany({ where: { email: 'jane@smith.com' } })

      expect(users).toHaveLength(1)
    })

    test('isolation level is properly reflected in extended client', () => {
      ;async () => {
        const xprisma = prisma.$extends({})

        // @ts-test-if: provider !== Providers.MONGODB
        const data = await xprisma.$transaction([xprisma.user.findFirst({ select: { id: true } })], {
          isolationLevel: 'Serializable',
        })

        expectTypeOf(data).toEqualTypeOf<[{ id: string } | null]>()
      }
    })

    test('type inference allows for destructuring the array', () => {
      ;async () => {
        const xprisma = prisma.$extends({})

        const [data, count] = await xprisma.$transaction([
          xprisma.user.findFirst({ select: { id: true } }),
          xprisma.user.count(),
        ])

        expectTypeOf(data).toEqualTypeOf<{ id: string } | null>()
        expectTypeOf(count).toEqualTypeOf<number>()
      }
    })
  },
  {
    skipDriverAdapter: {
      from: [AdapterProviders.JS_D1, AdapterProviders.JS_LIBSQL],
      reason:
        'js_d1: batch transaction needs to be implemented. Unskip once https://github.com/prisma/team-orm/issues/997 is done; ' +
        'js_libsql: SIGABRT due to panic in libsql (not yet implemented: array)', // TODO: ORM-867
    },
  },
)
