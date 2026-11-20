import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('floats', async () => {
      const largeFloat = await prisma.floats.create({
        data: { value: 1e20 },
      })
      const negativeFloat = await prisma.floats.create({
        data: { value: -1e20 },
      })
      const largeInteger = await prisma.floats.create({
        data: { value: Number.MAX_SAFE_INTEGER },
      })
      const negativeInteger = await prisma.floats.create({
        data: { value: Number.MIN_SAFE_INTEGER },
      })
      const otherFloat = await prisma.floats.create({
        data: { value: 13.37 },
      })

      expect(largeFloat.value).toEqual(1e20)
      expect(negativeFloat.value).toEqual(-1e20)
      expect(largeInteger.value).toEqual(Number.MAX_SAFE_INTEGER)
      expect(negativeInteger.value).toEqual(Number.MIN_SAFE_INTEGER)
      expect(otherFloat.value).toEqual(13.37)
    })
  },
  {
    skipDriverAdapter: {
      from: ['js_pg'],
      reason: `
      Fails with:
        Expected: 9007199254740991 Received: 9007199254740990

      Underlying problem is in PG itself https://github.com/brianc/node-postgres/issues/3092,
      only postgres < 12 is affected. If not fixed by then, should be ok to unskip after Postgres 11 goes
      out of support.
    `,
    },
    skip(when, { clientEngineExecutor, provider }) {
      when(
        clientEngineExecutor === 'remote' && provider === Providers.POSTGRESQL,
        `
        Query plan executor server uses pg driver internally, so it is affected
        by the issue above too.
        `,
      )
    },
  },
)
