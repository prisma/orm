import { AdapterProviders, Providers } from '../../_utils/providers'
import { defaultTestSuiteOptions } from '../_utils/test-suite-options'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    // The suite runs against its own ephemeral database that the test harness
    // resets and tears down, so the SET table only needs to be created, not
    // dropped. A suite-level `afterAll` cannot touch `prisma` anyway: the
    // harness deletes the `prisma` global in its own `afterAll` hook.
    beforeAll(async () => {
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS VehicleSet (
          id   INT          AUTO_INCREMENT PRIMARY KEY,
          type SET('car','truck','van') DEFAULT NULL
        )
      `
    })

    test('SET column with a single active value returns a plain string', async () => {
      await prisma.$executeRaw`INSERT INTO VehicleSet (type) VALUES ('car')`
      const rows = await prisma.$queryRaw<{ id: number; type: string }[]>`
        SELECT id, type FROM VehicleSet ORDER BY id DESC LIMIT 1
      `
      expect(rows[0].type).toBe('car')
    })

    test('SET column with multiple active values returns a comma-joined string', async () => {
      await prisma.$executeRaw`INSERT INTO VehicleSet (type) VALUES ('car,truck')`
      const rows = await prisma.$queryRaw<{ id: number; type: string }[]>`
        SELECT id, type FROM VehicleSet ORDER BY id DESC LIMIT 1
      `
      expect(rows[0].type).toBe('car,truck')
    })

    test('SET column with no active values returns an empty string', async () => {
      await prisma.$executeRaw`INSERT INTO VehicleSet (type) VALUES ('')`
      const rows = await prisma.$queryRaw<{ id: number; type: string }[]>`
        SELECT id, type FROM VehicleSet ORDER BY id DESC LIMIT 1
      `
      expect(rows[0].type).toBe('')
    })

    test('SET column with NULL returns null', async () => {
      await prisma.$executeRaw`INSERT INTO VehicleSet (type) VALUES (NULL)`
      const rows = await prisma.$queryRaw<{ id: number; type: string | null }[]>`
        SELECT id, type FROM VehicleSet ORDER BY id DESC LIMIT 1
      `
      expect(rows[0].type).toBeNull()
    })
  },
  {
    ...defaultTestSuiteOptions,
    skipDefaultClientInstance: false,
    optOut: {
      from: [Providers.SQLITE, Providers.POSTGRESQL, Providers.COCKROACHDB, Providers.SQLSERVER, Providers.MONGODB],
      reason: 'SET is a MySQL/MariaDB-specific column type',
    },
    skipDriverAdapter: {
      from: [AdapterProviders.JS_PLANETSCALE],
      reason: 'the PlanetScale driver adapter does not support the SET column type',
    },
  },
)
