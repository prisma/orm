import { Decimal } from '@prisma/client-runtime-utils'

import { Providers } from '../../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    describe('possible inputs', () => {
      beforeAll(async () => {
        await prisma.user.create({
          data: { money: new Decimal('12.5') },
        })
      })

      afterAll(async () => {
        await prisma.user.deleteMany()
      })

      test('decimal as Decimal.js instance', async () => {
        const result = await prisma.user.findFirst({
          where: {
            money: new Decimal('12.5'),
          },
        })

        expect(String(result?.money)).toBe('12.5')
      })

      test('decimal as string', async () => {
        const result = await prisma.user.findFirst({
          where: {
            money: '12.5',
          },
        })

        expect(String(result?.money)).toBe('12.5')
      })

      test('decimal as number', async () => {
        const result = await prisma.user.findFirst({
          where: {
            money: { gt: 12.4, lt: 12.6 },
          },
        })

        expect(String(result?.money)).toBe('12.5')
      })

      test('decimal as decimal.js-like object', async () => {
        const result = await prisma.user.findFirst({
          where: {
            money: {
              d: [12, 5000000],
              e: 1,
              s: 1,
              toFixed: () => '12.5',
            },
          },
        })

        expect(String(result?.money)).toBe('12.5')
      })
    })
  },
  {
    optOut: {
      from: [Providers.MONGODB],
      reason: 'Mongodb connector does not support the Decimal type.',
    },
  },
)
