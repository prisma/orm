import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare let Prisma: typeof PrismaNamespace

testMatrix.setupTestSuite(
  (_config, _suiteMeta, _clientMeta) => {
    describe('nullableJsonField', () => {
      test('JsonNull', async () => {
        const data = await prisma.nullableJsonField.create({
          data: {
            json: Prisma.JsonNull,
          },
        })
        expect(data.json).toBe(null)
      })

      test('DbNull', async () => {
        const data = await prisma.nullableJsonField.create({
          data: {
            json: Prisma.DbNull,
          },
        })
        expect(data.json).toBe(null)
      })
    })

    describe('requiredJsonField', () => {
      test('JsonNull', async () => {
        const data = await prisma.requiredJsonField.create({
          data: {
            json: Prisma.JsonNull,
          },
        })
        expect(data.json).toBe(null)
      })

      test('DbNull', async () => {
        await expect(
          prisma.requiredJsonField.create({
            data: {
              // @ts-expect-error
              json: Prisma.DbNull,
            },
          }),
        ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.requiredJsonField.create()\` invocation in
          /client/tests/functional/json-null-types/tests.ts:0:0

            XX 
            XX test('DbNull', async () => {
            XX   await expect(
          → XX     prisma.requiredJsonField.create({
                     data: {
                       json: Prisma.DbNull
                             ~~~~~~~~~~~~~
                     }
                   })

          Invalid value for argument \`json\`. Expected JsonNullValueInput."
        `)
      })
    })

    describe('properties of DbNull/JsonNull/AnyNull', () => {
      test('instanceof checks pass', () => {
        expect(Prisma.DbNull).toBeInstanceOf(Prisma.NullTypes.DbNull)
        expect(Prisma.JsonNull).toBeInstanceOf(Prisma.NullTypes.JsonNull)
        expect(Prisma.AnyNull).toBeInstanceOf(Prisma.NullTypes.AnyNull)
      })

      test('custom instances are accepted for cross-bundle compatibility', async () => {
        const record = await prisma.requiredJsonField.create({
          data: {
            // @ts-expect-error
            json: new Prisma.NullTypes.JsonNull(),
          },
        })
        expect(record.json).toBeNull()
      })
    })
  },
  {
    optOut: {
      from: ['sqlserver', 'mongodb'],
      reason: `
        sqlserver - connector does not support Json type
        mongodb - doesn't use DbNull/JsonNull
      `,
    },
  },
)
