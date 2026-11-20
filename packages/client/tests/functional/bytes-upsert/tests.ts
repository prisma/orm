import { randomBytes } from 'crypto'

import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('bytes upsert should work correctly', async () => {
      const byteId = new Uint8Array(randomBytes(16))
      const upsertByteRow = () =>
        prisma.testByteId.upsert({
          create: {
            bytes: byteId,
          },
          where: {
            bytes: byteId,
          },
          update: {},
        })

      await upsertByteRow()
      // This second call was failing in v7 with "No record was found for an upsert"
      await upsertByteRow() // Should not throw

      // Verify the record exists and has correct data
      const result = await prisma.testByteId.findUnique({
        where: { bytes: byteId },
      })
      expect(result).toBeTruthy()
      expect(result?.bytes).toEqual(byteId)
    })
  },
  {
    optOut: {
      from: ['sqlserver'],
      reason: 'SQL Server does not support bytes IDs',
    },
  },
)
