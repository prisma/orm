import { faker } from '@faker-js/faker'
import { expectTypeOf } from 'expect-type'

import { AdapterProviders } from '../../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

const existingEmail = faker.internet.email()
const nonExistingEmail = faker.internet.email()

testMatrix.setupTestSuite(
  (_suiteConfig, _suiteMeta) => {
    beforeAll(async () => {
      await prisma.user.create({ data: { email: existingEmail, posts: { create: { title: 'How to exist?' } } } })
    })

    test('finds existing record', async () => {
      const record = await prisma.user.findUniqueOrThrow({ where: { email: existingEmail } })
      expect(record).toMatchObject({ id: expect.any(String), email: existingEmail })
      expectTypeOf(record).not.toBeNullable()
    })

    test('throws if record was not found', async () => {
      const record = prisma.user.findUniqueOrThrow({ where: { email: nonExistingEmail } })
      await expect(record).rejects.toMatchObject({
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
      })
    })

    // batch transaction needs to be implemented. Unskip once https://github.com/prisma/team-orm/issues/997 is done
    skipTestIf(_suiteConfig.driverAdapter === 'js_d1')('works with transactions', async () => {
      const newEmail = faker.internet.email()
      const result = prisma.$transaction([
        prisma.user.create({ data: { email: newEmail } }),
        prisma.user.findUniqueOrThrow({ where: { email: nonExistingEmail } }),
      ])

      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findUniqueOrThrow()\` invocation in
        /client/tests/functional/methods/findUniqueOrThrow/tests.ts:0:0

          XX const newEmail = faker.internet.email()
          XX const result = prisma.$transaction([
          XX   prisma.user.create({ data: { email: newEmail } }),
        → XX   prisma.user.findUniqueOrThrow(
        An operation failed because it depends on one or more records that were required but not found. No record was found for a query."
      `)

      const record = await prisma.user.findUnique({ where: { email: newEmail } })
      expect(record).toBeNull()
    })

    skipTestIf(_suiteConfig.driverAdapter === 'js_d1')('works with interactive transactions', async () => {
      const newEmail = faker.internet.email()
      const result = prisma.$transaction(async (prisma) => {
        await prisma.user.create({ data: { email: newEmail } })
        await prisma.user.findUniqueOrThrow({ where: { email: nonExistingEmail } })
      })

      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findUniqueOrThrow()\` invocation in
        /client/tests/functional/methods/findUniqueOrThrow/tests.ts:0:0

          XX const newEmail = faker.internet.email()
          XX const result = prisma.$transaction(async (prisma) => {
          XX   await prisma.user.create({ data: { email: newEmail } })
        → XX   await prisma.user.findUniqueOrThrow(
        An operation failed because it depends on one or more records that were required but not found. No record was found for a query."
      `)

      const record = await prisma.user.findUnique({ where: { email: newEmail } })
      expect(record).toBeNull()
    })

    test('reports correct method name in case of validation error', async () => {
      const record = prisma.user.findUniqueOrThrow({
        where: {
          // @ts-expect-error triggering validation error on purpose
          notAUserField: true,
        },
      })
      await expect(record).rejects.toMatchObject({
        message: expect.stringContaining('Invalid `prisma.user.findUniqueOrThrow()` invocation'),
      })
    })
  },
  {
    skipDriverAdapter: {
      from: [AdapterProviders.JS_LIBSQL],
      reason: 'js_libsql: SIGABRT due to panic in libsql (not yet implemented: array)', // TODO: ORM-867
    },
  },
)
