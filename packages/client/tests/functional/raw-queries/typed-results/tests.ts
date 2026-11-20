import { Providers } from '../../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare let Prisma: typeof PrismaNamespace

testMatrix.setupTestSuite(
  ({ driverAdapter, provider }) => {
    beforeEach(async () => {
      await prisma.testModel.deleteMany()
    })

    function getAllEntries() {
      if (provider === Providers.MYSQL) {
        return prisma.$queryRaw`SELECT * FROM \`TestModel\`;`
      } else {
        return prisma.$queryRaw`SELECT * FROM "TestModel";`
      }
    }

    test('simple expression', async () => {
      const result = (await prisma.$queryRaw`SELECT 1 + 1`) as Array<Record<string, unknown>>
      expect(Number(Object.values(result[0])[0])).toEqual(2)
    })

    test('query model with multiple types', async () => {
      await prisma.testModel.create({
        data: {
          string: 'str',
          int: 42,
          bInt: BigInt('12345'),
          float: 0.125,
          bytes: Uint8Array.from([1, 2, 3]),
          bool: true,
          dt: new Date('1900-10-10T01:10:10.001Z'),
          dec: new Prisma.Decimal('0.0625'),
        },
      })

      const result = await getAllEntries()

      expect(result).toEqual([
        {
          id: expect.anything(),
          string: 'str',
          int: 42,
          // TODO: replace with exact value and remove next assert after
          // Jest is updated to at least 30.0.0-alpha.6 (which ships https://github.com/jestjs/jest/pull/15191).
          bInt: expect.anything(),
          float: 0.125,
          bytes: Uint8Array.from([1, 2, 3]),
          bool: driverAdapter === 'js_d1' || provider === Providers.MYSQL ? 1 : true,
          dt: new Date('1900-10-10T01:10:10.001Z'),
          dec: driverAdapter === 'js_d1' ? 0.0625 : new Prisma.Decimal('0.0625'),
        },
      ])

      if (driverAdapter === 'js_d1') {
        // It's a number
        expect(result![0].bInt === 12345).toBe(true)
      } else {
        // It's a bigint
        expect(result![0].bInt === BigInt('12345')).toBe(true)
      }
    })

    test('query model with a BigInt = 2147483647 (i32)', async () => {
      await prisma.testModel.create({
        data: {
          bInt: BigInt(2147483647),
        },
      })

      const result = await getAllEntries()

      if (driverAdapter === 'js_d1') {
        // It's a number
        expect(result![0].bInt === BigInt('2147483647')).toBe(false)
        expect(result![0].bInt === 2147483647).toBe(true)
      } else {
        // It's a bigint
        expect(result![0].bInt === BigInt('2147483647')).toBe(true)
      }
    })

    test('query model with a BigInt = -2147483647 (-i32)', async () => {
      await prisma.testModel.create({
        data: {
          bInt: BigInt(-2147483647),
        },
      })

      const result = await getAllEntries()

      if (driverAdapter === 'js_d1') {
        // It's a number
        expect(result![0].bInt === -2147483647).toBe(true)
      } else {
        // It's a bigint
        expect(result![0].bInt === BigInt('-2147483647')).toBe(true)
      }
    })

    test('query model with a BigInt = MAX_SAFE_INTEGER', async () => {
      await prisma.testModel.create({
        data: {
          bInt: BigInt('9007199254740991'),
        },
      })

      const result = await getAllEntries()

      if (driverAdapter === 'js_d1') {
        expect(result![0].bInt === 9007199254740991).toBe(true)
      } else {
        expect(result![0].bInt === BigInt('9007199254740991')).toBe(true)
      }
    })

    test('query model with a BigInt = -MAX_SAFE_INTEGER', async () => {
      await prisma.testModel.create({
        data: {
          bInt: BigInt('-9007199254740991'),
        },
      })

      const result = await getAllEntries()

      if (driverAdapter === 'js_d1') {
        // It's a number
        expect(result![0].bInt === -9007199254740991).toBe(true)
      } else {
        // It's a bigint
        expect(result![0].bInt === BigInt('-9007199254740991')).toBe(true)
      }
    })

    describe('when BigInt value is not a safe integer', () => {
      // https://developers.cloudflare.com/d1/build-databases/query-databases/
      // D1 supports 64-bit signed INTEGER values internally, however BigInts
      // are not currently supported in the API yet. JavaScript integers are safe up to Number.MAX_SAFE_INTEGER
      const isBigIntNativelySupported = !['js_d1'].includes(driverAdapter as string)

      describe('query model with a BigInt = MAX_SAFE_INTEGER + MAX_SAFE_INTEGER', () => {
        const createBigIntMaxSafeIntPlusMaxSafeInt = (prisma: PrismaClient) => {
          return prisma.testModel.create({
            data: {
              bInt: BigInt('9007199254740991') + BigInt('9007199254740991'),
            },
          })
        }

        testIf(isBigIntNativelySupported)('BigInt is natively supported', async () => {
          await createBigIntMaxSafeIntPlusMaxSafeInt(prisma)
          const result = await getAllEntries()

          // It's a bigint
          expect(result![0].bInt === BigInt('9007199254740991') + BigInt('9007199254740991')).toBe(true)
          expect(result![0].bInt === 18014398509481982n).toBe(true)
        })

        testIf(!isBigIntNativelySupported)('BigInt is not natively supported', async () => {
          const create = createBigIntMaxSafeIntPlusMaxSafeInt(prisma)

          await expect(create).rejects.toThrow('Invalid Int64-encoded value received: 18014398509481982')
        })
      })

      describe.skip('query model with a BigInt = -(MAX_SAFE_INTEGER + MAX_SAFE_INTEGER)', () => {
        const createBigIntMinSafeIntPlusMinSafeInt = (prisma: PrismaClient) => {
          return prisma.testModel.create({
            data: {
              bInt: BigInt('-9007199254740991') + BigInt('-9007199254740991'),
            },
          })
        }

        testIf(isBigIntNativelySupported)('BigInt is natively supported', async () => {
          const create = createBigIntMinSafeIntPlusMinSafeInt(prisma)

          if (driverAdapter === 'js_libsql') {
            await expect(create).rejects.toThrow(
              `bigint is too large to be represented as a 64-bit integer and passed as argument`,
            )
          } else if (driverAdapter && ['js_neon', 'js_pg', 'js_pg_cockroachdb'].includes(driverAdapter)) {
            // PostgresError { code: \"22003\", message: \"value \\\"-18428729675200069634\\\" is out of range for type bigint\", severity: \"ERROR\", detail: None, column: None, hint: None }
            await expect(create).rejects.toThrow(`is out of range for type bigint`)
          } else if (driverAdapter === 'js_planetscale') {
            await expect(create).rejects.toThrow(`Value out of range for the type`)
            await expect(create).rejects.toThrow(
              `rpc error: code = FailedPrecondition desc = Out of range value for column 'bInt' at row 1`,
            )
          }
        })

        testIf(!isBigIntNativelySupported)('BigInt is not natively supported', async () => {
          const create = createBigIntMinSafeIntPlusMinSafeInt(prisma)

          await expect(create).rejects.toThrow('Invalid Int64-encoded value received: -18014398509481982')
        })
      })
    })
  },
  {
    optOut: {
      from: [Providers.MONGODB],
      reason: `
        $queryRaw only works on SQL based providers
      `,
    },
  },
)
